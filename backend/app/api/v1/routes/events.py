"""Events and webhook deliveries (dashboard)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import CurrentUser, PaginationDep, SessionDep, platform_only
from app.core.errors import AppError, not_found, validation_error
from app.models import Delivery, NfcEvent, User
from app.services.applications import authorize_application, developer_app_ids, get_owned_application
from app.schemas.common import Page
from app.schemas.device_api import normalize_card_id
from app.schemas.resources import DeliveryOut, EventDetailOut, EventOut
from app.services import delivery as delivery_service
from app.services.serializers import delivery_out, event_out

router = APIRouter(tags=["Events & deliveries"], dependencies=platform_only)


def _parse_bound(value: str | None, field: str, *, end: bool) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    try:
        if len(raw) == 10:  # YYYY-MM-DD → whole day (inclusive)
            d = datetime.fromisoformat(raw).replace(tzinfo=UTC)
            return d + timedelta(days=1) if end else d
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise validation_error(f"query.{field}", "must be an ISO-8601 date or datetime")
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


@router.get("/events", response_model=Page[EventOut], summary="List card events")
async def list_events(
    user: CurrentUser,
    session: SessionDep,
    pagination: PaginationDep,
    application_id: uuid.UUID | None = Query(default=None),
    device_id: uuid.UUID | None = Query(default=None),
    card_id: str | None = Query(default=None, max_length=200),
    status: Literal["pending", "delivered", "retrying", "failed", "logged"] | None = Query(default=None),
    date_from: str | None = Query(default=None, description="ISO date/datetime (inclusive)"),
    date_to: str | None = Query(default=None, description="ISO date (inclusive) or datetime (exclusive)"),
) -> Page[EventOut]:
    if application_id:
        await get_owned_application(session, user, application_id, permission="api.view")
        conds = [NfcEvent.application_id == application_id]
    else:
        conds = [NfcEvent.owner_id == user.id, NfcEvent.application_id.in_(developer_app_ids(user.id))]
    if device_id:
        conds.append(NfcEvent.device_id == device_id)
    if card_id:
        conds.append(NfcEvent.card_id == normalize_card_id(card_id))
    if status:
        conds.append(NfcEvent.status == status)
    start = _parse_bound(date_from, "date_from", end=False)
    stop = _parse_bound(date_to, "date_to", end=True)
    if start:
        conds.append(NfcEvent.received_at >= start)
    if stop:
        conds.append(NfcEvent.received_at < stop)
    total = (await session.execute(select(func.count()).select_from(NfcEvent).where(*conds))).scalar_one()
    rows = (
        await session.execute(
            select(NfcEvent).where(*conds)
            .order_by(NfcEvent.received_at.desc(), NfcEvent.id)
            .offset(pagination.offset).limit(pagination.page_size)
        )
    ).scalars().unique()
    return Page[EventOut](
        items=[event_out(e) for e in rows], total=total, page=pagination.page, page_size=pagination.page_size
    )


async def _owned_event(session: SessionDep, user: User, event_id: uuid.UUID, permission: str = "api.view") -> NfcEvent:
    event = (await session.execute(select(NfcEvent).where(NfcEvent.id == event_id))).scalar_one_or_none()
    if event is None:
        raise not_found("Event")
    try:
        await authorize_application(session, user, event.application, permission)
    except AppError as exc:
        if exc.code == "not_found":
            raise not_found("Event") from None
        raise
    return event


@router.get("/events/{event_id}", response_model=EventDetailOut, summary="Get an event with its delivery attempts")
async def get_event(event_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> EventDetailOut:
    event = await _owned_event(session, user, event_id)
    deliveries = (
        await session.execute(
            select(Delivery).where(Delivery.event_id == event.id).order_by(Delivery.created_at, Delivery.attempt)
        )
    ).scalars()
    return EventDetailOut(**event_out(event).model_dump(), deliveries=[delivery_out(d) for d in deliveries])


@router.post(
    "/events/{event_id}/redeliver",
    response_model=DeliveryOut,
    summary="Redeliver an event now",
    description="Makes an immediate relay-signed attempt from the server (also for events originally delivered directly).",
)
async def redeliver(event_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> DeliveryOut:
    event = await _owned_event(session, user, event_id, "api.manage")
    token = await delivery_service.acquire_lock(event.id)
    if token is None:
        raise AppError(409, "delivery_in_progress", "A delivery for this event is already in progress")
    try:
        d = await delivery_service.perform_relay_attempt(
            session, event, schedule_retries=False, is_redelivery=True
        )
    finally:
        await delivery_service.release_lock(event.id, token)
    return delivery_out(d)


@router.get("/deliveries", response_model=Page[DeliveryOut], summary="List webhook delivery attempts")
async def list_deliveries(
    user: CurrentUser,
    session: SessionDep,
    pagination: PaginationDep,
    application_id: uuid.UUID | None = Query(default=None),
    success: bool | None = Query(default=None),
) -> Page[DeliveryOut]:
    if application_id:
        await get_owned_application(session, user, application_id, permission="api.view")
        conds = [Delivery.application_id == application_id]
    else:
        conds = [Delivery.owner_id == user.id, Delivery.application_id.in_(developer_app_ids(user.id))]
    if success is not None:
        conds.append(Delivery.success.is_(success))
    total = (await session.execute(select(func.count()).select_from(Delivery).where(*conds))).scalar_one()
    rows = (
        await session.execute(
            select(Delivery).where(*conds)
            .order_by(Delivery.created_at.desc(), Delivery.id)
            .offset(pagination.offset).limit(pagination.page_size)
        )
    ).scalars()
    return Page[DeliveryOut](
        items=[delivery_out(d) for d in rows], total=total, page=pagination.page, page_size=pagination.page_size
    )
