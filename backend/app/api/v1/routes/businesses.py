"""Business workspaces (Part 2 §B2, §B8): business, settings, logo, overview, billing, apps, devices."""

from __future__ import annotations

import uuid
import zoneinfo
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import case, func, select, update

from app.api.deps import BusinessContext, ClientDep, CurrentUser, SessionDep, business_permission
from app.core.errors import AppError, not_found, validation_error
from app.models import (
    Application,
    Business,
    BusinessMember,
    BusinessSlugRedirect,
    Card,
    CardTap,
    Customer,
    Device,
    Employee,
    Profile,
    RequestLog,
)
from app.schemas.business import (
    BillingOut,
    BusinessDeviceOut,
    BusinessDeviceUpdateIn,
    BusinessMeOut,
    BusinessOut,
    BusinessUpdateIn,
    CardTapOut,
    RequestLogOut,
)
from app.schemas.resources import ApplicationCreatedOut, ApplicationCreateIn, ApplicationOut
from app.services import audit, media
from app.services import business as biz
from app.services.actions import validate_action
from app.services.applications import revoke_application_credentials
from app.services.business_serializers import business_out, request_log_out, tap_out
from app.services.permissions import ordered
from app.services.serializers import application_out, device_counts, device_out, plan_out

router = APIRouter(prefix="/businesses", tags=["Businesses"])

View = Annotated[BusinessContext, Depends(business_permission("business.view"))]
Settings_ = Annotated[BusinessContext, Depends(business_permission("settings.manage"))]
ApiView = Annotated[BusinessContext, Depends(business_permission("api.view"))]
ApiManage = Annotated[BusinessContext, Depends(business_permission("api.manage"))]
DevicesManage = Annotated[BusinessContext, Depends(business_permission("devices.manage"))]
Delete = Annotated[BusinessContext, Depends(business_permission("business.delete"))]

ONLINE_WINDOW = timedelta(minutes=2)
RANGES = {"1h": timedelta(hours=1), "24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30),
          "90d": timedelta(days=90), "365d": timedelta(days=365)}


@router.get("", response_model=list[BusinessOut], summary="Businesses I belong to")
async def my_businesses(user: CurrentUser, session: SessionDep) -> list[BusinessOut]:
    rows = (await session.execute(
        select(Business, BusinessMember.role).join(BusinessMember, BusinessMember.business_id == Business.id)
        .where(BusinessMember.user_id == user.id, BusinessMember.status == "active", Business.deleted_at.is_(None))
        .order_by(Business.created_at)
    )).all()
    return [business_out(b, role) for b, role in rows]


@router.get("/slug-available", summary="Check whether a business slug is available")
async def slug_available(user: CurrentUser, session: SessionDep, slug: str = Query(min_length=1, max_length=64),
                         business_id: uuid.UUID | None = None) -> dict[str, Any]:
    value = slug.strip().lower()
    if not biz.SLUG_RE.match(value):
        return {"available": False, "reason": "invalid_format"}
    if business_id is not None:
        current = await session.get(Business, business_id)
        if current is not None and current.slug == value:
            return {"available": True, "reason": "current"}
    if await biz.slug_in_use(session, value, business_id):
        return {"available": False, "reason": "taken"}
    return {"available": True, "reason": None}


@router.get("/{business_id}", response_model=BusinessOut, summary="Get a business")
async def get_business(ctx: View) -> BusinessOut:
    return business_out(ctx.business, ctx.role)


@router.get("/{business_id}/me", response_model=BusinessMeOut, summary="My role and permissions here")
async def my_permissions(ctx: View) -> BusinessMeOut:
    return BusinessMeOut(role=ctx.role, permissions=ordered(ctx.permissions))  # type: ignore[arg-type]


