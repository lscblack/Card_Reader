"""Free-period promotions ("1 year free"): claimed in-app by accounts on a free plan, ended automatically.

A promotion with ``discount_type = "free"`` grants ``discount_value`` months of a paid plan. ``plan_codes`` lists the
plan granted per audience (e.g. ``pro``, ``biz_growth``, ``personal_pro``). Developer and personal accounts upgrade
their own subscription; business accounts upgrade the business they own (plans live on the business). When the
period ends the account goes back to the plan it had, with a reminder 14 days before.
"""

from __future__ import annotations

import asyncio
import calendar
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.errors import AppError
from app.models import Business, BusinessMember, Plan, Promotion, PromotionClaim, User
from app.services import notifications, plans as plan_service, promotions

logger = logging.getLogger("app.free_periods")
REMIND_BEFORE = timedelta(days=14)
FREE_PLAN = {"developer": "free", "personal": "personal_free"}


def add_months(d: datetime, months: int) -> datetime:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return d.replace(year=year, month=month, day=min(d.day, calendar.monthrange(year, month)[1]))


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def _billing_link(user: User, business_id: uuid.UUID | None) -> str:
    if user.account_type == "business" and business_id:
        return f"/business/{business_id}/billing"
    return "/me/settings" if user.account_type == "personal" else "/dashboard/usage"


async def _owned_businesses(session: AsyncSession, user: User) -> list[Business]:
    return list((await session.execute(
        select(Business).join(BusinessMember, BusinessMember.business_id == Business.id)
        .where(BusinessMember.user_id == user.id, BusinessMember.role == "owner", BusinessMember.status == "active",
               Business.deleted_at.is_(None)).order_by(Business.created_at)
    )).scalars())


async def _current_plan(session: AsyncSession, user: User, business: Business | None) -> Plan:
    if user.account_type == "business":
        from app.services.business import business_plan

        assert business is not None
        return await business_plan(session, business)
    return (await plan_service.get_subscription(session, user)).plan


async def _target_plan(session: AsyncSession, promo: Promotion, audience: str) -> Plan | None:
    if not promo.plan_codes:
        return None
    rows = (await session.execute(select(Plan).where(Plan.code.in_(promo.plan_codes), Plan.audience == audience,
                                                     Plan.is_active.is_(True)))).scalars().all()
    return rows[0] if rows else None


async def active_claim(session: AsyncSession, user_id: uuid.UUID) -> PromotionClaim | None:
    return (await session.execute(select(PromotionClaim).where(
        PromotionClaim.user_id == user_id, PromotionClaim.ended_at.is_(None)).order_by(PromotionClaim.ends_at.desc())
        .limit(1))).scalar_one_or_none()


def claim_out(c: PromotionClaim, plan_name: str | None = None) -> dict[str, Any]:
    return {"id": str(c.id), "promotion_id": str(c.promotion_id), "plan_code": c.plan_code, "plan_name": plan_name,
            "business_id": str(c.business_id) if c.business_id else None, "starts_at": _iso(c.starts_at),
            "ends_at": _iso(c.ends_at), "previous_plan_code": c.previous_plan_code}


async def offers(session: AsyncSession, user: User, business_id: uuid.UUID | None = None) -> dict[str, Any]:
    """Free-period promotions this account can see, whether it can claim them now, and its running free period."""
    await expire_for_user(session, user)
    audience = user.account_type
    now = datetime.now(UTC)
    owned = await _owned_businesses(session, user) if audience == "business" else []
    business = next((b for b in owned if business_id is None or b.id == business_id), None)
    current = await _current_plan(session, user, business) if (audience != "business" or business) else None
    running = await active_claim(session, user.id)
    claimed = set((await session.execute(select(PromotionClaim.promotion_id)
                                         .where(PromotionClaim.user_id == user.id))).scalars())
    out = []
    for promo in await promotions.live_promotions(session, now):
        if promo.discount_type != "free" or promo.audience not in ("all", audience):
            continue
        target = await _target_plan(session, promo, audience)
        if target is None:
            continue
        reason = None
        if promo.id in claimed:
            reason = "already_claimed"
        elif running is not None:
            reason = "free_period_running"
        elif audience == "business" and business is None:
            reason = "business_owner_required"
        elif current is None or current.price_monthly_cents > 0:
            reason = "not_on_free_plan"
        out.append({
            "promotion_id": str(promo.id), "name": promo.name, "description": promo.description,
            "banner_text": promo.banner_text, "months": promo.discount_value, "ends_at": _iso(promo.ends_at),
            "plan": {"code": target.code, "name": target.name, "price_monthly_cents": target.price_monthly_cents,
                     "currency": target.currency},
            "eligible": reason is None, "reason": reason,
        })
    plan_name = None
    if running is not None:
        plan_name = (await session.execute(select(Plan.name).where(Plan.code == running.plan_code))).scalar()
    return {"offers": out, "active": claim_out(running, plan_name) if running else None,
            "business_id": str(business.id) if business else None}


