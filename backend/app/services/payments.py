"""Online upgrades with Stripe (Checkout Sessions, ``ui_mode="elements"``, subscription mode).

The dashboard renders its own checkout page with the Payment Element; this module creates the Checkout Session,
applies the plan once Stripe reports it paid (from the return page *and* the webhook, idempotently) and follows the
subscription afterwards (payment failures, cancellations from the customer portal).

Developer and personal accounts pay for their own subscription; business accounts pay for the business they own
(plans live on the business). Prices come from our ``plans`` table (``price_data``), so no Stripe Prices need to be
created by hand. Our promotion codes become Stripe coupons (first invoice only).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import Business, BusinessMember, CheckoutSession, Plan, Promotion, PromotionClaim, Subscription, User
from app.services import notifications, payment_config, plans as plan_service, promotions

logger = logging.getLogger("app.payments")

Interval = Literal["month", "year"]
FREE_PLAN = {"developer": "free", "personal": "personal_free", "business": "biz_starter"}


def make_client(secret_key: str) -> stripe.StripeClient:
    return stripe.StripeClient(secret_key, http_client=stripe.HTTPXClient())


async def _client(session: AsyncSession, *, require_enabled: bool = True) -> stripe.StripeClient:
    cfg = await payment_config.load(session)
    if not cfg.secret_key or (require_enabled and not cfg.enabled):
        raise AppError(503, "payments_disabled", "Online payments aren't available right now. Please contact support.")
    return make_client(cfg.secret_key)


def _stripe_error(exc: stripe.StripeError) -> AppError:
    logger.warning("Stripe error: %s", exc.user_message or exc.__class__.__name__)
    return AppError(502, "payment_provider_error", exc.user_message or "The payment provider returned an error.")


def billing_link(user: User, business_id: uuid.UUID | None) -> str:
    if business_id is not None:
        return f"/business/{business_id}/billing"
    return "/me/settings" if user.account_type == "personal" else "/dashboard/usage"


def price_for(plan: Plan, interval: Interval) -> int:
    if interval == "year":
        return plan.price_yearly_cents if plan.price_yearly_cents is not None else plan.price_monthly_cents * 12
    return plan.price_monthly_cents


async def owned_business(session: AsyncSession, user: User, business_id: uuid.UUID) -> Business:
    business = (await session.execute(
        select(Business).join(BusinessMember, BusinessMember.business_id == Business.id)
        .where(Business.id == business_id, Business.deleted_at.is_(None), BusinessMember.user_id == user.id,
               BusinessMember.role == "owner", BusinessMember.status == "active")
    )).scalar_one_or_none()
    if business is None:
        raise AppError(403, "forbidden", "Only the business owner can change its plan.")
    return business


async def _current_plan(session: AsyncSession, user: User, business: Business | None) -> tuple[Plan, str | None]:
    """The payer's plan and its running Stripe subscription id (if paid online)."""
    if business is not None:
        from app.services.business import business_plan

        return await business_plan(session, business), business.stripe_subscription_id
    sub = await plan_service.get_subscription(session, user)
    return sub.plan, sub.provider_subscription_id if sub.provider == "stripe" else None


async def _customer(client: stripe.StripeClient, user: User, business: Business | None) -> str:
    owner: User | Business = business if business is not None else user
    if owner.stripe_customer_id:
        return owner.stripe_customer_id
    customer = await client.v1.customers.create_async(params={
        "email": (business.email if business is not None and business.email else user.email),
        "name": business.name if business is not None else (user.full_name or user.email),
        "metadata": {"user_id": str(user.id), **({"business_id": str(business.id)} if business else {})},
    })
    owner.stripe_customer_id = customer.id
    return customer.id