@router.patch("/{business_id}", response_model=BusinessOut, summary="Update business details & settings")
async def update_business(body: BusinessUpdateIn, ctx: Settings_, session: SessionDep, client: ClientDep) -> BusinessOut:
    b = ctx.business
    data = body.model_dump(exclude_unset=True)
    if "name" in data and body.name:
        b.name = body.name.strip()
    if data.get("slug") is not None:
        slug = body.slug.strip().lower()  # type: ignore[union-attr]
        if not biz.SLUG_RE.match(slug):
            raise validation_error("body.slug", "slug must be 3-48 characters of a-z, 0-9 and '-'")
        if slug != b.slug:
            if await biz.slug_in_use(session, slug, b.id):
                raise AppError(409, "slug_taken", "This slug is already used")
            old = b.slug
            await session.merge(BusinessSlugRedirect(slug=old, business_id=b.id,
                                                     expires_at=datetime.now(UTC) + timedelta(days=90)))
            b.slug = slug
    if "category" in data and body.category is not None:
        if not await biz.valid_category(session, body.category):
            raise validation_error("body.category", "unknown category (see /meta/business-categories)")
        b.category = body.category
    if "country" in data and body.country:
        if not body.country.isalpha():
            raise validation_error("body.country", "ISO-3166 alpha-2 code expected")
        b.country = body.country.upper()
    for field in ("email", "phone", "description", "website", "address"):
        if field in data:
            setattr(b, field, data[field])
    if body.settings is not None:
        current = {**biz.DEFAULT_SETTINGS, **(b.settings or {})}
        s = body.settings
        if "devices_can_register_cards" in s:
            current["devices_can_register_cards"] = bool(s["devices_can_register_cards"])
        if "default_card_action" in s:
            current["default_card_action"] = await validate_action(
                session, b.id, s["default_card_action"], "body.settings.default_card_action")
        if "timezone" in s:
            try:
                zoneinfo.ZoneInfo(str(s["timezone"]))
            except (zoneinfo.ZoneInfoNotFoundError, ValueError):
                raise validation_error("body.settings.timezone", "unknown IANA timezone") from None
            current["timezone"] = str(s["timezone"])
        b.settings = current
    audit.record(session, action="business.update", user_id=ctx.user.id, client=client, resource_type="business",
                 resource_id=b.id, metadata={"fields": sorted(data)})
    await session.commit()
    await session.refresh(b)
    return business_out(b, ctx.role)


@router.delete("/{business_id}", status_code=204, summary="Delete the business (owner only; soft delete)")
async def delete_business(ctx: Delete, session: SessionDep, client: ClientDep) -> Response:
    b = ctx.business
    now = datetime.now(UTC)
    b.deleted_at = now
    apps = (await session.execute(select(Application).where(Application.business_id == b.id))).scalars().all()
    for app in apps:
        await revoke_application_credentials(session, app)
        app.is_active = False
        app.deleted_at = app.deleted_at or now
    await session.execute(update(Profile).where(Profile.business_id == b.id).values(published=False))
    audit.record(session, action="business.delete", user_id=ctx.user.id, client=client, resource_type="business",
                 resource_id=b.id, metadata={"name": b.name})
    await session.commit()
    return Response(status_code=204)


@router.post("/{business_id}/logo", response_model=BusinessOut, summary="Upload the logo (PNG/JPEG/WebP ≤ 2 MB)")
async def upload_logo(ctx: Settings_, session: SessionDep, client: ClientDep,
                      file: UploadFile = File(...)) -> BusinessOut:
    data = await file.read(media.settings.MEDIA_MAX_UPLOAD_BYTES + 1)
    path = await run_in_threadpool(media.save_image, data, f"businesses/{ctx.business.id}", "logo")
    old = ctx.business.logo_path
    ctx.business.logo_path = path
    audit.record(session, action="business.logo_update", user_id=ctx.user.id, client=client,
                 resource_type="business", resource_id=ctx.business.id)
    await session.commit()
    media.delete_file(old)
    return business_out(ctx.business, ctx.role)


