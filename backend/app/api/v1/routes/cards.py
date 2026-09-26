"""NFC cards & tags, actions, taps and analytics (Part 2 §B4, §B5, §B7)."""

from __future__ import annotations

import uuid
import zoneinfo
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import Date, and_, cast, distinct, extract, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import BusinessContext, ClientDep, PaginationDep, SessionDep, business_permission
from app.core.errors import AppError, not_found, validation_error
from app.models import Card, CardHistory, CardTap, Customer, Employee, Profile, User
from app.schemas.business import (
    ActionPreviewIn,
    ActionPreviewOut,
    AssignIn,
    CardIn,
    CardOut,
    CardTapOut,
    CardUpdateIn,
)
from app.schemas.common import Page
from app.schemas.device_api import CARD_ID_RE, normalize_card_id
from app.services import audit
from app.services import business as biz
from app.services.actions import resolve, validate_action
from app.services.business_serializers import card_out, tap_out

router = APIRouter(prefix="/businesses/{business_id}", tags=["Cards & taps"])

View = Annotated[BusinessContext, Depends(business_permission("business.view"))]
Manage = Annotated[BusinessContext, Depends(business_permission("cards.manage"))]
Analytics = Annotated[BusinessContext, Depends(business_permission("analytics.view"))]

RANGE_DAYS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}


def normalize_uid(raw: str | None, field: str = "body.uid") -> str | None:
    if raw is None or raw.strip() == "":
        return None
    uid = normalize_card_id(raw)
    if not CARD_ID_RE.match(uid):
        raise validation_error(field, "uid must be 4-64 hex characters (separators ':' and ' ' allowed)")
    return uid


async def ensure_uid_free(session: SessionDep, business_id: uuid.UUID, uid: str | None,
                          exclude: uuid.UUID | None = None) -> None:
    if uid is None:
        return
    stmt = select(Card.id).where(Card.business_id == business_id, Card.uid == uid, Card.deleted_at.is_(None))
    if exclude:
        stmt = stmt.where(Card.id != exclude)
    if (await session.execute(stmt)).first():
        raise AppError(409, "card_uid_exists", "Another card of this business already uses this UID")


async def unique_public_code(session: SessionDep) -> str:
    for _ in range(10):
        code = biz.generate_public_code()
        if not (await session.execute(select(Card.id).where(Card.public_code == code))).first():
            return code
    raise RuntimeError("could not allocate a public code")  # pragma: no cover


def history(session: SessionDep, card: Card, type_: str, *, user: User | None = None, device_id: uuid.UUID | None = None,
            **data: Any) -> None:
    session.add(CardHistory(card_id=card.id, business_id=card.business_id, type=type_,
                            actor_user_id=user.id if user else None, actor_device_id=device_id,
                            data={k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in data.items()}))


async def _get_card(session: SessionDep, business_id: uuid.UUID, card_id: uuid.UUID) -> Card:
    card = (await session.execute(select(Card).where(Card.id == card_id, Card.business_id == business_id,
                                                     Card.deleted_at.is_(None)))).scalar_one_or_none()
    if card is None:
        raise not_found("Card")
    return card


async def _reload(session: SessionDep, card_id: uuid.UUID) -> Card:
    return (await session.execute(select(Card).where(Card.id == card_id)
                                  .execution_options(populate_existing=True))).scalar_one()


async def _assignee(session: SessionDep, business_id: uuid.UUID, type_: str | None, ident: uuid.UUID | None,
                    prefix: str = "body") -> tuple[uuid.UUID | None, uuid.UUID | None, bool]:
    """(employee_id, customer_id, assigned_to_business) — at most one is set."""
    if type_ == "business":  # the company itself: no id, or the business's own id
        if ident is not None and ident != business_id:
            raise validation_error(f"{prefix}.assignee_id", "for assignee_type business, omit assignee_id or pass "
                                                             "this business's id")
        return None, None, True
    if type_ is None and ident is None:
        return None, None, False
    if type_ is None or ident is None:
        raise validation_error(f"{prefix}.assignee_id", "assignee_type and assignee_id go together")
    model = Employee if type_ == "employee" else Customer
    obj = await session.get(model, ident)
    if obj is None or obj.business_id != business_id:
        raise validation_error(f"{prefix}.assignee_id", f"{type_} not found in this business")
    return (ident, None, False) if type_ == "employee" else (None, ident, False)


