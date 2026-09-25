"""Admin console (Part 2 §A5). All endpoints require role=admin; mutations are audited (`admin.*`)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import Field
from sqlalchemy import case, func, literal_column, or_, select, text

from app.api.deps import AdminUser, ClientDep, PaginationDep, SessionDep
from app.api.v1.routes.request_logs import filter_conditions, paginate
from app.core.config import VERSION, settings
from app.core.error_catalog import ref_for
from app.core.errors import AppError, not_found, validation_error
from app.core.redis import get_redis, redis_ok
from app.models import (
    ApiKey,
    Application,
    AuditLog,
    Business,
    BusinessMember,
    Card,
    CardTap,
    Delivery,
    Device,
    NfcEvent,
    Plan,
    RequestLog,
    Subscription,
    User,
)
from app.schemas.business import RequestLogOut
from app.schemas.common import Page, Schema
from app.services import audit, delivery, platform_settings, request_logs
from app.services.business_serializers import business_out, request_log_out
from app.services.serializers import api_key_out, application_out, audit_out, delivery_out, device_out, user_out

router = APIRouter(prefix="/admin", tags=["Admin"])

RANGES = {"1h": (timedelta(hours=1), "5 minutes"), "24h": (timedelta(hours=24), "1 hour"),
          "7d": (timedelta(days=7), "6 hours"), "30d": (timedelta(days=30), "1 day")}
ONLINE = timedelta(minutes=2)


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


async def _scalar(session: SessionDep, stmt) -> int:  # type: ignore[no-untyped-def]
    return int((await session.execute(stmt)).scalar_one() or 0)


# ── Overview ────────────────────────────────────────────────────────────
@router.get("/overview", summary="Platform overview")
async def overview(admin: AdminUser, session: SessionDep,
                   range: Literal["1h", "24h", "7d", "30d"] = Query(default="24h")) -> dict[str, Any]:
    span, bin_size = RANGES[range]
    now = datetime.now(UTC)
    since = now - span
    u = (await session.execute(select(
        func.count(),
        func.count().filter(User.account_type == "developer"),
        func.count().filter(User.account_type == "business"),
        func.count().filter(User.created_at >= since),
    ))).one()
    active_24h = await _scalar(session, select(func.count(func.distinct(RequestLog.user_id))).where(
        RequestLog.created_at >= now - timedelta(hours=24), RequestLog.actor_type == "user"))
    d = (await session.execute(select(
        func.count(),
        func.count().filter(Device.status == "active", Device.last_seen_at >= now - ONLINE),
        func.count().filter(Device.status == "active", or_(Device.last_seen_at.is_(None),
                                                           Device.last_seen_at < now - ONLINE)),
        func.count().filter(Device.status == "revoked"),
    ).where(Device.deleted_at.is_(None)))).one()
    counts = (await session.execute(select(
        select(func.count()).select_from(Business).where(Business.deleted_at.is_(None)).scalar_subquery(),
        select(func.count()).select_from(Application).where(Application.deleted_at.is_(None)).scalar_subquery(),
        select(func.count()).select_from(NfcEvent).where(NfcEvent.received_at >= since).scalar_subquery(),
        select(func.count()).select_from(CardTap).where(CardTap.created_at >= since, CardTap.is_bot.is_(False))
        .scalar_subquery(),
    ))).one()
    r = (await session.execute(select(
        func.count(),
        func.count().filter(RequestLog.outcome == "success"),
        func.count().filter(RequestLog.outcome == "client_error"),
        func.count().filter(RequestLog.outcome == "server_error"),
        func.percentile_cont(0.5).within_group(RequestLog.latency_ms),
        func.percentile_cont(0.95).within_group(RequestLog.latency_ms),
        func.percentile_cont(0.99).within_group(RequestLog.latency_ms),
        func.count().filter(RequestLog.created_at >= now - timedelta(minutes=1)),
    ).where(RequestLog.created_at >= since))).one()
    dl = (await session.execute(select(func.count(), func.count().filter(Delivery.success.is_(True)))
                                .where(Delivery.created_at >= since))).one()
    top_errors = (await session.execute(
        select(RequestLog.error_code, func.count()).where(RequestLog.created_at >= since,
                                                          RequestLog.error_code.is_not(None))
        .group_by(RequestLog.error_code).order_by(func.count().desc()).limit(10))).all()
    is_err = case((RequestLog.status_code >= 400, 1), else_=0)
    top_routes = (await session.execute(
        select(RequestLog.route, func.count(), func.sum(is_err),
               func.percentile_cont(0.95).within_group(RequestLog.latency_ms))
        .where(RequestLog.created_at >= since).group_by(RequestLog.route)
        .order_by(func.count().desc()).limit(10))).all()
    bucket = func.date_bin(text(f"interval '{bin_size}'"), RequestLog.created_at, text("timestamptz '2000-01-01'"))
    req_tl = (await session.execute(
        select(bucket.label("b"), func.count(), func.sum(is_err),
               func.percentile_cont(0.95).within_group(RequestLog.latency_ms))
        .where(RequestLog.created_at >= since).group_by(literal_column("b")))).all()
    ev_bucket = func.date_bin(text(f"interval '{bin_size}'"), NfcEvent.received_at, text("timestamptz '2000-01-01'"))
    ev_tl = dict((await session.execute(
        select(ev_bucket.label("b"), func.count()).where(NfcEvent.received_at >= since)
        .group_by(literal_column("b")))).all())
    buckets = sorted({row[0] for row in req_tl} | set(ev_tl))
    req_map = {row[0]: row for row in req_tl}
    total, errors = int(r[0]), int(r[2]) + int(r[3])
    queue_depth = 0
    try:
        queue_depth = int(await get_redis().zcard(delivery.QUEUE_KEY))
    except Exception:
        pass
    return {
        "range": range,
        "users": {"total": int(u[0]), "developers": int(u[1]), "businesses": int(u[2]), "active_24h": active_24h,
                  "new_in_range": int(u[3])},
        "businesses": int(counts[0]),
        "applications": int(counts[1]),
        "devices": {"total": int(d[0]), "online": int(d[1]), "offline": int(d[2]), "revoked": int(d[3])},
        "events_in_range": int(counts[2]),
        "taps_in_range": int(counts[3]),
        "requests": {"total": total, "success": int(r[1]), "client_error": int(r[2]), "server_error": int(r[3]),
                     "error_rate": round(errors / total, 4) if total else 0.0,
                     "p50_ms": int(r[4] or 0), "p95_ms": int(r[5] or 0), "p99_ms": int(r[6] or 0),
                     "rpm_now": int(r[7])},
        "deliveries": {"total": int(dl[0]), "succeeded": int(dl[1]), "failed": int(dl[0]) - int(dl[1]),
                       "success_rate": round(int(dl[1]) / int(dl[0]), 4) if dl[0] else 0.0,
                       "queue_depth": queue_depth},
        "top_errors": [{"error_code": e[0], "error_ref": ref_for(e[0]), "count": int(e[1])} for e in top_errors],
        "top_routes": [{"route": t[0], "count": int(t[1]), "error_rate": round(int(t[2] or 0) / int(t[1]), 4),
                        "p95_ms": int(t[3] or 0)} for t in top_routes],
        "timeline": [{"bucket": _iso(b), "requests": int(req_map[b][1]) if b in req_map else 0,
                      "errors": int(req_map[b][2] or 0) if b in req_map else 0,
                      "p95_ms": int(req_map[b][3] or 0) if b in req_map else 0,
                      "events": int(ev_tl.get(b, 0))} for b in buckets],
    }


# ── Request logs ────────────────────────────────────────────────────────
@router.get("/request-logs", response_model=Page[RequestLogOut], summary="All request logs")
async def admin_request_logs(
    admin: AdminUser, session: SessionDep, pagination: PaginationDep,
    status: int | None = Query(default=None, ge=100, le=599),
    outcome: Literal["success", "client_error", "server_error"] | None = None,
    route: str | None = Query(default=None, max_length=200), error_code: str | None = Query(default=None, max_length=64),
    application_id: uuid.UUID | None = None, device_id: uuid.UUID | None = None,
    date_from: datetime | None = None, date_to: datetime | None = None,
    request_id: str | None = Query(default=None, max_length=64), user_id: uuid.UUID | None = None,
    business_id: uuid.UUID | None = None,
    actor_type: Literal["user", "api_key", "device", "pairing_code", "public", "anonymous"] | None = None,
    min_latency_ms: int | None = Query(default=None, ge=0),
) -> Page[RequestLogOut]:
    conds = filter_conditions(status=status, outcome=outcome, route=route, error_code=error_code,
                              application_id=application_id, device_id=device_id, date_from=date_from,
                              date_to=date_to, request_id=request_id, user_id=user_id, business_id=business_id,
                              actor_type=actor_type, min_latency_ms=min_latency_ms)
    return await paginate(session, conds, pagination)


@router.get("/request-logs/{log_id}", response_model=RequestLogOut, summary="One request log")
async def admin_request_log(log_id: uuid.UUID, admin: AdminUser, session: SessionDep) -> RequestLogOut:
    row = await session.get(RequestLog, log_id)
    if row is None:
        raise not_found("Request log")
    return request_log_out(row)


# ── Accounts ────────────────────────────────────────────────────────────
async def _owned_business(session: SessionDep, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, Business]:
    if not user_ids:
        return {}
    rows = (await session.execute(
        select(BusinessMember.user_id, Business).join(Business, Business.id == BusinessMember.business_id)
        .where(BusinessMember.user_id.in_(user_ids), BusinessMember.role == "owner", Business.deleted_at.is_(None))
        .order_by(Business.created_at))).all()
    out: dict[uuid.UUID, Business] = {}
    for uid, b in rows:
        out.setdefault(uid, b)
    return out


async def _account_stats(session: SessionDep, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    if not ids:
        return {}
    now = datetime.now(UTC)
    req = {r[0]: r for r in (await session.execute(
        select(RequestLog.user_id, func.count(), func.count().filter(RequestLog.status_code >= 400),
               func.max(RequestLog.created_at))
        .where(RequestLog.user_id.in_(ids), RequestLog.created_at >= now - timedelta(hours=24))
        .group_by(RequestLog.user_id))).all()}
    last = dict((await session.execute(select(RequestLog.user_id, func.max(RequestLog.created_at))
                                       .where(RequestLog.user_id.in_(ids)).group_by(RequestLog.user_id))).all())
    events = dict((await session.execute(select(NfcEvent.owner_id, func.count()).where(
        NfcEvent.owner_id.in_(ids), NfcEvent.received_at >= now - timedelta(days=30)).group_by(NfcEvent.owner_id))).all())
    devices = dict((await session.execute(select(Device.owner_id, func.count()).where(
        Device.owner_id.in_(ids), Device.status == "active", Device.deleted_at.is_(None))
        .group_by(Device.owner_id))).all())
    apps = dict((await session.execute(select(Application.owner_id, func.count()).where(
        Application.owner_id.in_(ids), Application.deleted_at.is_(None)).group_by(Application.owner_id))).all())
    out = {}
    for i in ids:
        r = req.get(i)
        total = int(r[1]) if r else 0
        out[i] = {"requests_24h": total, "error_rate_24h": round(int(r[2]) / total, 4) if total else 0.0,
                  "events_30d": int(events.get(i, 0)), "devices": int(devices.get(i, 0)),
                  "applications": int(apps.get(i, 0)), "last_active_at": _iso(last.get(i))}
    return out


def _account_row(user: User, business: Business | None, stats: dict[str, Any]) -> dict[str, Any]:
    data = user_out(user).model_dump(mode="json")
    if business is not None and business.plan is not None:
        data["plan"] = business.plan.code
    data["business"] = ({"id": str(business.id), "name": business.name, "status": business.status}
                        if business else None)
    data["stats"] = stats
    data["last_login_at"] = _iso(user.last_login_at)
    return data


@router.get("/accounts", summary="All accounts with stats")
async def list_accounts(admin: AdminUser, session: SessionDep, pagination: PaginationDep,
                        type: Literal["developer", "business"] | None = None,
                        q: str | None = Query(default=None, max_length=100),
                        status: Literal["active", "inactive"] | None = None) -> dict[str, Any]:
    conds = []
    if type:
        conds.append(User.account_type == type)
    if status:
        conds.append(User.is_active.is_(status == "active"))
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(User.email.ilike(like), User.full_name.ilike(like)))
    total = await _scalar(session, select(func.count()).select_from(User).where(*conds))
    users = list((await session.execute(select(User).where(*conds).order_by(User.created_at.desc(), User.id)
                                        .offset(pagination.offset).limit(pagination.page_size))).scalars())
    ids = [u.id for u in users]
    businesses = await _owned_business(session, ids)
    stats = await _account_stats(session, ids)
    return {"items": [_account_row(u, businesses.get(u.id), stats[u.id]) for u in users], "total": total,
            "page": pagination.page, "page_size": pagination.page_size}


@router.get("/accounts/{user_id}", summary="Account detail")
async def get_account(user_id: uuid.UUID, admin: AdminUser, session: SessionDep) -> dict[str, Any]:
    user = await session.get(User, user_id)
    if user is None:
        raise not_found("Account")
    business = (await _owned_business(session, [user.id])).get(user.id)
    data = _account_row(user, business, (await _account_stats(session, [user.id]))[user.id])
    apps = (await session.execute(select(Application).where(Application.owner_id == user.id)
                                  .order_by(Application.created_at.desc()))).scalars().all()
    devices = (await session.execute(select(Device).where(Device.owner_id == user.id)
                                     .order_by(Device.created_at.desc()).limit(200))).scalars().unique().all()
    logs = (await session.execute(select(RequestLog).where(RequestLog.user_id == user.id)
                                  .order_by(RequestLog.created_at.desc()).limit(25))).scalars()
    audits = (await session.execute(select(AuditLog).where(AuditLog.user_id == user.id)
                                    .order_by(AuditLog.created_at.desc()).limit(25))).scalars()
    data["applications"] = [application_out(a).model_dump(mode="json") | {"business_id": str(a.business_id)
                                                                           if a.business_id else None,
                                                                           "deleted": a.deleted_at is not None}
                            for a in apps]
    data["devices"] = [device_out(d).model_dump(mode="json") for d in devices]
    data["recent_request_logs"] = [request_log_out(r).model_dump(mode="json") for r in logs]
    data["audit_logs"] = [audit_out(a).model_dump(mode="json") for a in audits]
    # Part 3 §4
    from app.models import EmailLog

    email_logs = (await session.execute(select(EmailLog).where(EmailLog.user_id == user.id)
                                        .order_by(EmailLog.created_at.desc()).limit(20))).scalars()
    data["email_logs"] = [{"id": str(e.id), "template": e.template, "subject": e.subject, "status": e.status,
                           "created_at": _iso(e.created_at), "sent_at": _iso(e.sent_at)} for e in email_logs]
    logins = (await session.execute(select(AuditLog).where(AuditLog.user_id == user.id, AuditLog.action == "user.login")
                                    .order_by(AuditLog.created_at.desc()).limit(10))).scalars()
    data["recent_logins"] = [{"at": _iso(a.created_at), "ip_address": a.ip_address, "user_agent": a.user_agent}
                             for a in logins]
    return data


class AccountPatch(Schema):
    is_active: bool | None = None
    role: Literal["developer", "admin"] | None = None
    plan_code: str | None = Field(default=None, max_length=32)
    email_verified: bool | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    company: str | None = Field(default=None, max_length=160)
    country: str | None = Field(default=None, max_length=2)
    job_title: str | None = Field(default=None, max_length=120)


@router.patch("/accounts/{user_id}", summary="Update an account")
async def patch_account(user_id: uuid.UUID, body: AccountPatch, admin: AdminUser, session: SessionDep,
                        client: ClientDep) -> dict[str, Any]:
    from app.api.v1.routes.auth import mark_email_verified

    user = await session.get(User, user_id)
    if user is None:
        raise not_found("Account")
    if user.id == admin.id and (body.is_active is False or body.role == "developer"):
        raise AppError(400, "cannot_deactivate_self", "You cannot deactivate or demote your own account")
    data = body.model_dump(exclude_unset=True)
    if data.get("country"):
        if len(data["country"]) != 2 or not data["country"].isalpha():
            raise validation_error("body.country", "ISO-3166 alpha-2 code expected")
        data["country"] = data["country"].upper()
    from app.api.v1.routes.auth import apply_profile

    apply_profile(user, {k: v for k, v in data.items()
                         if k in ("full_name", "phone", "company", "country", "job_title")})
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.role is not None:
        user.role = body.role
    if body.email_verified is not None:
        if body.email_verified:
            await mark_email_verified(session, user, datetime.now(UTC))
        else:
            user.email_verified, user.email_verified_at = False, None
    if body.plan_code:
        plan = (await session.execute(select(Plan).where(Plan.code == body.plan_code))).scalar_one_or_none()
        if plan is None:
            raise AppError(422, "invalid_plan", "Unknown plan code")
        if plan.audience == "business":
            business = (await _owned_business(session, [user.id])).get(user.id)
            if business is None:
                raise AppError(422, "invalid_plan", "This account owns no business")
            business.plan_id = plan.id
            business.plan = plan
        else:
            sub = (await session.execute(select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
            if sub is not None:
                sub.plan_id = plan.id
                sub.plan = plan
    audit.record(session, action="admin.account_update", user_id=admin.id, client=client, resource_type="user",
                 resource_id=user.id, metadata=data)
    await session.commit()
    return await get_account(user.id, admin, session)


# ── Businesses ──────────────────────────────────────────────────────────
async def _business_rows(session: SessionDep, businesses: list[Business]) -> list[dict[str, Any]]:
    ids = [b.id for b in businesses]
    if not ids:
        return []
    now = datetime.now(UTC)
    members = dict((await session.execute(select(BusinessMember.business_id, func.count()).where(
        BusinessMember.business_id.in_(ids), BusinessMember.status == "active").group_by(BusinessMember.business_id))).all())
    cards = dict((await session.execute(select(Card.business_id, func.count()).where(
        Card.business_id.in_(ids), Card.deleted_at.is_(None)).group_by(Card.business_id))).all())
    devices = dict((await session.execute(
        select(Application.business_id, func.count()).select_from(Device)
        .join(Application, Application.id == Device.application_id)
        .where(Application.business_id.in_(ids), Device.status == "active", Device.deleted_at.is_(None))
        .group_by(Application.business_id))).all())
    taps = dict((await session.execute(select(CardTap.business_id, func.count()).where(
        CardTap.business_id.in_(ids), CardTap.created_at >= now - timedelta(days=30), CardTap.is_bot.is_(False))
        .group_by(CardTap.business_id))).all())
    owners = dict((await session.execute(
        select(BusinessMember.business_id, User.email).join(User, User.id == BusinessMember.user_id)
        .where(BusinessMember.business_id.in_(ids), BusinessMember.role == "owner")
        .order_by(BusinessMember.joined_at))).all())
    return [business_out(b).model_dump(mode="json") | {
        "owner_email": owners.get(b.id), "deleted": b.deleted_at is not None,
        "stats": {"members": int(members.get(b.id, 0)), "cards": int(cards.get(b.id, 0)),
                  "devices": int(devices.get(b.id, 0)), "taps_30d": int(taps.get(b.id, 0))},
    } for b in businesses]


@router.get("/businesses", summary="All businesses")
async def list_businesses(admin: AdminUser, session: SessionDep, pagination: PaginationDep,
                          q: str | None = Query(default=None, max_length=100),
                          status: Literal["active", "suspended"] | None = None) -> dict[str, Any]:
    conds = [Business.deleted_at.is_(None)]
    if status:
        conds.append(Business.status == status)
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(Business.name.ilike(like), Business.slug.ilike(like), Business.email.ilike(like)))
    total = await _scalar(session, select(func.count()).select_from(Business).where(*conds))
    rows = list((await session.execute(select(Business).where(*conds).order_by(Business.created_at.desc(), Business.id)
                                       .offset(pagination.offset).limit(pagination.page_size))).scalars().unique())
    return {"items": await _business_rows(session, rows), "total": total, "page": pagination.page,
            "page_size": pagination.page_size}


@router.get("/businesses/{business_id}", summary="Business detail")
async def get_business(business_id: uuid.UUID, admin: AdminUser, session: SessionDep) -> dict[str, Any]:
    b = await session.get(Business, business_id)
    if b is None:
        raise not_found("Business")
    data = (await _business_rows(session, [b]))[0]
    members = (await session.execute(select(BusinessMember, User).join(User, User.id == BusinessMember.user_id)
                                     .where(BusinessMember.business_id == b.id))).all()
    data["members"] = [{"id": str(m.id), "user_id": str(u.id), "email": u.email, "full_name": u.full_name,
                        "role": m.role, "status": m.status} for m, u in members]
    apps = (await session.execute(select(Application).where(Application.business_id == b.id))).scalars().all()
    data["applications"] = [application_out(a).model_dump(mode="json") for a in apps]
    return data


class BusinessPatch(Schema):
    status: Literal["active", "suspended"] | None = None
    plan_code: str | None = Field(default=None, max_length=32)


@router.patch("/businesses/{business_id}", summary="Suspend / reactivate / change plan")
async def patch_business(business_id: uuid.UUID, body: BusinessPatch, admin: AdminUser, session: SessionDep,
                         client: ClientDep) -> dict[str, Any]:
    b = await session.get(Business, business_id)
    if b is None:
        raise not_found("Business")
    if body.status is not None:
        b.status = body.status
    if body.plan_code:
        plan = (await session.execute(select(Plan).where(Plan.code == body.plan_code))).scalar_one_or_none()
        if plan is None or plan.audience != "business":
            raise AppError(422, "invalid_plan", "Unknown business plan code")
        b.plan_id = plan.id
        b.plan = plan
    audit.record(session, action="admin.business_update", user_id=admin.id, client=client, resource_type="business",
                 resource_id=b.id, metadata=body.model_dump(exclude_unset=True))
    await session.commit()
    await session.refresh(b)
    return await get_business(b.id, admin, session)


# ── Devices, keys, deliveries ───────────────────────────────────────────
@router.get("/devices", summary="All devices")
async def list_devices(admin: AdminUser, session: SessionDep, pagination: PaginationDep,
                       status: Literal["active", "revoked"] | None = None, online: bool | None = None,
                       q: str | None = Query(default=None, max_length=100)) -> dict[str, Any]:
    now = datetime.now(UTC)
    conds = [Device.deleted_at.is_(None)]
    if status:
        conds.append(Device.status == status)
    if online is True:
        conds += [Device.status == "active", Device.last_seen_at >= now - ONLINE]
    elif online is False:
        conds.append(or_(Device.status != "active", Device.last_seen_at.is_(None), Device.last_seen_at < now - ONLINE))
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(Device.name.ilike(like), Device.model.ilike(like)))
    total = await _scalar(session, select(func.count()).select_from(Device).where(*conds))
    rows = (await session.execute(
        select(Device, User.email, Business.id, Business.name)
        .join(User, User.id == Device.owner_id).join(Application, Application.id == Device.application_id)
        .outerjoin(Business, Business.id == Application.business_id)
        .where(*conds).order_by(Device.last_seen_at.desc().nulls_last(), Device.id)
        .offset(pagination.offset).limit(pagination.page_size))).unique().all()
    items = [device_out(dev).model_dump(mode="json") | {
        "owner": {"id": str(dev.owner_id), "email": email},
        "business": {"id": str(bid), "name": bname} if bid else None,
        "online": bool(dev.status == "active" and dev.last_seen_at and now - dev.last_seen_at <= ONLINE),
    } for dev, email, bid, bname in rows]
    return {"items": items, "total": total, "page": pagination.page, "page_size": pagination.page_size}


@router.post("/devices/{device_id}/revoke", summary="Revoke any device")
async def revoke_device(device_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    dev = await session.get(Device, device_id)
    if dev is None:
        raise not_found("Device")
    if dev.status != "revoked":
        dev.status, dev.revoked_at = "revoked", datetime.now(UTC)
        audit.record(session, action="admin.device_revoke", user_id=admin.id, client=client, resource_type="device",
                     resource_id=dev.id, metadata={"owner_id": str(dev.owner_id)})
        await session.commit()
    return device_out(dev).model_dump(mode="json")


@router.post("/api-keys/{key_id}/revoke", summary="Revoke any API key")
async def revoke_api_key(key_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    key = await session.get(ApiKey, key_id)
    if key is None:
        raise not_found("API key")
    if key.revoked_at is None:
        key.revoked_at = datetime.now(UTC)
        audit.record(session, action="admin.api_key_revoke", user_id=admin.id, client=client,
                     resource_type="api_key", resource_id=key.id, metadata={"owner_id": str(key.owner_id)})
        await session.commit()
    return api_key_out(key).model_dump(mode="json")


@router.get("/deliveries", summary="All delivery attempts")
async def list_deliveries(admin: AdminUser, session: SessionDep, pagination: PaginationDep,
                          success: bool | None = None,
                          error_code: str | None = Query(default=None, max_length=64)) -> dict[str, Any]:
    conds = []
    if success is not None:
        conds.append(Delivery.success.is_(success))
    if error_code:
        conds.append(Delivery.error_code == error_code)
    total = await _scalar(session, select(func.count()).select_from(Delivery).where(*conds))
    rows = (await session.execute(select(Delivery).where(*conds).order_by(Delivery.created_at.desc(), Delivery.id)
                                  .offset(pagination.offset).limit(pagination.page_size))).scalars()
    return {"items": [delivery_out(d).model_dump(mode="json") for d in rows], "total": total,
            "page": pagination.page, "page_size": pagination.page_size}


# ── System & settings ───────────────────────────────────────────────────
@router.get("/system", summary="System health")
async def system(admin: AdminUser, session: SessionDep) -> dict[str, Any]:
    try:
        await session.execute(text("SELECT 1"))
        db = "ok"
    except Exception:
        db = "error"
    r_ok = await redis_ok()
    heartbeat, depth = None, None
    if r_ok:
        try:
            heartbeat = await get_redis().get(delivery.WORKER_HEARTBEAT_KEY)
            depth = int(await get_redis().zcard(delivery.QUEUE_KEY))
        except Exception:
            pass
    alive = False
    if heartbeat:
        try:
            alive = datetime.now(UTC) - datetime.fromisoformat(heartbeat) < timedelta(seconds=60)
        except ValueError:
            alive = False
    return {
        "database": db, "redis": "ok" if r_ok else "error",
        "worker": {"alive": alive, "last_heartbeat_at": heartbeat, "in_process": settings.DELIVERY_WORKER_ENABLED},
        "delivery_queue_depth": depth, "request_log_buffer_depth": await request_logs.buffer_depth(),
        "version": VERSION, "environment": settings.ENVIRONMENT,
    }


@router.get("/settings", summary="Platform settings")
async def get_settings(admin: AdminUser) -> dict[str, Any]:
    await platform_settings.reload()
    return platform_settings.effective()


class RateLimitPatch(Schema):
    requests: int = Field(ge=1, le=100_000)
    window_seconds: int = Field(ge=1, le=3600)


class SettingsPatch(Schema):
    signups_enabled: dict[str, bool] | None = None
    request_log_retention_days: int | None = Field(default=None, ge=1, le=3650)
    default_rate_limit: RateLimitPatch | None = None
    maintenance_message: str | None = Field(default=None, max_length=500)


@router.patch("/settings", summary="Update platform settings")
async def patch_settings(body: SettingsPatch, admin: AdminUser, session: SessionDep, client: ClientDep,
                         request: Request) -> dict[str, Any]:
    raw = await request.json()
    patch: dict[str, Any] = {}
    if body.signups_enabled is not None:
        bad = [k for k in body.signups_enabled if k not in ("developer", "business")]
        if bad:
            raise validation_error("body.signups_enabled", "keys must be developer and/or business")
        patch["signups_enabled"] = body.signups_enabled
    if body.request_log_retention_days is not None:
        patch["request_log_retention_days"] = body.request_log_retention_days
    if "default_rate_limit" in raw:
        patch["default_rate_limit"] = body.default_rate_limit.model_dump() if body.default_rate_limit else None
    if "maintenance_message" in raw:
        patch["maintenance_message"] = (body.maintenance_message or "").strip() or None
    result = await platform_settings.save(session, patch, admin.id)
    audit.record(session, action="admin.settings_update", user_id=admin.id, client=client,
                 resource_type="platform_settings", resource_id="platform", metadata=patch)
    await session.commit()
    return result