@router.get("/{business_id}/billing", response_model=BillingOut, summary="Plan, usage and limits")
async def billing(ctx: View, session: SessionDep) -> BillingOut:
    plan = await biz.business_plan(session, ctx.business)
    return BillingOut(plan=plan_out(plan), usage=await biz.business_usage(session, ctx.business.id),
                      limits=biz.plan_limits(plan), status=ctx.business.status)


@router.get("/{business_id}/overview", summary="Business dashboard overview")
async def overview(ctx: View, session: SessionDep) -> dict[str, Any]:
    bid = ctx.business.id
    now = datetime.now(UTC)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week = now - timedelta(days=7)
    cards_q = select(
        func.count().filter(Card.kind == "card"),
        func.count().filter(Card.kind == "card", Card.status == "active"),
        func.count().filter(Card.kind == "tag"),
        func.count().filter(Card.kind == "tag", Card.status == "active"),
        func.count().filter(Card.programmed_at.is_not(None)),
    ).where(Card.business_id == bid, Card.deleted_at.is_(None))
    c = (await session.execute(cards_q)).one()
    people = (await session.execute(select(
        select(func.count()).select_from(Employee).where(Employee.business_id == bid).scalar_subquery(),
        select(func.count()).select_from(Employee).where(Employee.business_id == bid, Employee.status == "active")
        .scalar_subquery(),
        select(func.count()).select_from(Customer).where(Customer.business_id == bid).scalar_subquery(),
    ))).one()
    dev = (await session.execute(
        select(func.count(), func.count().filter(Device.last_seen_at >= now - ONLINE_WINDOW))
        .select_from(Device).join(Application, Application.id == Device.application_id)
        .where(Application.business_id == bid, Device.status == "active", Device.deleted_at.is_(None))
    )).one()
    t = (await session.execute(
        select(func.count().filter(CardTap.created_at >= today), func.count().filter(CardTap.created_at >= week))
        .where(CardTap.business_id == bid, CardTap.is_bot.is_(False), CardTap.created_at >= min(today, week))
    )).one()
    recent = (await session.execute(
        select(CardTap).where(CardTap.business_id == bid).order_by(CardTap.created_at.desc()).limit(10)
    )).scalars()
    published_profile = (await session.execute(select(func.count()).select_from(Profile).where(
        Profile.business_id == bid, Profile.type == "business", Profile.published.is_(True),
        Profile.deleted_at.is_(None)))).scalar_one()
    team = (await session.execute(select(func.count()).select_from(BusinessMember).where(
        BusinessMember.business_id == bid, BusinessMember.status == "active"))).scalar_one()
    return {
        "cards": {"total": int(c[0]), "active": int(c[1])},
        "tags": {"total": int(c[2]), "active": int(c[3])},
        "employees": {"total": int(people[0]), "active": int(people[1])},
        "customers": int(people[2]),
        "devices": {"total": int(dev[0]), "online": int(dev[1])},
        "taps_today": int(t[0]),
        "taps_7d": int(t[1]),
        "recent_taps": [tap_out(x).model_dump(mode="json") for x in recent],
        "checklist": {
            "email_verified": ctx.business.verified,
            "logo_uploaded": ctx.business.logo_path is not None,
            "profile_published": published_profile > 0,
            "first_employee": int(people[0]) > 0,
            "first_card": int(c[0]) + int(c[2]) > 0,
            "card_programmed": int(c[4]) > 0,
            "device_paired": int(dev[0]) > 0,
            "team_invited": int(team) > 1,
        },
    }


@router.post("/{business_id}/applications", status_code=201, response_model=ApplicationCreatedOut,
             summary="Create a business-owned application",
             description="Same body/response as `POST /applications` (first API key + webhook secret shown once). "
                         "Needs `api.manage`; the business plan's application limit applies.")