async def _coupon(client: stripe.StripeClient, promo: Promotion, plan: Plan) -> str:
    """A Stripe coupon mirroring the promotion (reused across checkouts)."""
    coupon_id = f"nextap-{promo.id.hex[:16]}-{promo.discount_type}{promo.discount_value}"
    if promo.discount_type == "amount":
        coupon_id += f"-{plan.currency.lower()}"
    try:
        return (await client.v1.coupons.retrieve_async(coupon_id)).id
    except stripe.InvalidRequestError:
        pass
    params: dict[str, Any] = {"id": coupon_id, "name": promo.name[:40], "duration": "once"}
    if promo.discount_type == "percent":
        params["percent_off"] = min(100, promo.discount_value)
    else:
        params.update(amount_off=promo.discount_value, currency=plan.currency.lower())
    return (await client.v1.coupons.create_async(params=params)).id


async def _validated_promotion(session: AsyncSession, code: str, plan: Plan) -> Promotion:
    promo = (await session.execute(select(Promotion).where(Promotion.code == code.strip().upper()))
             ).scalar_one_or_none()
    now = datetime.now(UTC)
    if (promo is None or promo.discount_type not in ("percent", "amount") or promo.status_at(now) != "active"
            or not promotions.applies_to(promo, plan)):
        raise AppError(422, "invalid_promotion_code", "This promotion code isn't valid for this plan.")
    return promo


async def create_checkout(session: AsyncSession, user: User, *, plan_code: str, interval: Interval,
                          business_id: uuid.UUID | None, promotion_code: str | None,
                          return_origin: str) -> dict[str, Any]:
    plan = await plan_service.get_plan(session, plan_code)
    if plan is None or not plan.is_active:
        raise AppError(404, "not_found", "This plan isn't available.")
    audience = "business" if business_id is not None else user.account_type
    if plan.audience != audience:
        raise AppError(422, "invalid_plan", "This plan isn't available for your account.")
    amount = price_for(plan, interval)
    if amount <= 0:
        raise AppError(422, "invalid_plan", "Free plans don't need a checkout.")
    business = await owned_business(session, user, business_id) if business_id is not None else None
    current, _ = await _current_plan(session, user, business)
    if current.code == plan.code:
        raise AppError(409, "already_on_plan", f"You're already on {plan.name}.")
    promo = await _validated_promotion(session, promotion_code, plan) if promotion_code else None

    client = await _client(session)
    meta = {"user_id": str(user.id), "plan_code": plan.code, "interval": interval,
            **({"business_id": str(business.id)} if business else {})}
    try:
        customer = await _customer(client, user, business)
        params: dict[str, Any] = {
            "mode": "subscription",
            "ui_mode": "elements",
            "customer": customer,
            "line_items": [{
                "quantity": 1,
                "price_data": {
                    "currency": plan.currency.lower(),
                    "unit_amount": amount,
                    "recurring": {"interval": interval},
                    "product_data": {"name": f"nexTap {plan.name}",
                                     **({"description": plan.description} if plan.description else {})},
                },
            }],
            "return_url": f"{return_origin}/checkout/complete?session_id={{CHECKOUT_SESSION_ID}}",
            "metadata": meta,
            "subscription_data": {"metadata": meta},
        }
        if promo is not None:
            params["discounts"] = [{"coupon": await _coupon(client, promo, plan)}]
        cs = await client.v1.checkout.sessions.create_async(params=params)
    except stripe.StripeError as exc:
        await session.commit()  # keep a freshly created customer id
        raise _stripe_error(exc) from exc
    session.add(CheckoutSession(
        stripe_session_id=cs.id, user_id=user.id, business_id=business.id if business else None,
        plan_code=plan.code, billing_interval=interval, amount_cents=amount, currency=plan.currency.upper(),
        promotion_code=promo.code if promo else None, status="open",
    ))
    await session.commit()
    return {"session_id": cs.id, "client_secret": cs.client_secret,
            "publishable_key": (await payment_config.load(session)).publishable_key}