async def claim(session: AsyncSession, user: User, promotion_id: uuid.UUID,
                business_id: uuid.UUID | None = None) -> PromotionClaim:
    listing = await offers(session, user, business_id)
    offer = next((o for o in listing["offers"] if o["promotion_id"] == str(promotion_id)), None)
    if offer is None:
        raise AppError(404, "not_found", "This offer isn't available")
    if not offer["eligible"]:
        messages = {
            "already_claimed": "You've already claimed this offer",
            "free_period_running": "You already have a free period running",
            "business_owner_required": "Only a business owner can claim this for their business",
            "not_on_free_plan": "This offer is for accounts on a free plan",
        }
        raise AppError(409, "offer_not_available", messages.get(offer["reason"], "This offer isn't available"),
                       {"reason": offer["reason"]})
    promo = await session.get(Promotion, promotion_id, with_for_update=True)
    assert promo is not None
    if promo.status_at(datetime.now(UTC)) != "active":
        raise AppError(409, "offer_not_available", "This offer has ended", {"reason": "ended"})
    target = await _target_plan(session, promo, user.account_type)
    assert target is not None
    now = datetime.now(UTC)
    business = None
    if user.account_type == "business":
        business = await session.get(Business, uuid.UUID(listing["business_id"]))
        assert business is not None
        previous = business.plan.code if business.plan is not None else None
        business.plan_id = target.id
        business.plan = target
    else:
        sub = await plan_service.get_subscription(session, user)
        previous = sub.plan.code
        sub.plan_id = target.id
        sub.plan = target
        sub.provider = "promotion"
    row = PromotionClaim(promotion_id=promo.id, user_id=user.id, business_id=business.id if business else None,
                         plan_code=target.code, previous_plan_code=previous, starts_at=now,
                         ends_at=add_months(now, promo.discount_value))
    session.add(row)
    promo.redemptions = (promo.redemptions or 0) + 1
    await session.flush()
    if user.account_type != "business":
        sub.provider_subscription_id = str(row.id)
    notifications.notify(session, [user.id], type_="promotion", severity="success",
                         title=f"{target.name} is free until {row.ends_at:%d %b %Y}",
                         body=f"Enjoy {promo.discount_value} months of {target.name} on us.",
                         link=_billing_link(user, row.business_id))
    return row


async def _end(session: AsyncSession, c: PromotionClaim, now: datetime) -> User | None:
    """Back to the previous plan — unless an admin has moved the account to another plan in the meantime."""
    user = await session.get(User, c.user_id)
    c.ended_at = now
    if user is None:
        return None
    if c.business_id is not None:
        business = await session.get(Business, c.business_id)
        if business is not None and business.plan is not None and business.plan.code == c.plan_code:
            prev = await plan_service.get_plan(session, c.previous_plan_code) if c.previous_plan_code else None
            business.plan_id = prev.id if prev else None
            business.plan = prev
    else:
        sub = await plan_service.get_subscription(session, user)
        if sub.plan.code == c.plan_code:
            code = c.previous_plan_code or FREE_PLAN.get(user.account_type, "free")
            prev = await plan_service.get_plan(session, code) or await plan_service.get_plan(
                session, FREE_PLAN.get(user.account_type, "free"))
            assert prev is not None
            sub.plan_id, sub.plan, sub.provider, sub.provider_subscription_id = prev.id, prev, None, None
    return user


async def expire_for_user(session: AsyncSession, user: User) -> None:
    c = await active_claim(session, user.id)
    if c is not None and c.ends_at <= datetime.now(UTC):
        await _end(session, c, datetime.now(UTC))
        await session.commit()


async def sweep(session: AsyncSession, now: datetime | None = None) -> tuple[int, int]:
    """Sends the 14-day reminders and ends due free periods. Returns (reminded, ended)."""
    from app.services import email

    now = now or datetime.now(UTC)
    reminded = ended = 0
    mails: list[tuple[str, dict[str, Any], str]] = []
    due = (await session.execute(select(PromotionClaim).where(
        PromotionClaim.ended_at.is_(None), PromotionClaim.reminded_at.is_(None),
        PromotionClaim.ends_at <= now + REMIND_BEFORE, PromotionClaim.ends_at > now))).scalars().all()
    for c in due:
        user = await session.get(User, c.user_id)
        c.reminded_at = now
        if user is None:
            continue
        reminded += 1
        link = _billing_link(user, c.business_id)
        notifications.notify(session, [user.id], type_="promotion", severity="warning",
                             title=f"Your free {c.plan_code} period ends on {c.ends_at:%d %b %Y}",
                             body="After that you'll be back on the free plan. Nothing is deleted.", link=link)
        mails.append((user.email, {
            "recipient_name": user.full_name or None, "heading": "Your free period ends soon",
            "body_markdown": f"Your free period ends on **{c.ends_at:%d %B %Y}**. After that your account goes back "
                             "to the free plan automatically — nothing is deleted.",
            "cta": {"label": "View your plan", "url": f"{settings.public_web_url}{link}"}}, "Your free period ends soon"))
    over = (await session.execute(select(PromotionClaim).where(
        PromotionClaim.ended_at.is_(None), PromotionClaim.ends_at <= now))).scalars().all()
    for c in over:
        user = await _end(session, c, now)
        if user is None:
            continue
        ended += 1
        link = _billing_link(user, c.business_id)
        notifications.notify(session, [user.id], type_="promotion", severity="info",
                             title="Your free period has ended", body="Your account is back on the free plan.",
                             link=link)
        mails.append((user.email, {
            "recipient_name": user.full_name or None, "heading": "Your free period has ended",
            "body_markdown": "Thanks for trying the paid plan! Your account is now back on the free plan. "
                             "Everything you created is still there.",
            "cta": {"label": "View plans", "url": f"{settings.public_web_url}{link}"}}, "Your free period has ended"))
    await session.commit()
    for to, ctx, subject in mails:
        await email.deliver_templated("admin_message", to, ctx, subject=subject)
    return reminded, ended


async def run_sweeper(session_factory: async_sessionmaker[AsyncSession], stop: asyncio.Event,
                      every: float = 900.0) -> None:
    while not stop.is_set():
        try:
            async with session_factory() as session:
                reminded, ended = await sweep(session)
            if reminded or ended:
                logger.info("Free periods: %d reminded, %d ended", reminded, ended)
        except Exception as exc:  # pragma: no cover
            logger.warning("Free-period sweep failed: %s", exc.__class__.__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=every)
        except (TimeoutError, asyncio.TimeoutError):
            pass