async def create_business_application(body: ApplicationCreateIn, ctx: ApiManage, session: SessionDep,
                                      client: ClientDep) -> ApplicationCreatedOut:
    from app.api.v1.routes.applications import create_application_record

    plan = await biz.business_plan(session, ctx.business)
    if plan.max_applications is not None:
        count = (await session.execute(select(func.count()).select_from(Application).where(
            Application.business_id == ctx.business.id, Application.deleted_at.is_(None)))).scalar_one()
        if count >= plan.max_applications:
            raise AppError(402, "plan_limit_reached",
                           f"Your {plan.name} plan allows {plan.max_applications} applications.",
                           {"limit": "applications", "max": plan.max_applications, "current": int(count)})
    return await create_application_record(session, ctx.user, body, client, business_id=ctx.business.id)


@router.get("/{business_id}/applications", response_model=list[ApplicationOut], summary="Business applications")
async def business_applications(ctx: ApiView, session: SessionDep) -> list[ApplicationOut]:
    apps = list((await session.execute(
        select(Application).where(Application.business_id == ctx.business.id, Application.deleted_at.is_(None))
        .order_by(Application.created_at)
    )).scalars())
    counts = await device_counts(session, [a.id for a in apps])
    return [application_out(a, counts.get(a.id, 0)) for a in apps]


# ── Devices ─────────────────────────────────────────────────────────────
async def _business_devices(session: SessionDep, business_id: uuid.UUID, device_id: uuid.UUID | None = None,
                            status: str | None = None) -> list[BusinessDeviceOut]:
    stmt = (select(Device).join(Application, Application.id == Device.application_id)
            .where(Application.business_id == business_id, Device.deleted_at.is_(None))
            .order_by(Device.created_at.desc()))
    if device_id:
        stmt = stmt.where(Device.id == device_id)
    if status:
        stmt = stmt.where(Device.status == status)
    devices = list((await session.execute(stmt)).scalars().unique())
    ids = [d.id for d in devices]
    last_scan: dict[uuid.UUID, datetime] = {}
    employees: dict[uuid.UUID, Employee] = {}
    if ids:
        last_scan = dict((await session.execute(
            select(CardTap.device_id, func.max(CardTap.created_at)).where(CardTap.device_id.in_(ids))
            .group_by(CardTap.device_id))).all())
        emp_ids = [d.assigned_employee_id for d in devices if d.assigned_employee_id]
        if emp_ids:
            employees = {e.id: e for e in (await session.execute(
                select(Employee).where(Employee.id.in_(emp_ids)))).scalars()}
    now = datetime.now(UTC)
    out = []
    for d in devices:
        emp = employees.get(d.assigned_employee_id) if d.assigned_employee_id else None
        out.append(BusinessDeviceOut(
            **device_out(d).model_dump(),
            assigned_employee={"id": emp.id, "name": emp.full_name} if emp else None,
            last_scan_at=last_scan.get(d.id),
            online=bool(d.status == "active" and d.last_seen_at and now - d.last_seen_at <= ONLINE_WINDOW),
            business_id=business_id,
        ))
    return out


@router.get("/{business_id}/devices", response_model=list[BusinessDeviceOut], summary="Business devices")
async def business_devices(ctx: View, session: SessionDep,
                           status: Literal["active", "revoked"] | None = None) -> list[BusinessDeviceOut]:
    return await _business_devices(session, ctx.business.id, status=status)


@router.patch("/{business_id}/devices/{device_id}", response_model=BusinessDeviceOut, summary="Rename / assign a device")
async def update_business_device(device_id: uuid.UUID, body: BusinessDeviceUpdateIn, ctx: DevicesManage,
                                 session: SessionDep, client: ClientDep) -> BusinessDeviceOut:
    device = (await session.execute(
        select(Device).join(Application, Application.id == Device.application_id)
        .where(Device.id == device_id, Application.business_id == ctx.business.id, Device.deleted_at.is_(None))
    )).scalar_one_or_none()
    if device is None:
        raise not_found("Device")
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        device.name = body.name.strip()  # type: ignore[union-attr]
    if "assigned_employee_id" in data:
        if body.assigned_employee_id is not None:
            emp = await session.get(Employee, body.assigned_employee_id)
            if emp is None or emp.business_id != ctx.business.id:
                raise validation_error("body.assigned_employee_id", "employee not found in this business")
        device.assigned_employee_id = body.assigned_employee_id
    audit.record(session, action="device.update", user_id=ctx.user.id, client=client, resource_type="device",
                 resource_id=device.id, metadata={k: str(v) for k, v in data.items()})
    await session.commit()
    return (await _business_devices(session, ctx.business.id, device.id))[0]