def _assignee_ref(card: Card) -> tuple[str | None, uuid.UUID | None]:
    if card.assigned_to_business:
        return "business", card.business_id
    if card.employee_id:
        return "employee", card.employee_id
    if card.customer_id:
        return "customer", card.customer_id
    return None, None


async def _check_profile(session: SessionDep, business_id: uuid.UUID, profile_id: uuid.UUID | None) -> None:
    if profile_id is None:
        return
    p = await session.get(Profile, profile_id)
    if p is None or p.business_id != business_id or p.deleted_at is not None:
        raise validation_error("body.profile_id", "profile not found in this business")


# ── Cards CRUD ──────────────────────────────────────────────────────────
@router.get("/cards", response_model=Page[CardOut], summary="List cards & tags")
async def list_cards(ctx: View, session: SessionDep, pagination: PaginationDep,
                     kind: Literal["card", "tag"] | None = None,
                     status: Literal["active", "inactive"] | None = None,
                     assignee_type: Literal["employee", "customer", "business", "none"] | None = None,
                     programmed: bool | None = None,
                     q: str | None = Query(default=None, max_length=100)) -> Page[CardOut]:
    conds = [Card.business_id == ctx.business.id, Card.deleted_at.is_(None)]
    if kind:
        conds.append(Card.kind == kind)
    if status:
        conds.append(Card.status == status)
    if assignee_type == "employee":
        conds.append(Card.employee_id.is_not(None))
    elif assignee_type == "customer":
        conds.append(Card.customer_id.is_not(None))
    elif assignee_type == "business":
        conds.append(Card.assigned_to_business.is_(True))
    elif assignee_type == "none":
        conds.append(and_(Card.employee_id.is_(None), Card.customer_id.is_(None),
                          Card.assigned_to_business.is_(False)))
    if programmed is not None:
        conds.append(Card.programmed_at.is_not(None) if programmed else Card.programmed_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(Card.name.ilike(like), Card.public_code == q.strip(),
                         Card.uid == normalize_card_id(q),
                         Card.employee_id.in_(select(Employee.id).where(
                             Employee.business_id == ctx.business.id,
                             func.concat(Employee.first_name, " ", Employee.last_name).ilike(like))),
                         Card.customer_id.in_(select(Customer.id).where(
                             Customer.business_id == ctx.business.id, Customer.full_name.ilike(like)))))
    total = (await session.execute(select(func.count()).select_from(Card).where(*conds))).scalar_one()
    rows = (await session.execute(select(Card).where(*conds).order_by(Card.created_at.desc(), Card.id)
                                  .offset(pagination.offset).limit(pagination.page_size))).scalars().unique()
    return Page[CardOut](items=[card_out(c, ctx.business) for c in rows], total=total, page=pagination.page,
                         page_size=pagination.page_size)


@router.post("/cards", status_code=201, response_model=CardOut, summary="Create a card or tag")
async def create_card(body: CardIn, ctx: Manage, session: SessionDep, client: ClientDep) -> CardOut:
    await biz.ensure_business_limit(session, ctx.business, "cards")
    uid = normalize_uid(body.uid)
    await ensure_uid_free(session, ctx.business.id, uid)
    employee_id, customer_id, to_business = await _assignee(session, ctx.business.id, body.assignee_type,
                                                            body.assignee_id)
    await _check_profile(session, ctx.business.id, body.profile_id)
    action = await validate_action(session, ctx.business.id, body.action)
    card = Card(business_id=ctx.business.id, kind=body.kind, name=body.name.strip(), uid=uid,
                public_code=await unique_public_code(session), status=body.status, employee_id=employee_id,
                customer_id=customer_id, assigned_to_business=to_business, profile_id=body.profile_id, action=action,
                total_taps=0, unique_visitors=0)
    session.add(card)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise AppError(409, "card_uid_exists", "Another card of this business already uses this UID") from None
    history(session, card, "created", user=ctx.user, name=card.name, kind=card.kind)
    if employee_id or customer_id or to_business:
        history(session, card, "assigned", user=ctx.user, assignee_type=body.assignee_type,
                assignee_id=_assignee_ref(card)[1])
    audit.record(session, action="card.create", user_id=ctx.user.id, client=client, resource_type="card",
                 resource_id=card.id, metadata={"name": card.name, "kind": card.kind})
    await session.commit()
    return card_out(await _reload(session, card.id), ctx.business)