async def _row(session: AsyncSession, stripe_session_id: str, *, lock: bool = False) -> CheckoutSession | None:
    stmt = select(CheckoutSession).where(CheckoutSession.stripe_session_id == stripe_session_id)
    if lock:
        stmt = stmt.with_for_update()
    return (await session.execute(stmt)).scalar_one_or_none()


async def _apply_plan(session: AsyncSession, row: CheckoutSession, subscription_id: str | None) -> str | None:
    """Moves the payer onto the purchased plan. Returns the Stripe subscription it replaces (to cancel), if any."""
    user = await session.get(User, row.user_id)
    plan = await plan_service.get_plan(session, row.plan_code)
    if user is None or plan is None:
        return None
    now = datetime.now(UTC)
    # A running free period would switch the account back to its old plan when it ends: close it.
    for claim in (await session.execute(select(PromotionClaim).where(
            PromotionClaim.user_id == user.id, PromotionClaim.ended_at.is_(None)))).scalars():
        claim.ended_at = now
    replaced: str | None
    if row.business_id is not None:
        business = await session.get(Business, row.business_id)
        if business is None:
            return None
        replaced = business.stripe_subscription_id
        business.plan_id, business.plan, business.stripe_subscription_id = plan.id, plan, subscription_id
    else:
        sub = await plan_service.get_subscription(session, user)
        replaced = sub.provider_subscription_id if sub.provider == "stripe" else None
        sub.plan_id, sub.plan, sub.status = plan.id, plan, "active"
        sub.provider, sub.provider_subscription_id = "stripe", subscription_id
    if row.promotion_code:
        promo = (await session.execute(select(Promotion).where(Promotion.code == row.promotion_code))
                 ).scalar_one_or_none()
        if promo is not None:
            promo.redemptions = (promo.redemptions or 0) + 1
    notifications.notify(session, [user.id], type_="billing", severity="success",
                         title=f"Welcome to {plan.name}", body="Your payment went through and your plan is active.",
                         link=billing_link(user, row.business_id))
    return replaced if replaced and replaced != subscription_id else None


async def fulfill(session: AsyncSession, cs: stripe.checkout.Session) -> CheckoutSession | None:
    """Applies a paid Checkout Session once (safe to call from both the return page and the webhook)."""
    row = await _row(session, cs.id, lock=True)
    if row is None or row.status == "complete":
        return row
    if cs.status == "expired":
        row.status = "expired"
        await session.commit()
        return row
    if cs.status != "complete" or cs.payment_status not in ("paid", "no_payment_required"):
        return row
    subscription_id = cs.subscription if isinstance(cs.subscription, str) else getattr(cs.subscription, "id", None)
    row.status, row.completed_at, row.stripe_subscription_id = "complete", datetime.now(UTC), subscription_id
    replaced = await _apply_plan(session, row, subscription_id)
    await session.commit()
    if replaced:  # an upgrade from one paid plan to another: stop billing the old one
        try:
            await (await _client(session, require_enabled=False)).v1.subscriptions.cancel_async(replaced)
        except stripe.StripeError as exc:
            logger.warning("Could not cancel replaced subscription %s: %s", replaced, exc.__class__.__name__)
    return row


async def checkout_status(session: AsyncSession, user: User, stripe_session_id: str) -> dict[str, Any]:
    row = await _row(session, stripe_session_id)
    if row is None or row.user_id != user.id:
        raise AppError(404, "not_found", "Checkout not found.")
    if row.status == "open":
        try:
            cs = await (await _client(session, require_enabled=False)).v1.checkout.sessions.retrieve_async(stripe_session_id)
        except stripe.StripeError as exc:
            raise _stripe_error(exc) from exc
        row = await fulfill(session, cs) or row
    plan = await plan_service.get_plan(session, row.plan_code)
    return {
        "status": row.status, "plan_code": row.plan_code, "plan_name": plan.name if plan else row.plan_code,
        "interval": row.billing_interval, "amount_cents": row.amount_cents, "currency": row.currency,
        "business_id": str(row.business_id) if row.business_id else None,
        "billing_link": billing_link(user, row.business_id),
    }