@router.get("/{business_id}/devices/{device_id}/activity", summary="Device activity (taps + request logs)")
async def device_activity(device_id: uuid.UUID, ctx: View, session: SessionDep) -> dict[str, Any]:
    devices = await _business_devices(session, ctx.business.id, device_id)
    if not devices:
        raise not_found("Device")
    taps_rows = (await session.execute(
        select(CardTap).where(CardTap.business_id == ctx.business.id, CardTap.device_id == device_id)
        .order_by(CardTap.created_at.desc()).limit(50))).scalars()
    logs: list[RequestLogOut] = []
    if ctx.has("api.view"):
        logs = [request_log_out(r) for r in (await session.execute(
            select(RequestLog).where(RequestLog.device_id == device_id, RequestLog.business_id == ctx.business.id)
            .order_by(RequestLog.created_at.desc()).limit(50))).scalars()]
    return {
        "device": devices[0].model_dump(mode="json"),
        "taps": [CardTapOut.model_validate(tap_out(t)).model_dump(mode="json") for t in taps_rows],
        "request_logs": [r.model_dump(mode="json") for r in logs],
    }


@router.get("/{business_id}/api-usage", summary="API usage from request logs")
async def api_usage(ctx: ApiView, session: SessionDep,
                    range: Literal["1h", "24h", "7d", "30d"] = Query(default="7d")) -> dict[str, Any]:
    since = datetime.now(UTC) - RANGES[range]
    base = [RequestLog.business_id == ctx.business.id, RequestLog.created_at >= since]
    is_err = case((RequestLog.status_code >= 400, 1), else_=0)
    totals = (await session.execute(select(func.count(), func.coalesce(func.sum(is_err), 0)).where(*base))).one()
    by_route = (await session.execute(
        select(RequestLog.route, func.count(), func.sum(is_err),
               func.percentile_cont(0.95).within_group(RequestLog.latency_ms))
        .where(*base).group_by(RequestLog.route).order_by(func.count().desc()).limit(20))).all()
    by_device = (await session.execute(
        select(RequestLog.device_id, func.count(), func.sum(is_err)).where(*base, RequestLog.device_id.is_not(None))
        .group_by(RequestLog.device_id).order_by(func.count().desc()).limit(50))).all()
    by_key = (await session.execute(
        select(RequestLog.actor_id, func.count(), func.sum(is_err))
        .where(*base, RequestLog.actor_type == "api_key").group_by(RequestLog.actor_id)
        .order_by(func.count().desc()).limit(50))).all()
    names = {}
    if by_device:
        names = dict((await session.execute(
            select(Device.id, Device.name).where(Device.id.in_([r[0] for r in by_device])))).all())
    total, errors = int(totals[0]), int(totals[1])
    return {
        "range": range,
        "totals": {"requests": total, "errors": errors, "error_rate": round(errors / total, 4) if total else 0.0},
        "by_route": [{"route": r[0], "count": int(r[1]), "error_rate": round(int(r[2] or 0) / int(r[1]), 4),
                      "p95_ms": int(r[3] or 0)} for r in by_route],
        "by_device": [{"device_id": str(r[0]), "name": names.get(r[0]), "count": int(r[1]),
                       "errors": int(r[2] or 0)} for r in by_device],
        "by_api_key": [{"api_key_id": str(r[0]) if r[0] else None, "count": int(r[1]),
                        "errors": int(r[2] or 0)} for r in by_key],
    }
