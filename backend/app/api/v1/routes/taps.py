"""Pull-based tap polling (developer API-key auth).

Webhooks are the primary delivery path; this is the fallback for developers who
cannot expose a public endpoint (local development, no tunnel). A developer polls
their own application's taps with the application API key (`Bearer nfc_...`), and
tails new taps forward with an opaque keyset cursor — no missed or duplicated taps.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import select, tuple_

from app.api.deps import ApiKeyAuth, SessionDep
from app.core.errors import not_found, validation_error
from app.models import NfcEvent
from app.schemas.common import Schema
from app.schemas.device_api import normalize_card_id
from app.schemas.resources import EventOut
from app.services.serializers import event_out

router = APIRouter(tags=["Taps (polling)"])

_MIN_UUID = uuid.UUID(int=0)


class TapPage(Schema):
    items: list[EventOut]
    # Pass back as `?cursor=` to fetch taps that arrive after the newest item here.
    next_cursor: str | None
    # True when more taps remain to fetch now in the forward direction (keep polling).
    has_more: bool = False


def _encode_cursor(received_at: datetime, event_id: uuid.UUID) -> str:
    raw = f"{received_at.astimezone(UTC).isoformat()}|{event_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        ts_raw, id_raw = base64.urlsafe_b64decode(padded.encode()).decode().split("|", 1)
        received_at = datetime.fromisoformat(ts_raw)
        return (received_at if received_at.tzinfo else received_at.replace(tzinfo=UTC)), uuid.UUID(id_raw)
    except (binascii.Error, UnicodeDecodeError, ValueError):
        raise validation_error("query.cursor", "invalid cursor")


def _parse_since(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise validation_error("query.since", "must be an ISO-8601 date or datetime")
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


@router.get("/taps", response_model=TapPage, summary="List recent taps (polling)")
async def list_taps(
    auth: ApiKeyAuth,
    session: SessionDep,
    cursor: str | None = Query(default=None, description="Opaque keyset cursor from a previous response's next_cursor"),
    since: str | None = Query(default=None, description="ISO-8601 point in time to start tailing from (ignored when cursor is set)"),
    limit: Annotated[int, Query(ge=1, le=100, description="Maximum taps to return (max 100)")] = 50,
    card_id: str | None = Query(default=None, max_length=200),
    status: Literal["pending", "delivered", "retrying", "failed", "logged"] | None = Query(default=None),
) -> TapPage:
    conds = [NfcEvent.application_id == auth.application.id]
    if card_id:
        conds.append(NfcEvent.card_id == normalize_card_id(card_id))
    if status:
        conds.append(NfcEvent.status == status)

    forward = cursor is not None or since is not None
    if cursor is not None:
        bound = _decode_cursor(cursor)
        conds.append(tuple_(NfcEvent.received_at, NfcEvent.id) > bound)
    elif since is not None:
        conds.append(NfcEvent.received_at >= _parse_since(since))

    order = (
        [NfcEvent.received_at.asc(), NfcEvent.id.asc()]
        if forward
        else [NfcEvent.received_at.desc(), NfcEvent.id.desc()]
    )
    rows = (
        (await session.execute(select(NfcEvent).where(*conds).order_by(*order).limit(limit + 1)))
        .scalars()
        .unique()
        .all()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]

    if rows:
        newest = rows[-1] if forward else rows[0]
        next_cursor = _encode_cursor(newest.received_at, newest.id)
    elif cursor is not None:
        next_cursor = cursor
    elif since is not None:
        next_cursor = _encode_cursor(_parse_since(since), _MIN_UUID)
    else:
        next_cursor = _encode_cursor(datetime.now(UTC), _MIN_UUID)

    # The bare initial call only establishes a tail point; backward paging is out of scope.
    return TapPage(items=[event_out(e) for e in rows], next_cursor=next_cursor, has_more=has_more and forward)


@router.get("/taps/{tap_id}", response_model=EventOut, summary="Get one tap by id")
async def get_tap(tap_id: uuid.UUID, auth: ApiKeyAuth, session: SessionDep) -> EventOut:
    event = (
        await session.execute(
            select(NfcEvent).where(NfcEvent.id == tap_id, NfcEvent.application_id == auth.application.id)
        )
    ).scalar_one_or_none()
    if event is None:
        raise not_found("Tap")
    return event_out(event)