async def portal_url(session: AsyncSession, user: User, business_id: uuid.UUID | None, return_url: str) -> str:
    business = await owned_business(session, user, business_id) if business_id is not None else None
    customer = business.stripe_customer_id if business is not None else user.stripe_customer_id
    if not customer:
        raise AppError(409, "no_billing_account", "There's no payment on file yet.")
    try:
        portal = await (await _client(session, require_enabled=False)).v1.billing_portal.sessions.create_async(
            params={"customer": customer, "return_url": return_url})
    except stripe.StripeError as exc:
        raise _stripe_error(exc) from exc
    return portal.url


async def billing_state(session: AsyncSession, user: User, business_id: uuid.UUID | None) -> dict[str, Any]:
    business = await owned_business(session, user, business_id) if business_id is not None else None
    plan, subscription_id = await _current_plan(session, user, business)
    customer = business.stripe_customer_id if business is not None else user.stripe_customer_id
    cfg = await payment_config.load(session)
    return {"enabled": cfg.enabled, "publishable_key": cfg.publishable_key or None,
            "plan_code": plan.code, "paid_online": subscription_id is not None, "can_manage": bool(customer)}


# ── Webhook ─────────────────────────────────────────────────────────────


async def _downgrade(session: AsyncSession, subscription_id: str) -> None:
    """The Stripe subscription ended (canceled or unpaid): back to the free plan."""
    for business in (await session.execute(
            select(Business).where(Business.stripe_subscription_id == subscription_id))).scalars():
        business.plan_id, business.plan, business.stripe_subscription_id = None, None, None
        if business.created_by:
            notifications.notify(session, [business.created_by], type_="billing", severity="info",
                                 title="Your subscription has ended",
                                 body=f"{business.name} is back on the free plan. Nothing is deleted.",
                                 link=f"/business/{business.id}/billing")
    for sub in (await session.execute(select(Subscription).where(
            Subscription.provider == "stripe", Subscription.provider_subscription_id == subscription_id))).scalars():
        user = await session.get(User, sub.user_id)
        free = await plan_service.get_plan(session, FREE_PLAN.get(user.account_type if user else "", "free"))
        if free is None:
            continue
        sub.plan_id, sub.plan, sub.status, sub.provider, sub.provider_subscription_id = free.id, free, "active", None, None
        if user is not None:
            notifications.notify(session, [user.id], type_="billing", severity="info",
                                 title="Your subscription has ended",
                                 body="Your account is back on the free plan. Nothing is deleted.",
                                 link=billing_link(user, None))


async def _sync_status(session: AsyncSession, subscription_id: str, stripe_status: str) -> None:
    status = {"active": "active", "trialing": "active", "past_due": "past_due", "unpaid": "past_due"}.get(stripe_status)
    if status is None:
        return
    for sub in (await session.execute(select(Subscription).where(
            Subscription.provider == "stripe", Subscription.provider_subscription_id == subscription_id))).scalars():
        sub.status = status


async def handle_webhook(session: AsyncSession, payload: bytes, signature: str | None) -> None:
    cfg = await payment_config.load(session)
    if not cfg.webhook_secret or not cfg.secret_key:
        raise AppError(503, "payments_disabled", "Stripe webhooks aren't configured.")
    try:
        event = (await _client(session, require_enabled=False)).construct_event(payload, signature, cfg.webhook_secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise AppError(400, "invalid_signature", "Invalid Stripe signature.") from exc
    obj = event.data.object
    if event.type in ("checkout.session.completed", "checkout.session.async_payment_succeeded",
                      "checkout.session.expired"):
        await fulfill(session, obj)  # type: ignore[arg-type]
    elif event.type == "customer.subscription.deleted":
        await _downgrade(session, obj.id)
        await session.commit()
    elif event.type == "customer.subscription.updated":
        await _sync_status(session, obj.id, obj.status)
        await session.commit()
