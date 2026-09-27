"""Part 3 admin endpoints: branding, plans, promotions, emails, verification sends, Error Center."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, File, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import Field, field_validator
from sqlalchemy import func, insert, or_, select, text, union_all
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, ClientDep, PaginationDep, SessionDep
from app.core.config import settings
from app.core.error_catalog import CATALOG_LIST, ErrorDef
from app.core.errors import AppError, not_found, validation_error
from app.models import (
    Business,
    BusinessMember,
    Delivery,
    EmailCampaign,
    EmailLog,
    NfcEvent,
    Plan,
    Promotion,
    RequestLog,
    Subscription,
    User,
)
from app.schemas.common import Schema
from app.services import audit, branding, email, email_templates, media, promotions
from app.services.business_serializers import request_log_out
from app.services.plans import DEFAULT_PLAN_CODES
from app.services.serializers import delivery_out, plan_out
from app.services.svg_sanitizer import InvalidSVG, looks_like_svg, sanitize_svg

router = APIRouter(prefix="/admin", tags=["Admin"])


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


# ══ Branding ═══════════════════════════════════════════════════════════════
@router.get("/branding", summary="Current branding")
async def get_branding(admin: AdminUser) -> dict[str, Any]:
    await branding.reload()
    return branding.public()


@router.patch("/branding", summary="Update branding (partial)",
              description="Fonts must come from `/meta/fonts`; accents need ≥ 3:1 contrast "
                          "(`422 branding_low_contrast`).")
async def patch_branding(request: Request, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise validation_error("body", "a JSON object is required")
    changes = branding.validate_patch(body)
    data = await branding.save(session, changes, admin.id)
    audit.record(session, action="admin.branding_update", user_id=admin.id, client=client,
                 resource_type="branding", resource_id="branding", metadata={"fields": sorted(changes)})
    await session.commit()
    return branding.public(data)


@router.post("/branding/assets", summary="Upload a logo / dark logo / sign-in logo / favicon (PNG, SVG, WebP ≤ 1 MB)")
async def upload_branding_asset(admin: AdminUser, session: SessionDep, client: ClientDep,
                                variant: Literal["logo", "logo_dark", "auth_logo", "auth_logo_dark", "favicon"] = Query(...),
                                file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise AppError(422, "invalid_upload", "Branding assets must be at most 1 MB",
                       [{"field": "file", "message": "file too large (max 1 MB)"}])
    if looks_like_svg(data):
        try:
            clean = await run_in_threadpool(sanitize_svg, data)
        except InvalidSVG as exc:
            raise AppError(422, "invalid_upload", f"Invalid SVG: {exc}", [{"field": "file", "message": str(exc)}]) from exc
        rel = f"branding/{variant}-{uuid.uuid4().hex[:12]}.svg"
        target = media.media_root() / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        await run_in_threadpool(target.write_bytes, clean)
        path = rel
    else:
        if media.sniff(data) not in ("png", "webp"):
            raise AppError(422, "invalid_upload", "Branding assets must be PNG, SVG or WebP",
                           [{"field": "file", "message": "unsupported type"}])
        path = await run_in_threadpool(media.save_image, data, "branding", variant)
    field = branding.VARIANTS[variant]
    old = (await branding.current())[field]
    data_out = await branding.save(session, {field: path}, admin.id)
    audit.record(session, action="admin.branding_asset_upload", user_id=admin.id, client=client,
                 resource_type="branding", resource_id=variant, metadata={"path": path})
    await session.commit()
    media.delete_file(old)
    return branding.public(data_out)


@router.delete("/branding/assets", summary="Remove a branding asset")
async def delete_branding_asset(admin: AdminUser, session: SessionDep, client: ClientDep,
                                variant: Literal["logo", "logo_dark", "auth_logo", "auth_logo_dark", "favicon"] = Query(...)) -> dict[str, Any]:
    field = branding.VARIANTS[variant]
    old = (await branding.current())[field]
    data_out = await branding.save(session, {field: None}, admin.id)
    audit.record(session, action="admin.branding_asset_delete", user_id=admin.id, client=client,
                 resource_type="branding", resource_id=variant)
    await session.commit()
    media.delete_file(old)
    return branding.public(data_out)


# ══ Plans ══════════════════════════════════════════════════════════════════
PLAN_CODE_RE = re.compile(r"^[a-z0-9_]{2,32}$")


class PlanFields(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    price_monthly_cents: int | None = Field(default=None, ge=0, le=100_000_000)
    price_yearly_cents: int | None = Field(default=None, ge=0, le=1_000_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    events_per_month: int | None = Field(default=None, ge=0)
    max_applications: int | None = Field(default=None, ge=0)
    max_devices: int | None = Field(default=None, ge=0)
    max_cards: int | None = Field(default=None, ge=0)
    max_members: int | None = Field(default=None, ge=0)
    features: list[str] | None = Field(default=None, max_length=30)
    audience: Literal["developer", "business", "personal"] | None = None
    max_contacts: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    is_featured: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    badge: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=500)


class PlanCreate(PlanFields):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    price_monthly_cents: int = Field(ge=0, le=100_000_000)
    audience: Literal["developer", "business", "personal"] = "developer"

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        if not PLAN_CODE_RE.match(v):
            raise ValueError("code must be 2-32 characters of a-z, 0-9 and _")
        return v


class PlanPatch(PlanFields):
    code: str | None = None


async def _subscribers(session: SessionDep, plan_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not plan_ids:
        return {}
    subs = dict((await session.execute(select(Subscription.plan_id, func.count()).where(
        Subscription.plan_id.in_(plan_ids), Subscription.status == "active").group_by(Subscription.plan_id))).all())
    biz = dict((await session.execute(select(Business.plan_id, func.count()).where(
        Business.plan_id.in_(plan_ids), Business.deleted_at.is_(None)).group_by(Business.plan_id))).all())
    return {pid: int(subs.get(pid, 0)) + int(biz.get(pid, 0)) for pid in plan_ids}


def _admin_plan(plan: Plan, subscribers: int) -> dict[str, Any]:
    return plan_out(plan).model_dump(mode="json") | {"subscribers": subscribers}


async def _plan(session: SessionDep, code: str) -> Plan:
    plan = (await session.execute(select(Plan).where(Plan.code == code))).scalar_one_or_none()
    if plan is None:
        raise not_found("Plan")
    return plan


@router.get("/plans", summary="All plans (incl. inactive)")
async def list_plans(admin: AdminUser, session: SessionDep) -> list[dict[str, Any]]:
    plans = (await session.execute(select(Plan).order_by(Plan.audience, Plan.sort_order, Plan.code))).scalars().all()
    subs = await _subscribers(session, [p.id for p in plans])
    return [_admin_plan(p, subs[p.id]) for p in plans]


@router.post("/plans", status_code=201, summary="Create a plan")
async def create_plan(body: PlanCreate, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    if (await session.execute(select(Plan.id).where(Plan.code == body.code))).first():
        raise AppError(409, "plan_exists", "A plan with this code already exists")
    data = body.model_dump(exclude_none=True)
    data.setdefault("currency", "USD")
    data["currency"] = data["currency"].upper()
    plan = Plan(**{"features": [], "is_active": True, "is_featured": False, "sort_order": 100, **data})
    session.add(plan)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise AppError(409, "plan_exists", "A plan with this code already exists") from None
    audit.record(session, action="admin.plan_create", user_id=admin.id, client=client, resource_type="plan",
                 resource_id=plan.code, metadata={"name": plan.name})
    await session.commit()
    return _admin_plan(plan, 0)


@router.patch("/plans/{code}", summary="Update a plan (code is immutable)")
async def update_plan(code: str, body: PlanPatch, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    plan = await _plan(session, code)
    data = body.model_dump(exclude_unset=True)
    if "code" in data and data["code"] != plan.code:
        raise validation_error("body.code", "plan codes are immutable")
    data.pop("code", None)
    nullable = {"price_yearly_cents", "events_per_month", "max_applications", "max_devices", "max_cards",
                "max_members", "max_contacts", "badge", "description"}
    for key, value in data.items():
        if value is None and key not in nullable:
            continue
        setattr(plan, key, value.upper() if key == "currency" else value)
    audit.record(session, action="admin.plan_update", user_id=admin.id, client=client, resource_type="plan",
                 resource_id=plan.code, metadata={"fields": sorted(data)})
    await session.commit()
    return _admin_plan(plan, (await _subscribers(session, [plan.id]))[plan.id])


async def _set_plan_active(code: str, active: bool, admin: User, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    plan = await _plan(session, code)
    plan.is_active = active
    audit.record(session, action=f"admin.plan_{'activate' if active else 'deactivate'}", user_id=admin.id,
                 client=client, resource_type="plan", resource_id=plan.code)
    await session.commit()
    return _admin_plan(plan, (await _subscribers(session, [plan.id]))[plan.id])


@router.post("/plans/{code}/activate", summary="Activate a plan")
async def activate_plan(code: str, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    return await _set_plan_active(code, True, admin, session, client)


@router.post("/plans/{code}/deactivate", summary="Deactivate a plan (hidden from public listings)")
async def deactivate_plan(code: str, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    return await _set_plan_active(code, False, admin, session, client)


@router.delete("/plans/{code}", status_code=204, summary="Delete an unused plan",
               description="`409 plan_in_use` when it has subscribers or is a default plan — deactivate instead.")
async def delete_plan(code: str, admin: AdminUser, session: SessionDep, client: ClientDep) -> Response:
    plan = await _plan(session, code)
    if plan.code in DEFAULT_PLAN_CODES or (await _subscribers(session, [plan.id]))[plan.id] > 0:
        raise AppError(409, "plan_in_use", "This plan has subscribers or is a default plan; deactivate it instead")
    audit.record(session, action="admin.plan_delete", user_id=admin.id, client=client, resource_type="plan",
                 resource_id=plan.code)
    await session.delete(plan)
    await session.commit()
    return Response(status_code=204)


# ══ Promotions ═════════════════════════════════════════════════════════════
class PromotionFields(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    code: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=500)
    # "free": a free period on a paid plan (discount_value = months), claimed by free-plan accounts in-app.
    discount_type: Literal["percent", "amount", "free"] | None = None
    discount_value: int | None = Field(default=None, ge=1)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    audience: Literal["developer", "business", "personal", "all"] | None = None
    plan_codes: list[str] | None = Field(default=None, max_length=50)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool | None = None
    show_on_landing: bool | None = None
    banner_text: str | None = Field(default=None, max_length=200)
    max_redemptions: int | None = Field(default=None, ge=1)


class PromotionCreate(PromotionFields):
    name: str = Field(min_length=1, max_length=120)
    discount_type: Literal["percent", "amount", "free"]
    discount_value: int = Field(ge=1)


async def _validate_promotion(session: SessionDep, promo: Promotion) -> None:
    if promo.discount_type == "percent" and not 1 <= promo.discount_value <= 100:
        raise validation_error("body.discount_value", "percent discounts must be 1-100")
    if promo.discount_type == "amount":
        if not promo.currency:
            raise validation_error("body.currency", "currency is required for amount discounts")
        promo.currency = promo.currency.upper()
    else:
        promo.currency = None
    if promo.discount_type == "free":
        if not 1 <= promo.discount_value <= 36:
            raise validation_error("body.discount_value", "free periods are 1-36 months")
        if not promo.plan_codes:
            raise validation_error("body.plan_codes", "choose the plan(s) to give for free (one per account type)")
        rows = (await session.execute(select(Plan).where(Plan.code.in_(promo.plan_codes)))).scalars().all()
        if any(p.price_monthly_cents <= 0 for p in rows):
            raise validation_error("body.plan_codes", "free periods must give a paid plan")
        audiences = [p.audience for p in rows]
        if len(audiences) != len(set(audiences)):
            raise validation_error("body.plan_codes", "at most one plan per account type")
    if promo.starts_at and promo.ends_at and promo.ends_at <= promo.starts_at:
        raise validation_error("body.ends_at", "ends_at must be after starts_at")
    if promo.code is not None:
        code = promo.code.strip().upper()
        if not code:
            promo.code = None
        elif not re.match(r"^[A-Z0-9_-]{3,32}$", code):
            raise validation_error("body.code", "3-32 characters of A-Z, 0-9, '-' and '_'")
        else:
            promo.code = code
            clash = select(Promotion.id).where(Promotion.code == code)
            if promo.id:
                clash = clash.where(Promotion.id != promo.id)
            if (await session.execute(clash)).first():
                raise AppError(409, "promotion_code_exists", "Another promotion already uses this code")
    if promo.plan_codes:
        known = set((await session.execute(select(Plan.code).where(Plan.code.in_(promo.plan_codes)))).scalars())
        unknown = [c for c in promo.plan_codes if c not in known]
        if unknown:
            raise validation_error("body.plan_codes", f"unknown plan codes: {', '.join(unknown)}")


async def _promotion(session: SessionDep, promotion_id: uuid.UUID) -> Promotion:
    promo = await session.get(Promotion, promotion_id)
    if promo is None:
        raise not_found("Promotion")
    return promo


@router.get("/promotions", summary="All promotions")
async def list_promotions(admin: AdminUser, session: SessionDep,
                          status: Literal["scheduled", "active", "expired", "inactive", "exhausted"] | None = None
                          ) -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    rows = (await session.execute(select(Promotion).order_by(Promotion.created_at.desc()))).scalars().all()
    return [promotions.promotion_out(p, now) for p in rows if status is None or p.status_at(now) == status]


@router.post("/promotions", status_code=201, summary="Create a promotion")
async def create_promotion(body: PromotionCreate, admin: AdminUser, session: SessionDep,
                           client: ClientDep) -> dict[str, Any]:
    data = body.model_dump(exclude_none=True)
    promo = Promotion(**{"audience": "all", "plan_codes": [], "is_active": True, "show_on_landing": False,
                         "redemptions": 0, **data}, created_by=admin.id)
    await _validate_promotion(session, promo)
    session.add(promo)
    await session.flush()
    audit.record(session, action="admin.promotion_create", user_id=admin.id, client=client,
                 resource_type="promotion", resource_id=promo.id, metadata={"name": promo.name, "code": promo.code})
    await session.commit()
    await session.refresh(promo)
    return promotions.promotion_out(promo)


@router.get("/promotions/{promotion_id}", summary="Get a promotion")
async def get_promotion(promotion_id: uuid.UUID, admin: AdminUser, session: SessionDep) -> dict[str, Any]:
    return promotions.promotion_out(await _promotion(session, promotion_id))


@router.patch("/promotions/{promotion_id}", summary="Update a promotion")
async def update_promotion(promotion_id: uuid.UUID, body: PromotionFields, admin: AdminUser, session: SessionDep,
                           client: ClientDep) -> dict[str, Any]:
    promo = await _promotion(session, promotion_id)
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is None and key in ("name", "discount_type", "discount_value", "audience", "is_active",
                                     "show_on_landing", "plan_codes"):
            continue
        setattr(promo, key, value)
    await _validate_promotion(session, promo)
    audit.record(session, action="admin.promotion_update", user_id=admin.id, client=client,
                 resource_type="promotion", resource_id=promo.id, metadata={"fields": sorted(data)})
    await session.commit()
    await session.refresh(promo)
    return promotions.promotion_out(promo)


@router.delete("/promotions/{promotion_id}", status_code=204, summary="Delete a promotion")
async def delete_promotion(promotion_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep) -> Response:
    promo = await _promotion(session, promotion_id)
    audit.record(session, action="admin.promotion_delete", user_id=admin.id, client=client,
                 resource_type="promotion", resource_id=promo.id, metadata={"name": promo.name})
    await session.delete(promo)
    await session.commit()
    return Response(status_code=204)


async def _set_promo_active(promotion_id: uuid.UUID, active: bool, admin: User, session: SessionDep,
                            client: ClientDep) -> dict[str, Any]:
    promo = await _promotion(session, promotion_id)
    promo.is_active = active
    audit.record(session, action=f"admin.promotion_{'activate' if active else 'deactivate'}", user_id=admin.id,
                 client=client, resource_type="promotion", resource_id=promo.id)
    await session.commit()
    await session.refresh(promo)
    return promotions.promotion_out(promo)


@router.post("/promotions/{promotion_id}/activate", summary="Activate a promotion")
async def activate_promotion(promotion_id: uuid.UUID, admin: AdminUser, session: SessionDep,
                             client: ClientDep) -> dict[str, Any]:
    return await _set_promo_active(promotion_id, True, admin, session, client)


@router.post("/promotions/{promotion_id}/deactivate", summary="Deactivate a promotion")
async def deactivate_promotion(promotion_id: uuid.UUID, admin: AdminUser, session: SessionDep,
                               client: ClientDep) -> dict[str, Any]:
    return await _set_promo_active(promotion_id, False, admin, session, client)


# ══ Emails ═════════════════════════════════════════════════════════════════
MAX_RECIPIENTS = 5000


class Cta(Schema):
    label: str = Field(min_length=1, max_length=40)
    url: str = Field(min_length=8, max_length=2048)

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        if not (v.startswith("https://") or (settings.is_development and v.startswith("http://"))):
            raise ValueError("cta.url must be an https URL")
        return v


class EmailFilter(Schema):
    account_type: Literal["developer", "business", "personal"] | None = None
    status: Literal["active", "inactive"] | None = None
    email_verified: bool | None = None
    plan_code: str | None = Field(default=None, max_length=32)


class ComposeIn(Schema):
    user_ids: list[uuid.UUID] | None = Field(default=None, max_length=MAX_RECIPIENTS)
    filter: EmailFilter | None = None
    subject: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1, max_length=20_000)
    cta: Cta | None = None


class PreviewIn(Schema):
    subject: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1, max_length=20_000)
    cta: Cta | None = None


def recipient_conditions(f: EmailFilter) -> list:  # type: ignore[type-arg]
    conds = []
    if f.account_type:
        conds.append(User.account_type == f.account_type)
    if f.status:
        conds.append(User.is_active.is_(f.status == "active"))
    if f.email_verified is not None:
        conds.append(User.email_verified.is_(f.email_verified))
    if f.plan_code:
        dev_plan = select(Subscription.user_id).join(Plan, Plan.id == Subscription.plan_id).where(Plan.code == f.plan_code)
        biz_plan = (select(BusinessMember.user_id).join(Business, Business.id == BusinessMember.business_id)
                    .join(Plan, Plan.id == Business.plan_id)
                    .where(Plan.code == f.plan_code, BusinessMember.role == "owner", Business.deleted_at.is_(None)))
        conds.append(or_(User.id.in_(dev_plan), User.id.in_(biz_plan)))
    return conds


@router.post("/emails", status_code=202, summary="Send an email to users (queued, throttled)")
async def compose_email(body: ComposeIn, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    if (body.user_ids is None) == (body.filter is None):
        raise validation_error("body", "provide exactly one of user_ids or filter")
    conds = [User.id.in_(body.user_ids)] if body.user_ids is not None else recipient_conditions(body.filter)  # type: ignore[arg-type]
    total = int((await session.execute(select(func.count()).select_from(User).where(*conds))).scalar_one())
    if total > MAX_RECIPIENTS:
        raise AppError(422, "too_many_recipients", f"{total} recipients (max {MAX_RECIPIENTS})",
                       {"recipients": total, "max": MAX_RECIPIENTS})
    if total == 0:
        raise AppError(422, "no_recipients", "The selection matched no users")
    brand = await branding.current()
    cta = body.cta.model_dump() if body.cta else None
    rendered = email.render_admin_message(brand, body.subject, body.body_markdown, cta)
    campaign = EmailCampaign(subject=rendered.subject, body_markdown=body.body_markdown, cta=cta,
                             filter=body.filter.model_dump(exclude_none=True) if body.filter else None,
                             recipients=total, created_by=admin.id, html=rendered.html, text_body=rendered.text)
    session.add(campaign)
    await session.flush()
    users = (await session.execute(select(User.id, User.email).where(*conds))).all()
    now = datetime.now(UTC)
    rows = [{"id": uuid.uuid4(), "campaign_id": campaign.id, "to_email": em, "user_id": uid, "template": "admin_message",
             "subject": rendered.subject, "status": "queued", "sent_by": admin.id, "attempts": 0,
             "next_attempt_at": now, "created_at": now} for uid, em in users]
    for i in range(0, len(rows), 1000):
        await session.execute(insert(EmailLog), rows[i : i + 1000])
    audit.record(session, action="admin.email_campaign", user_id=admin.id, client=client,
                 resource_type="email_campaign", resource_id=campaign.id,
                 metadata={"subject": rendered.subject, "recipients": total})
    await session.commit()
    return {"campaign_id": str(campaign.id), "recipients": total}


@router.post("/emails/preview", summary="Preview an admin email")
async def preview_email(body: PreviewIn, admin: AdminUser) -> dict[str, str]:
    brand = await branding.current()
    rendered = email.render_admin_message(brand, body.subject, body.body_markdown,
                                          body.cta.model_dump() if body.cta else None, recipient_name=admin.full_name)
    return {"html": rendered.html, "text": rendered.text}


def _email_log_out(log: EmailLog) -> dict[str, Any]:
    return {"id": str(log.id), "campaign_id": str(log.campaign_id) if log.campaign_id else None,
            "to_email": log.to_email, "user_id": str(log.user_id) if log.user_id else None, "template": log.template,
            "subject": log.subject, "status": log.status, "error": log.error,
            "sent_by": str(log.sent_by) if log.sent_by else None, "attempts": log.attempts,
            "created_at": _iso(log.created_at), "sent_at": _iso(log.sent_at)}


@router.get("/emails", summary="Email log")
async def list_emails(admin: AdminUser, session: SessionDep, pagination: PaginationDep,
                      campaign_id: uuid.UUID | None = None,
                      status: Literal["queued", "sent", "failed", "logged"] | None = None,
                      q: str | None = Query(default=None, max_length=200), user_id: uuid.UUID | None = None,
                      template: str | None = Query(default=None, max_length=40)) -> dict[str, Any]:
    conds = []
    if campaign_id:
        conds.append(EmailLog.campaign_id == campaign_id)
    if status:
        conds.append(EmailLog.status == status)
    if user_id:
        conds.append(EmailLog.user_id == user_id)
    if template:
        conds.append(EmailLog.template == template)
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(EmailLog.to_email.ilike(like), EmailLog.subject.ilike(like)))
    total = (await session.execute(select(func.count()).select_from(EmailLog).where(*conds))).scalar_one()
    rows = (await session.execute(select(EmailLog).where(*conds).order_by(EmailLog.created_at.desc(), EmailLog.id)
                                  .offset(pagination.offset).limit(pagination.page_size))).scalars()
    return {"items": [_email_log_out(r) for r in rows], "total": total, "page": pagination.page,
            "page_size": pagination.page_size}


@router.get("/emails/{email_id}", summary="One email (with stored HTML; one-time links removed)")
async def get_email(email_id: uuid.UUID, admin: AdminUser, session: SessionDep) -> dict[str, Any]:
    log = await session.get(EmailLog, email_id)
    if log is None:
        raise not_found("Email")
    html, text_body = log.html, log.text_body
    if html is None and log.campaign_id:
        camp = await session.get(EmailCampaign, log.campaign_id)
        html, text_body = (camp.html, camp.text_body) if camp else (None, None)
    return _email_log_out(log) | {"html": html, "text": text_body}


@router.get("/email-campaigns", summary="Email campaigns")
async def list_campaigns(admin: AdminUser, session: SessionDep, pagination: PaginationDep) -> dict[str, Any]:
    total = (await session.execute(select(func.count()).select_from(EmailCampaign))).scalar_one()
    camps = (await session.execute(select(EmailCampaign).order_by(EmailCampaign.created_at.desc())
                                   .offset(pagination.offset).limit(pagination.page_size))).scalars().all()
    ids = [c.id for c in camps]
    counts: dict[tuple[uuid.UUID, str], int] = {}
    if ids:
        counts = {(r[0], r[1]): int(r[2]) for r in (await session.execute(
            select(EmailLog.campaign_id, EmailLog.status, func.count()).where(EmailLog.campaign_id.in_(ids))
            .group_by(EmailLog.campaign_id, EmailLog.status))).all()}
    return {"items": [{"id": str(c.id), "subject": c.subject, "recipients": c.recipients,
                       "queued": counts.get((c.id, "queued"), 0), "sent": counts.get((c.id, "sent"), 0),
                       "failed": counts.get((c.id, "failed"), 0), "logged": counts.get((c.id, "logged"), 0),
                       "filter": c.filter, "created_by": str(c.created_by) if c.created_by else None,
                       "created_at": _iso(c.created_at)} for c in camps],
            "total": total, "page": pagination.page, "page_size": pagination.page_size}


@router.get("/email-templates", summary="Email templates")
async def list_templates(admin: AdminUser) -> list[dict[str, str]]:
    return [{"name": t.name, "description": t.description} for t in email_templates.TEMPLATES.values()]


@router.get("/email-templates/{name}/preview", summary="Preview a template with sample data")
async def preview_template(name: str, admin: AdminUser) -> dict[str, str]:
    if name not in email_templates.TEMPLATES:
        raise not_found("Email template")
    brand = await branding.current()
    subject = "A message from the team" if name == "admin_message" else None
    rendered = email_templates.render(name, email_templates.sample_context(name), brand, subject)
    return {"subject": rendered.subject, "html": rendered.html, "text": rendered.text}


# ══ Verification sends & avatar (accounts) ═════════════════════════════════
async def _send_verification(session: SessionDep, user: User, background: BackgroundTasks) -> str | None:
    from app.api.v1.routes.auth import issue_verification

    token = await issue_verification(session, user)
    background.add_task(email.send_verification, user.email, user.full_name, token)
    return email.verification_link(token) if email.expose_dev_links() else None


class BulkVerificationIn(Schema):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_RECIPIENTS)


@router.post("/accounts/send-verification", status_code=202, summary="Send verification emails to several users")
async def bulk_send_verification(body: BulkVerificationIn, admin: AdminUser, session: SessionDep, client: ClientDep,
                                 background: BackgroundTasks) -> dict[str, int]:
    users = (await session.execute(select(User).where(User.id.in_(body.user_ids)))).scalars().all()
    sent = skipped = 0
    for user in users:
        if user.email_verified:
            skipped += 1
            continue
        await _send_verification(session, user, background)
        sent += 1
    audit.record(session, action="admin.send_verification", user_id=admin.id, client=client, resource_type="user",
                 resource_id=None, metadata={"sent": sent, "skipped_already_verified": skipped})
    await session.commit()
    return {"sent": sent, "skipped_already_verified": skipped}


@router.post("/accounts/{user_id}/send-verification", status_code=202, summary="Send a verification email")
async def send_verification(user_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep,
                            background: BackgroundTasks) -> dict[str, Any]:
    user = await session.get(User, user_id)
    if user is None:
        raise not_found("Account")
    if user.email_verified:
        return {"sent": False, "already_verified": True, "dev_verification_url": None}
    dev_url = await _send_verification(session, user, background)
    audit.record(session, action="admin.send_verification", user_id=admin.id, client=client, resource_type="user",
                 resource_id=user.id)
    await session.commit()
    return {"sent": True, "already_verified": False, "dev_verification_url": dev_url}


@router.delete("/accounts/{user_id}/avatar", summary="Remove a user's avatar")
async def delete_user_avatar(user_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    from app.services.serializers import user_out

    user = await session.get(User, user_id)
    if user is None:
        raise not_found("Account")
    old, user.avatar_path = user.avatar_path, None
    audit.record(session, action="admin.avatar_delete", user_id=admin.id, client=client, resource_type="user",
                 resource_id=user.id)
    await session.commit()
    media.delete_file(old)
    return user_out(user).model_dump(mode="json")


# ══ Error Center ═══════════════════════════════════════════════════════════
ERROR_RANGES = {"24h": (timedelta(hours=24), timedelta(hours=1)), "7d": (timedelta(days=7), timedelta(hours=6)),
                "30d": (timedelta(days=30), timedelta(days=1))}


def _error_events(since: datetime):  # type: ignore[no-untyped-def]
    """request_logs ∪ deliveries rows carrying an error code (one aggregate source)."""
    rl = select(RequestLog.error_code.label("code"), RequestLog.created_at.label("ts"),
                RequestLog.user_id.label("uid"), RequestLog.device_id.label("did")) \
        .where(RequestLog.error_code.is_not(None), RequestLog.created_at >= since)
    dl = select(Delivery.error_code.label("code"), Delivery.created_at.label("ts"),
                Delivery.owner_id.label("uid"), NfcEvent.device_id.label("did")) \
        .join(NfcEvent, NfcEvent.id == Delivery.event_id) \
        .where(Delivery.error_code.is_not(None), Delivery.created_at >= since)
    return union_all(rl, dl).subquery("errs")


async def _error_stats(session: SessionDep, range_: str, only_code: str | None = None) -> dict[str, dict[str, Any]]:
    span, step = ERROR_RANGES[range_]
    now = datetime.now(UTC)
    since, prev_since = now - span, now - 2 * span
    errs = _error_events(prev_since)
    code_filter = [errs.c.code == only_code] if only_code else []
    rows = (await session.execute(select(
        errs.c.code,
        func.count().filter(errs.c.ts >= since),
        func.count().filter(errs.c.ts < since),
        func.max(errs.c.ts),
        func.count(func.distinct(errs.c.uid)).filter(errs.c.ts >= since),
        func.count(func.distinct(errs.c.did)).filter(errs.c.ts >= since),
    ).where(*code_filter).group_by(errs.c.code))).all()
    seconds = int(step.total_seconds())
    bucket = func.date_bin(text(f"interval '{seconds} seconds'"), errs.c.ts, text("timestamptz '2000-01-01'"))
    trend_rows = (await session.execute(select(errs.c.code, bucket.label("b"), func.count())
                                        .where(errs.c.ts >= since, *code_filter)
                                        .group_by(errs.c.code, text("b")))).all()
    last_seen_rows = {}
    for model in (RequestLog, Delivery):
        stmt = select(model.error_code, func.max(model.created_at)).where(model.error_code.is_not(None))
        if only_code:
            stmt = stmt.where(model.error_code == only_code)
        for code, ts in (await session.execute(stmt.group_by(model.error_code))).all():
            last_seen_rows[code] = max(ts, last_seen_rows.get(code, ts))
    origin = datetime(2000, 1, 1, tzinfo=UTC)
    first_bucket = origin + ((since - origin) // step) * step
    buckets = []
    b = first_bucket
    while b <= now:
        buckets.append(b)
        b += step
    trends: dict[str, dict[datetime, int]] = {}
    for code, b_ts, count in trend_rows:
        trends.setdefault(code, {})[b_ts] = int(count)
    out: dict[str, dict[str, Any]] = {}
    for code, count, prev, _last, users, devices in rows:
        out[code] = {"count": int(count), "previous_count": int(prev), "last_seen_at": _iso(last_seen_rows.get(code)),
                     "affected_users": int(users), "affected_devices": int(devices)}
    for code, ts in last_seen_rows.items():
        out.setdefault(code, {"count": 0, "previous_count": 0, "last_seen_at": _iso(ts), "affected_users": 0,
                              "affected_devices": 0})
    for code, stats in out.items():
        series = trends.get(code, {})
        stats["trend"] = [{"bucket": _iso(bk), "count": series.get(bk, 0)} for bk in buckets]
    out["__buckets__"] = {"trend": [{"bucket": _iso(bk), "count": 0} for bk in buckets]}
    return out


def _entry(e: ErrorDef) -> dict[str, Any]:
    return {"code": e.code, "ref": e.ref, "http_status": e.http_status, "source": e.source, "title": e.title,
            "description": e.description, "fix": e.fix}


def _stats_for(e: ErrorDef, stats: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if e.source == "mobile":
        return None  # not reported to the server
    empty = {"count": 0, "previous_count": 0, "last_seen_at": None, "affected_users": 0, "affected_devices": 0,
             "trend": stats["__buckets__"]["trend"]}
    return stats.get(e.code, empty)


@router.get("/errors", summary="Error Center: catalog entries with live stats")
async def error_center(admin: AdminUser, session: SessionDep,
                       range: Literal["24h", "7d", "30d"] = Query(default="24h"),
                       source: Literal["api", "delivery", "mobile"] | None = None,
                       q: str | None = Query(default=None, max_length=100),
                       only_occurring: bool = False) -> list[dict[str, Any]]:
    stats = await _error_stats(session, range)
    needle = (q or "").strip().lower()
    out = []
    for e in CATALOG_LIST:
        if source and e.source != source:
            continue
        if needle and needle not in f"{e.code} {e.ref} {e.title} {e.description}".lower():
            continue
        s = _stats_for(e, stats)
        if only_occurring and not (s and s["count"] > 0):
            continue
        out.append(_entry(e) | {"stats": s})
    out.sort(key=lambda x: (-(x["stats"]["count"] if x["stats"] else -1), x["ref"]))
    return out


@router.get("/errors/{ref}", summary="Error Center: one error with routes, users and recent occurrences")
async def error_detail(ref: str, admin: AdminUser, session: SessionDep,
                       range: Literal["24h", "7d", "30d"] = Query(default="24h")) -> dict[str, Any]:
    entry = next((e for e in CATALOG_LIST if e.ref == ref.upper()), None)
    if entry is None:
        raise not_found("Error")
    result = _entry(entry)
    if entry.source == "mobile":
        return result | {"stats": None, "top_routes": [], "top_users": [], "recent": [], "recent_deliveries": []}
    stats = await _error_stats(session, range, entry.code)
    since = datetime.now(UTC) - ERROR_RANGES[range][0]
    top_routes = (await session.execute(
        select(RequestLog.route, func.count()).where(RequestLog.error_code == entry.code, RequestLog.created_at >= since)
        .group_by(RequestLog.route).order_by(func.count().desc()).limit(10))).all()
    errs = _error_events(since)
    top_users = (await session.execute(
        select(User.id, User.email, func.count()).select_from(errs).join(User, User.id == errs.c.uid)
        .where(errs.c.code == entry.code).group_by(User.id, User.email).order_by(func.count().desc()).limit(10))).all()
    recent = (await session.execute(select(RequestLog).where(RequestLog.error_code == entry.code)
                                    .order_by(RequestLog.created_at.desc()).limit(20))).scalars()
    recent_deliveries = (await session.execute(select(Delivery).where(Delivery.error_code == entry.code)
                                               .order_by(Delivery.created_at.desc()).limit(20))).scalars()
    return result | {
        "stats": _stats_for(entry, stats),
        "top_routes": [{"route": r[0], "count": int(r[1])} for r in top_routes],
        "top_users": [{"id": str(u[0]), "email": u[1], "count": int(u[2])} for u in top_users],
        "recent": [request_log_out(r).model_dump(mode="json") for r in recent],
        "recent_deliveries": [delivery_out(d).model_dump(mode="json") for d in recent_deliveries],
    }

