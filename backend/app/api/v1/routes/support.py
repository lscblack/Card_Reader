"""Customer support requests (anyone, signed in or not) and the admin inbox; admin Stripe payment settings."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

import stripe
from fastapi import APIRouter, Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import EmailStr, Field
from sqlalchemy import func, or_, select

from app.api.deps import AdminUser, ClientDep, CurrentUser, PaginationDep, SessionDep, get_current_user, jwt_scheme
from app.core.errors import AppError, not_found
from app.models import SupportTicket, User
from app.models.support import SUPPORT_STATUSES
from app.schemas.common import Schema
from app.services import audit, notifications, payment_config, payments
from app.services.request_logs import set_actor

router = APIRouter(tags=["Support"])
admin_router = APIRouter(prefix="/admin", tags=["Admin"])


async def optional_user(
    request: Request, session: SessionDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(jwt_scheme)],
) -> User | None:
    if creds is None or not creds.credentials:
        return None
    try:
        return await get_current_user(request, session, creds)
    except AppError:
        return None


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def ticket_out(t: SupportTicket, user: User | None = None) -> dict[str, Any]:
    return {
        "id": str(t.id), "name": t.name, "email": t.email, "phone": t.phone, "category": t.category,
        "subject": t.subject, "message": t.message, "status": t.status, "admin_note": t.admin_note,
        "created_at": _iso(t.created_at), "updated_at": _iso(t.updated_at), "resolved_at": _iso(t.resolved_at),
        "user": ({"id": str(user.id), "email": user.email, "full_name": user.full_name,
                  "account_type": user.account_type} if user else None),
    }


class TicketIn(Schema):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=40)
    category: Literal["billing", "technical", "account", "cards", "feedback", "other"] = "other"
    subject: str = Field(min_length=3, max_length=200)
    message: str = Field(min_length=10, max_length=5000)


@router.post("/support/tickets", status_code=201, summary="Contact support",
             description="Anyone can send a request; signed-in users get it linked to their account.")
async def create_ticket(body: TicketIn, request: Request, session: SessionDep,
                        user: Annotated[User | None, Depends(optional_user)]) -> dict[str, Any]:
    if user is None:
        set_actor(request, "public")
    t = SupportTicket(user_id=user.id if user else None, name=body.name.strip(), email=str(body.email).lower(),
                      phone=(body.phone or "").strip() or None, category=body.category,
                      subject=body.subject.strip(), message=body.message.strip(), status="open")
    session.add(t)
    await session.flush()
    notifications.notify(session, await notifications.admin_ids(session), type_="support", severity="info",
                         title=f"Support: {t.subject}", body=f"{t.name} · {t.email}" + (f" · {t.phone}" if t.phone else ""),
                         link=f"/admin/support?ticket={t.id}")
    await session.commit()
    return ticket_out(t)


@router.get("/support/tickets", summary="Your support requests")
async def my_tickets(user: CurrentUser, session: SessionDep) -> list[dict[str, Any]]:
    rows = (await session.execute(select(SupportTicket).where(SupportTicket.user_id == user.id)
                                  .order_by(SupportTicket.created_at.desc()).limit(50))).scalars()
    return [ticket_out(t) for t in rows]


# ── Admin: support inbox ────────────────────────────────────────────────


@admin_router.get("/support", summary="Support requests")
async def admin_tickets(admin: AdminUser, session: SessionDep, pagination: PaginationDep,
                        status: Literal["open", "in_progress", "resolved"] | None = None,
                        q: str | None = Query(default=None, max_length=200)) -> dict[str, Any]:
    cond = []
    if status:
        cond.append(SupportTicket.status == status)
    if q and q.strip():
        like = f"%{q.strip()}%"
        cond.append(or_(SupportTicket.name.ilike(like), SupportTicket.email.ilike(like),
                        SupportTicket.phone.ilike(like), SupportTicket.subject.ilike(like)))
    total = (await session.execute(select(func.count()).select_from(SupportTicket).where(*cond))).scalar_one()
    rows = (await session.execute(
        select(SupportTicket, User).outerjoin(User, User.id == SupportTicket.user_id).where(*cond)
        .order_by(SupportTicket.created_at.desc()).offset(pagination.offset).limit(pagination.page_size)
    )).all()
    counts = dict((await session.execute(
        select(SupportTicket.status, func.count()).group_by(SupportTicket.status))).all())
    return {
        "items": [ticket_out(t, u) for t, u in rows], "total": total, "page": pagination.page,
        "page_size": pagination.page_size,
        "counts": {s: int(counts.get(s, 0)) for s in SUPPORT_STATUSES},
    }


class TicketPatch(Schema):
    status: Literal["open", "in_progress", "resolved"] | None = None
    admin_note: str | None = Field(default=None, max_length=5000)


@admin_router.patch("/support/{ticket_id}", summary="Update a support request")
async def admin_update_ticket(ticket_id: uuid.UUID, body: TicketPatch, request: Request, admin: AdminUser,
                              session: SessionDep, client: ClientDep) -> dict[str, Any]:
    t = await session.get(SupportTicket, ticket_id)
    if t is None:
        raise not_found("Support request")
    raw = await request.json()
    if body.status is not None and body.status != t.status:
        t.status = body.status
        t.resolved_at = datetime.now(UTC) if body.status == "resolved" else None
        if t.user_id and body.status == "resolved":
            notifications.notify(session, [t.user_id], type_="support", severity="success",
                                 title="Your support request was resolved", body=t.subject, link="/support")
    if "admin_note" in raw:
        t.admin_note = (body.admin_note or "").strip() or None
    audit.record(session, action="admin.support_update", user_id=admin.id, client=client,
                 resource_type="support_ticket", resource_id=t.id, metadata={"status": t.status})
    await session.commit()
    user = await session.get(User, t.user_id) if t.user_id else None
    return ticket_out(t, user)


# ── Admin: payments (Stripe keys) ───────────────────────────────────────


@admin_router.get("/payments", summary="Online payment settings")
async def admin_payments(admin: AdminUser, session: SessionDep) -> dict[str, Any]:
    return await payment_config.admin_view(session)


class PaymentsPatch(Schema):
    enabled: bool | None = None
    secret_key: str | None = Field(default=None, max_length=255)
    publishable_key: str | None = Field(default=None, max_length=255)
    webhook_secret: str | None = Field(default=None, max_length=255)


async def _check_keys(secret: str) -> str:
    """Calls Stripe with the key; returns the account name (raises a friendly error otherwise)."""
    try:
        account = await payments.make_client(secret).v1.accounts.retrieve_current_async()
    except stripe.AuthenticationError as exc:
        raise AppError(422, "invalid_stripe_key", "Stripe rejected this secret key.") from exc
    except stripe.StripeError as exc:
        raise AppError(502, "payment_provider_error", exc.user_message or "Couldn't reach Stripe.") from exc
    profile = getattr(account, "business_profile", None)
    settings_ = getattr(account, "settings", None)
    dashboard = getattr(settings_, "dashboard", None) if settings_ else None
    return (getattr(profile, "name", None) if profile else None) or \
        (getattr(dashboard, "display_name", None) if dashboard else None) or account.id


@admin_router.patch("/payments", summary="Update online payment settings",
                    description="Keys are stored encrypted and never returned. Send \"\" to clear a key.")
async def admin_update_payments(body: PaymentsPatch, request: Request, admin: AdminUser, session: SessionDep,
                                client: ClientDep) -> dict[str, Any]:
    raw = await request.json()
    patch: dict[str, Any] = {}
    secret = (body.secret_key or "").strip()
    publishable = (body.publishable_key or "").strip()
    webhook = (body.webhook_secret or "").strip()
    if "secret_key" in raw:
        if secret and not secret.startswith(("sk_test_", "sk_live_", "rk_test_", "rk_live_")):
            raise AppError(422, "invalid_stripe_key", "The secret key starts with sk_test_ or sk_live_.")
        if secret:
            await _check_keys(secret)
        patch["secret_key"] = secret
    if "publishable_key" in raw:
        if publishable and not publishable.startswith(("pk_test_", "pk_live_")):
            raise AppError(422, "invalid_stripe_key", "The publishable key starts with pk_test_ or pk_live_.")
        patch["publishable_key"] = publishable
    if "webhook_secret" in raw:
        if webhook and not webhook.startswith("whsec_"):
            raise AppError(422, "invalid_stripe_key", "The webhook signing secret starts with whsec_.")
        patch["webhook_secret"] = webhook
    if body.enabled is not None:
        patch["enabled"] = body.enabled
    await payment_config.save(session, patch, admin.id)
    await session.flush()
    cfg = await payment_config.load(session)
    if cfg.secret_key and cfg.publishable_key and cfg.mode != ("test" if cfg.publishable_key.startswith("pk_test_") else "live"):
        raise AppError(422, "invalid_stripe_key", "The secret and publishable keys must both be test keys or both live keys.")
    audit.record(session, action="admin.payments_update", user_id=admin.id, client=client,
                 resource_type="platform_settings", resource_id="payments",
                 metadata={k: (bool(v) if k != "enabled" else v) for k, v in patch.items()})
    await session.commit()
    return await payment_config.admin_view(session)


@admin_router.post("/payments/test", summary="Test the Stripe connection")
async def admin_test_payments(admin: AdminUser, session: SessionDep) -> dict[str, Any]:
    cfg = await payment_config.load(session)
    if not cfg.secret_key:
        raise AppError(409, "payments_disabled", "Add a Stripe secret key first.")
    return {"ok": True, "account": await _check_keys(cfg.secret_key), "mode": cfg.mode}