@router.get("/cards/{card_id}", response_model=CardOut, summary="Get a card")
async def get_card(card_id: uuid.UUID, ctx: View, session: SessionDep) -> CardOut:
    return card_out(await _get_card(session, ctx.business.id, card_id), ctx.business)


@router.patch("/cards/{card_id}", response_model=CardOut, summary="Update a card")
async def update_card(card_id: uuid.UUID, body: CardUpdateIn, ctx: Manage, session: SessionDep,
                      client: ClientDep) -> CardOut:
    card = await _get_card(session, ctx.business.id, card_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        card.name = body.name.strip()  # type: ignore[union-attr]
    if data.get("kind"):
        card.kind = body.kind  # type: ignore[assignment]
    if "uid" in data:
        uid = normalize_uid(body.uid)
        await ensure_uid_free(session, ctx.business.id, uid, card.id)
        if uid != card.uid:
            history(session, card, "uid_changed", user=ctx.user, uid=uid)
        card.uid = uid
    if "profile_id" in data:
        await _check_profile(session, ctx.business.id, body.profile_id)
        card.profile_id = body.profile_id
    if "action" in data:
        card.action = await validate_action(session, ctx.business.id, body.action)
        history(session, card, "action_changed", user=ctx.user, action_type=(card.action or {}).get("type"))
    audit.record(session, action="card.update", user_id=ctx.user.id, client=client, resource_type="card",
                 resource_id=card.id, metadata={"fields": sorted(data)})
    await session.commit()
    return card_out(await _reload(session, card.id), ctx.business)


@router.delete("/cards/{card_id}", status_code=204, summary="Delete a card")
async def delete_card(card_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> Response:
    card = await _get_card(session, ctx.business.id, card_id)
    card.deleted_at = datetime.now(UTC)
    history(session, card, "deleted", user=ctx.user)
    audit.record(session, action="card.delete", user_id=ctx.user.id, client=client, resource_type="card",
                 resource_id=card.id, metadata={"name": card.name})
    await session.commit()
    return Response(status_code=204)


@router.post("/cards/{card_id}/assign", response_model=CardOut,
             summary="Assign to an employee, a customer or the business itself",
             description="`assignee_type: business` makes it a company card (`assignee_id` omitted or the business id).")
async def assign_card(card_id: uuid.UUID, body: AssignIn, ctx: Manage, session: SessionDep, client: ClientDep) -> CardOut:
    card = await _get_card(session, ctx.business.id, card_id)
    if body.assignee_type != "business" and body.assignee_id is None:
        raise validation_error("body.assignee_id", "assignee_id is required for employee/customer")
    card.employee_id, card.customer_id, card.assigned_to_business = await _assignee(
        session, ctx.business.id, body.assignee_type, body.assignee_id)
    _, assignee_id = _assignee_ref(card)
    history(session, card, "assigned", user=ctx.user, assignee_type=body.assignee_type, assignee_id=assignee_id)
    audit.record(session, action="card.assign", user_id=ctx.user.id, client=client, resource_type="card",
                 resource_id=card.id, metadata={"assignee_type": body.assignee_type,
                                                "assignee_id": str(assignee_id)})
    await session.commit()
    return card_out(await _reload(session, card.id), ctx.business)


@router.post("/cards/{card_id}/unassign", response_model=CardOut, summary="Remove the assignee")
async def unassign_card(card_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> CardOut:
    card = await _get_card(session, ctx.business.id, card_id)
    previous_type, previous = _assignee_ref(card)
    card.employee_id = card.customer_id = None
    card.assigned_to_business = False
    history(session, card, "unassigned", user=ctx.user, previous_assignee_id=previous,
            previous_assignee_type=previous_type)
    audit.record(session, action="card.unassign", user_id=ctx.user.id, client=client, resource_type="card",
                 resource_id=card.id)
    await session.commit()
    return card_out(await _reload(session, card.id), ctx.business)


async def _status(card_id: uuid.UUID, ctx: BusinessContext, session: SessionDep, client: ClientDep, status: str) -> CardOut:
    card = await _get_card(session, ctx.business.id, card_id)
    if card.status != status:
        card.status = status
        verb = "activate" if status == "active" else "deactivate"
        history(session, card, f"{verb}d", user=ctx.user)
        audit.record(session, action=f"card.{verb}", user_id=ctx.user.id, client=client, resource_type="card",
                     resource_id=card.id)
        await session.commit()
    return card_out(await _reload(session, card.id), ctx.business)


@router.post("/cards/{card_id}/activate", response_model=CardOut, summary="Activate a card")
async def activate_card(card_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> CardOut:
    return await _status(card_id, ctx, session, client, "active")


@router.post("/cards/{card_id}/deactivate", response_model=CardOut, summary="Deactivate a card")
async def deactivate_card(card_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> CardOut:
    return await _status(card_id, ctx, session, client, "inactive")


@router.get("/cards/{card_id}/history", summary="Assignment, status and programming history")
async def card_history(card_id: uuid.UUID, ctx: View, session: SessionDep) -> list[dict[str, Any]]:
    card = await _get_card(session, ctx.business.id, card_id)
    rows = (await session.execute(
        select(CardHistory, User.full_name).outerjoin(User, User.id == CardHistory.actor_user_id)
        .where(CardHistory.card_id == card.id).order_by(CardHistory.created_at.desc()).limit(200))).all()
    return [{"id": str(h.id), "type": h.type, "data": h.data,
             "actor": ({"type": "user", "id": str(h.actor_user_id), "name": name} if h.actor_user_id
                       else {"type": "device", "id": str(h.actor_device_id), "name": None} if h.actor_device_id
                       else None),
             "created_at": h.created_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")} for h, name in rows]


# ── Actions ─────────────────────────────────────────────────────────────
@router.post("/actions/preview", response_model=ActionPreviewOut, summary="Preview what an action resolves to")
async def preview_action(body: ActionPreviewIn, ctx: View, session: SessionDep) -> ActionPreviewOut:
    action = await validate_action(session, ctx.business.id, body.action)
    card = await _get_card(session, ctx.business.id, body.card_id) if body.card_id else None
    res = await resolve(session, ctx.business, card, action)
    return ActionPreviewOut(resolved_url=res.url, kind=res.kind)  # type: ignore[arg-type]


# ── Taps & analytics ────────────────────────────────────────────────────
def _tap_conditions(business_id: uuid.UUID, *, source: str | None = None, card_id: uuid.UUID | None = None,
                    employee_id: uuid.UUID | None = None, customer_id: uuid.UUID | None = None,
                    device_id: uuid.UUID | None = None, result: str | None = None,
                    date_from: datetime | None = None, date_to: datetime | None = None) -> list:  # type: ignore[type-arg]
    conds = [CardTap.business_id == business_id]
    if source:
        conds.append(CardTap.source == source)
    if card_id:
        conds.append(CardTap.card_id == card_id)
    if employee_id:
        conds += [CardTap.assignee_type == "employee", CardTap.assignee_id == employee_id]
    if customer_id:
        conds += [CardTap.assignee_type == "customer", CardTap.assignee_id == customer_id]
    if device_id:
        conds.append(CardTap.device_id == device_id)
    if result:
        conds.append(CardTap.result == result)
    if date_from:
        conds.append(CardTap.created_at >= date_from)
    if date_to:
        conds.append(CardTap.created_at < date_to)
    return conds


@router.get("/taps", response_model=Page[CardTapOut], summary="Taps (web + reader)")
async def list_taps(ctx: View, session: SessionDep, pagination: PaginationDep,
                    source: Literal["web", "reader"] | None = None, card_id: uuid.UUID | None = None,
                    employee_id: uuid.UUID | None = None, customer_id: uuid.UUID | None = None,
                    device_id: uuid.UUID | None = None,
                    result: Literal["redirected", "page", "vcard", "webhook", "inactive", "unknown_card"] | None = None,
                    date_from: datetime | None = None, date_to: datetime | None = None) -> Page[CardTapOut]:
    conds = _tap_conditions(ctx.business.id, source=source, card_id=card_id, employee_id=employee_id,
                            customer_id=customer_id, device_id=device_id, result=result, date_from=date_from,
                            date_to=date_to)
    total = (await session.execute(select(func.count()).select_from(CardTap).where(*conds))).scalar_one()
    rows = (await session.execute(select(CardTap).where(*conds).order_by(CardTap.created_at.desc(), CardTap.id)
                                  .offset(pagination.offset).limit(pagination.page_size))).scalars()
    return Page[CardTapOut](items=[tap_out(t) for t in rows], total=total, page=pagination.page,
                            page_size=pagination.page_size)


@router.get("/cards/{card_id}/taps", response_model=Page[CardTapOut], summary="Taps of one card")
async def card_taps(card_id: uuid.UUID, ctx: View, session: SessionDep, pagination: PaginationDep) -> Page[CardTapOut]:
    await _get_card(session, ctx.business.id, card_id)
    return await list_taps(ctx, session, pagination, card_id=card_id)


def _local_day(tz: str):  # type: ignore[no-untyped-def]
    return cast(func.timezone(tz, CardTap.created_at), Date)


async def _breakdown(session: SessionDep, column: Any, conds: list, label: str, limit: int = 20) -> list[dict[str, Any]]:  # type: ignore[type-arg]
    rows = (await session.execute(select(column, func.count()).where(*conds).group_by(column)
                                  .order_by(func.count().desc()).limit(limit))).all()
    return [{label: r[0], "taps": int(r[1])} for r in rows]


@router.get("/cards/{card_id}/stats", summary="Card statistics")
async def card_stats(card_id: uuid.UUID, ctx: Analytics, session: SessionDep,
                     range: Literal["7d", "30d", "90d", "365d"] = Query(default="30d")) -> dict[str, Any]:
    card = await _get_card(session, ctx.business.id, card_id)
    tz = (ctx.business.settings or {}).get("timezone") or "UTC"
    since = datetime.now(UTC) - timedelta(days=RANGE_DAYS[range])
    conds = [CardTap.card_id == card.id, CardTap.created_at >= since, CardTap.is_bot.is_(False)]
    tot = (await session.execute(select(func.count(), func.count(distinct(CardTap.visitor_hash))).where(*conds))).one()
    timeline = await _timeline(session, conds, tz, RANGE_DAYS[range])
    return {
        "total_taps": int(tot[0]), "unique_visitors": int(tot[1]), "timeline": timeline,
        "by_source": await _breakdown(session, CardTap.source, conds, "source"),
        "by_device_type": await _breakdown(session, CardTap.device_type, conds, "device_type"),
        "by_country": await _breakdown(session, CardTap.country, conds, "country"),
    }


async def _timeline(session: SessionDep, conds: list, tz: str, days: int) -> list[dict[str, Any]]:  # type: ignore[type-arg]
    day = _local_day(tz)
    rows = (await session.execute(select(day, func.count(), func.count(distinct(CardTap.visitor_hash)))
                                  .where(*conds).group_by(day))).all()
    by_day: dict[date, tuple[int, int]] = {r[0]: (int(r[1]), int(r[2])) for r in rows}
    try:  # buckets are local days of the business timezone, so "today" must be too
        today = datetime.now(zoneinfo.ZoneInfo(tz)).date()
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        today = datetime.now(UTC).date()
    out = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        taps, uniq = by_day.get(d, (0, 0))
        out.append({"date": d.isoformat(), "taps": taps, "unique_visitors": uniq})
    return out


async def _totals(session: SessionDep, conds: list) -> dict[str, int]:  # type: ignore[type-arg]
    row = (await session.execute(select(
        func.count(),
        func.count(distinct(CardTap.visitor_hash)),
        func.count().filter(CardTap.source == "web"),
        func.count().filter(CardTap.source == "reader"),
        func.count(distinct(CardTap.card_id)),
        func.count(distinct(CardTap.assignee_id)).filter(CardTap.assignee_type == "employee"),
    ).where(*conds))).one()
    return {"taps": int(row[0]), "unique_visitors": int(row[1]), "web_taps": int(row[2]), "reader_taps": int(row[3]),
            "active_cards": int(row[4]), "active_employees": int(row[5])}


@router.get("/analytics", summary="Business analytics (bots excluded)")
async def analytics(ctx: Analytics, session: SessionDep,
                    range: Literal["7d", "30d", "90d", "365d"] = Query(default="30d"),
                    card_id: uuid.UUID | None = None, employee_id: uuid.UUID | None = None) -> dict[str, Any]:
    days = RANGE_DAYS[range]
    now = datetime.now(UTC)
    since, prev_since = now - timedelta(days=days), now - timedelta(days=2 * days)
    tz = (ctx.business.settings or {}).get("timezone") or "UTC"
    base = _tap_conditions(ctx.business.id, card_id=card_id, employee_id=employee_id) + [CardTap.is_bot.is_(False)]
    conds = base + [CardTap.created_at >= since]
    prev = base + [CardTap.created_at >= prev_since, CardTap.created_at < since]
    hour = extract("hour", func.timezone(tz, CardTap.created_at))
    by_hour_rows = dict((await session.execute(select(hour, func.count()).where(*conds).group_by(hour))).all())
    by_card = (await session.execute(
        select(CardTap.card_id, func.max(CardTap.card_name), func.count()).where(*conds, CardTap.card_id.is_not(None))
        .group_by(CardTap.card_id).order_by(func.count().desc()).limit(20))).all()
    by_employee = (await session.execute(
        select(CardTap.assignee_id, func.max(CardTap.assignee_name), func.count())
        .where(*conds, CardTap.assignee_type == "employee").group_by(CardTap.assignee_id)
        .order_by(func.count().desc()).limit(20))).all()
    kinds = {(k or "unassigned"): n for k, n in (await session.execute(
        select(CardTap.assignee_type, func.count())
        .where(*conds, or_(CardTap.card_id.is_not(None), CardTap.assignee_type.is_not(None)))
        .group_by(CardTap.assignee_type))).all()}
    last = (await session.execute(select(CardTap).where(*base).order_by(CardTap.created_at.desc()).limit(1))).scalar_one_or_none()
    return {
        "range": range,
        "totals": await _totals(session, conds),
        "previous_period_totals": await _totals(session, prev),
        "timeline": await _timeline(session, conds, tz, days),
        "by_card": [{"card_id": str(r[0]), "name": r[1], "taps": int(r[2])} for r in by_card],
        "by_employee": [{"employee_id": str(r[0]), "name": r[1], "taps": int(r[2])} for r in by_employee],
        "by_assignee_type": {k: int(kinds.get(k, 0)) for k in ("employee", "customer", "business", "unassigned")},
        "by_action": await _breakdown(session, CardTap.action_type, conds, "action_type"),
        "by_device_type": await _breakdown(session, CardTap.device_type, conds, "device_type"),
        "by_country": await _breakdown(session, CardTap.country, conds, "country"),
        "by_hour": [{"hour": h, "taps": int(by_hour_rows.get(h, 0) or by_hour_rows.get(float(h), 0))} for h in range_(24)],
        "last_activity": tap_out(last).model_dump(mode="json") if last else None,
    }


range_ = range
