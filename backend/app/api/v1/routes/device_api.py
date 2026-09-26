"""Mobile NFC terminal API (`/device/*`)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Header, Query, Request
from pydantic import Field
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import ClientDep, CurrentDevice, PaginationDep, RegistrationAuth, SessionDep
from app.core.config import settings
from app.core.errors import AppError
from app.core.rate_limit import client_ip
from app.core.security import decrypt_secret, derive_device_signing_secret, generate_device_token, sha256_hex
from app.models import Business, Card, Delivery, Device, Employee, NfcEvent, PairingCode
from app.schemas.common import Schema
from app.services.business_serializers import card_out
from app.schemas.device_api import (
    DeviceConfigApplication,
    DeviceConfigOut,
    DeviceEventIn,
    DeviceEventOut,
    DeviceRegisterIn,
    DeviceRegisterOut,
    HeartbeatOut,
)
from app.core.error_catalog import ref_for
from app.services import audit, delivery, live, usage
from app.services import business as biz
from app.services import digital_cards
from app.services import taps as taps_service
from app.services import plans as plan_service
from app.services.serializers import device_out

logger = logging.getLogger("app.device_api")
router = APIRouter(prefix="/device", tags=["Device API (mobile terminal)"])


async def build_device_config(session: SessionDep, device: Device) -> DeviceConfigOut:
    app = device.application
    business = await session.get(Business, app.business_id) if app.business_id else None
    assigned = None
    if business is not None and device.assigned_employee_id:
        emp = await session.get(Employee, device.assigned_employee_id)
        if emp is not None:
            assigned = {"id": emp.id, "name": emp.full_name}
    capabilities: list[str] = []
    if business is not None and {**biz.DEFAULT_SETTINGS, **(business.settings or {})}.get("devices_can_register_cards"):
        capabilities = ["cards.register", "cards.program"]
    direct = app.delivery_mode == "direct"
    signing_secret = None
    if direct and app.webhook_secret_encrypted:
        signing_secret = derive_device_signing_secret(decrypt_secret(app.webhook_secret_encrypted), device.id)
    return DeviceConfigOut(
        device_id=device.id,
        device_name=device.name,
        application=DeviceConfigApplication(id=app.id, name=app.name),
        delivery_mode=app.delivery_mode,  # type: ignore[arg-type]
        endpoint_url=app.endpoint_url,
        endpoint_enabled=bool(app.endpoint_enabled and app.endpoint_url),
        timeout_seconds=app.endpoint_timeout_seconds,
        max_retries=settings.WEBHOOK_MAX_RETRIES,
        custom_headers=dict(app.endpoint_custom_headers or {}) if direct else {},
        signing_secret=signing_secret,
        allowed_domains=list(app.allowed_domains or []),
        account_type="business" if business is not None else "developer",
        business=({"id": business.id, "name": business.name, "slug": business.slug,
                   "logo_url": biz.media_url(business.logo_path)} if business is not None else None),
        assigned_employee=assigned,
        capabilities=capabilities,
    )


@router.post(
    "/register",
    status_code=201,
    response_model=DeviceRegisterOut,
    summary="Register this phone as an NFC reader (API key or pairing code)",
    description=(
        "Authenticate with `Authorization: Bearer nfc_...` (API key) or `Bearer nfcp_...` (single-use QR pairing "
        "code; its preset device name overrides `device_name`; `401 invalid_pairing_code` when unknown, used, "
        "expired or cancelled). Returns a device token (`nfcd_...`) "
        "that the app keeps in secure storage; the API key should then be discarded. Re-registering "
        "with the same `installation_id` for the same application revokes the old token and issues a new one."
    ),
)
async def register_device(
    body: DeviceRegisterIn, ctx: RegistrationAuth, session: SessionDep, client: ClientDep
) -> DeviceRegisterOut:
    app = ctx.application
    token = generate_device_token()
    pairing = ctx.pairing_code
    device_name = body.device_name
    if pairing is not None:
        # Atomic single-use consumption: a concurrent redemption blocks on the row lock and then
        # sees used_at set, so exactly one request wins. Rolled back if registration fails below.
        now = datetime.now(UTC)
        consumed = (
            await session.execute(
                update(PairingCode)
                .where(
                    PairingCode.id == pairing.id,
                    PairingCode.used_at.is_(None),
                    PairingCode.cancelled_at.is_(None),
                    PairingCode.expires_at > now,
                )
                .values(used_at=now)
                .returning(PairingCode.id)
            )
        ).first()
        if consumed is None:
            raise AppError(401, "invalid_pairing_code",
                           "This pairing code is invalid, used, expired or cancelled",
                           headers={"WWW-Authenticate": "Bearer"})
        if pairing.device_name:
            device_name = pairing.device_name
    device = (
        await session.execute(
            select(Device)
            .where(
                Device.application_id == app.id,
                Device.installation_id == body.installation_id,
                Device.status == "active",
                Device.deleted_at.is_(None),
            )
            .with_for_update(of=Device)
        )
    ).scalar_one_or_none()
    re_registered = device is not None
    if device is None:
        if app.business_id is not None:
            business = await session.get(Business, app.business_id)
            assert business is not None
            await biz.ensure_business_limit(session, business, "devices")
        else:
            await plan_service.ensure_can_add_device(session, app.owner_id)
        device = Device(
            application_id=app.id,
            owner_id=app.owner_id,
            installation_id=body.installation_id,
            status="active",
            events_count=0,
        )
        device.application = app
        session.add(device)
    device.name = device_name
    device.platform = body.platform
    device.model = body.model
    device.os_version = body.os_version
    device.app_version = body.app_version
    device.token_hash = sha256_hex(token)  # replaces (revokes) any previous token
    device.registered_by_api_key_id = ctx.api_key.id if ctx.api_key else None
    device.last_seen_at = datetime.now(UTC)
    device.last_ip = client.ip
    await session.flush()
    meta: dict[str, object] = {"application_id": str(app.id), "name": device.name, "model": device.model,
                               "re_registered": re_registered}
    if pairing is not None:
        await session.execute(
            update(PairingCode).where(PairingCode.id == pairing.id).values(device_id=device.id)
        )
        meta.update(via="pairing_code", pairing_code_id=str(pairing.id))
    else:
        assert ctx.api_key is not None
        meta.update(via="api_key", api_key_prefix=ctx.api_key.prefix)
    audit.record(
        session, action="device.register", user_id=app.owner_id, client=client,
        resource_type="device", resource_id=device.id, metadata=meta,
    )
    await session.commit()
    return DeviceRegisterOut(device=device_out(device), device_token=token, config=await build_device_config(session, device))


@router.get("/config", response_model=DeviceConfigOut, summary="Current device configuration")
async def get_config(device: CurrentDevice, session: SessionDep) -> DeviceConfigOut:
    return await build_device_config(session, device)


@router.post("/heartbeat", response_model=HeartbeatOut, summary="Report the device is alive")
async def heartbeat(device: CurrentDevice, session: SessionDep, request: Request) -> HeartbeatOut:
    device.last_seen_at = datetime.now(UTC)
    device.last_ip = client_ip(request)
    await session.commit()
    return HeartbeatOut(server_time=datetime.now(UTC))


async def _latest_delivery(session: SessionDep, event: NfcEvent) -> Delivery | None:
    return (
        await session.execute(
            select(Delivery).where(Delivery.event_id == event.id)
            .order_by(Delivery.created_at.desc(), Delivery.attempt.desc()).limit(1)
        )
    ).scalar_one_or_none()


async def _state(session: SessionDep, event: NfcEvent) -> DeviceEventOut:
    last = await _latest_delivery(session, event)
    return DeviceEventOut(
        event_id=event.id,
        status=event.status,  # type: ignore[arg-type]
        status_code=event.last_status_code,
        latency_ms=last.latency_ms if last else None,
        error=event.last_error,
        error_code=event.last_error_code,
        error_ref=ref_for(event.last_error_code),
    )


async def _record_direct_attempt(session: SessionDep, event: NfcEvent, body: DeviceEventIn) -> None:
    dd = body.direct_delivery
    assert dd is not None
    session.add(
        Delivery(
            event_id=event.id,
            application_id=event.application_id,
            owner_id=event.owner_id,
            attempt=dd.attempt,
            mode="direct",
            url=event.application.endpoint_url,
            success=dd.success,
            status_code=dd.status_code,
            latency_ms=dd.latency_ms,
            error=None if dd.success else (dd.error or (f"HTTP {dd.status_code}" if dd.status_code else "failed")),
            response_excerpt=None,
        )
    )
    live.publish_later(event.application_id, "delivery.attempt", {
        "event_id": str(event.id), "attempt": dd.attempt, "mode": "direct", "url": event.application.endpoint_url,
        "success": dd.success, "status_code": dd.status_code, "latency_ms": dd.latency_ms,
        "error_code": None, "error_ref": None, "response_excerpt": None, "response_headers": {},
        "request_payload": None})
    event.attempts = max(event.attempts, dd.attempt)
    event.last_status_code = dd.status_code
    event.last_error = None if dd.success else (dd.error or (f"HTTP {dd.status_code}" if dd.status_code else "failed"))
    if dd.success:
        event.delivered_at = event.delivered_at or datetime.now(UTC)
        await usage.set_status(session, event, "delivered")
    elif event.status != "delivered":
        await usage.set_status(session, event, "failed")


@router.post(
    "/events",
    response_model=DeviceEventOut,
    summary="Submit a card-detected event",
    description=(
        "**relay** (no `direct_delivery`): the server stores the event and makes the first signed delivery "
        "synchronously (bounded by the endpoint timeout); failures are retried server-side (`retrying`).\n\n"
        "**direct** (`direct_delivery` present): the phone already delivered; the server only logs the outcome.\n\n"
        "Idempotent on `event_id`: repeats return the current state (direct mode records the new attempt). "
        "Returns 200 in all success cases."
    ),
)
async def submit_event(
    body: DeviceEventIn,
    device: CurrentDevice,
    session: SessionDep,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> JSONResponse:
    device_id = device.id
    app = device.application
    business = await session.get(Business, app.business_id) if app.business_id else None
    existing = await session.get(NfcEvent, body.event_id)
    if existing is not None:
        return await _handle_duplicate(session, existing, device_id, body, business)

    if business is not None:
        await biz.ensure_business_limit(session, business, "taps")
    else:
        await plan_service.ensure_can_record_event(session, device.owner_id)
    now = datetime.now(UTC)
    is_direct = body.direct_delivery is not None
    digital = None
    if body.digital_card_token is not None:  # Part 4 §5
        digital = await digital_cards.read_by_terminal(session, body.digital_card_token, body.card_id, app, business)
    event = NfcEvent(
        id=body.event_id,
        application_id=app.id,
        device_id=device.id,
        owner_id=device.owner_id,
        event_type="card.detected",
        card_id=body.card_id,
        card_type="digital_card" if digital is not None else body.card_type,
        extra={"digital_card": digital.payload} if digital is not None else None,
        card_technologies=body.card_technologies,
        delivery_mode="direct" if is_direct else "relay",
        status="pending",
        attempts=0,
        detected_at=body.detected_at,
        received_at=now,
    )
    event.application = app
    event.device = device
    session.add(event)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing = await session.get(NfcEvent, body.event_id)
        if existing is None:
            raise
        business = await session.get(Business, app.business_id) if app.business_id else None
        return await _handle_duplicate(session, existing, device_id, body, business)

    device.events_count = Device.events_count + 1
    await usage.bump(session, application_id=app.id, owner_id=device.owner_id, day=now.date(), events=1)
    live.publish_later(app.id, "event.received", {
        "event_id": str(event.id), "card_id": event.card_id, "card_type": event.card_type,
        "card_technologies": list(event.card_technologies or []), "device_id": str(device_id),
        "device_name": device.name, "detected_at": body.detected_at.isoformat().replace("+00:00", "Z"),
        "delivery_mode": event.delivery_mode})

    outcome = None
    if digital is not None:
        await digital_cards.after_event(session, digital, event, device, app, business)
        outcome = digital.outcome
    elif business is not None:  # §C2: resolve against the business's cards, record a reader tap
        outcome = await taps_service.resolve_reader_tap(
            session, business=business, device=device, card_uid=body.card_id, nfc_event_id=event.id)
    webhook_event = outcome.webhook_event if outcome else None
    block = outcome.block if outcome else None

    if is_direct:
        await _record_direct_attempt(session, event, body)
        await session.commit()
        await _enqueue(webhook_event)
        return _out(await _state(session, event), block, digital.response if digital else None)

    if business is not None and not (app.endpoint_url and app.endpoint_enabled):
        # Business terminal without an endpoint: not an error — the tap is logged.
        event.status = "logged"
        await session.commit()
        await _enqueue(webhook_event)
        return _out(await _state(session, event), block, digital.response if digital else None)

    await session.commit()  # persist before the (slow) outbound call
    await _enqueue(webhook_event)
    d = await delivery.perform_relay_attempt(session, event, schedule_retries=True)
    return _out(DeviceEventOut(
        event_id=event.id,
        status=event.status,  # type: ignore[arg-type]
        status_code=d.status_code,
        latency_ms=d.latency_ms,
        error=d.error,
        error_code=d.error_code,
        error_ref=ref_for(d.error_code),
    ), block, digital.response if digital else None)


async def _enqueue(event: NfcEvent | None) -> None:
    if event is not None:
        await delivery.enqueue(event.id, datetime.now(UTC))


def _out(state: DeviceEventOut, business_block: dict | None, digital: dict | None = None) -> JSONResponse:  # type: ignore[type-arg]
    data = state.model_dump(mode="json", exclude={"business"})
    if digital is not None:
        data["digital_card"] = digital
    # error_code / error_ref only when the attempt failed (keeps the Part 1 success shape unchanged).
    for key in ("error_code", "error_ref"):
        if data.get(key) is None:
            data.pop(key, None)
    if business_block is not None:
        data["business"] = jsonable_encoder(business_block)
    return JSONResponse(content=data)


async def _handle_duplicate(
    session: SessionDep, event: NfcEvent, device_id: object, body: DeviceEventIn, business: Business | None,
) -> JSONResponse:
    if event.device_id != device_id:
        raise AppError(409, "event_id_conflict", "This event_id was already used by another device")
    if body.direct_delivery is not None and event.delivery_mode == "direct":
        await _record_direct_attempt(session, event, body)
        await session.commit()
    block = await taps_service.block_for_existing_event(session, event.id) if business is not None else None
    return _out(await _state(session, event), block)


# ── §C3: card management from business devices ─────────────────────────
async def _business_device(session: SessionDep, device: Device, capability: str | None) -> Business:
    app = device.application
    if app.business_id is None:
        raise AppError(403, "device_not_business", "This endpoint is only available to business devices")
    business = await session.get(Business, app.business_id)
    assert business is not None
    if capability and not {**biz.DEFAULT_SETTINGS, **(business.settings or {})}.get("devices_can_register_cards"):
        raise AppError(403, "device_capability_missing", "This business does not allow devices to manage cards",
                       {"required": capability})
    return business


def _device_card(card: Card, business: Business) -> dict[str, Any]:
    assignee = biz.assignee_of(card, business)
    return {"id": str(card.id), "name": card.name, "kind": card.kind,
            "assignee_type": assignee["type"] if assignee else None,
            "assignee_name": assignee["name"] if assignee else None, "uid_masked": biz.mask_uid(card.uid),
            "tap_url": biz.tap_url(card.public_code), "programmed": card.programmed_at is not None,
            "status": card.status}


@router.get("/business/cards", summary="Business cards (for programming / lookup)",
            description="Paginated `{items,total,page,page_size}`.")
async def device_cards(device: CurrentDevice, session: SessionDep, pagination: PaginationDep,
                       q: str | None = Query(default=None, max_length=100),
                       programmed: bool | None = None) -> dict[str, Any]:
    business = await _business_device(session, device, None)
    conds = [Card.business_id == business.id, Card.deleted_at.is_(None)]
    if programmed is not None:
        conds.append(Card.programmed_at.is_not(None) if programmed else Card.programmed_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(Card.name.ilike(like), Card.public_code == q.strip(),
                         Card.employee_id.in_(select(Employee.id).where(
                             Employee.business_id == business.id,
                             func.concat(Employee.first_name, " ", Employee.last_name).ilike(like)))))
    total = (await session.execute(select(func.count()).select_from(Card).where(*conds))).scalar_one()
    rows = (await session.execute(select(Card).where(*conds).order_by(Card.name, Card.id)
                                  .offset(pagination.offset).limit(pagination.page_size))).scalars().unique()
    return {"items": [_device_card(c, business) for c in rows], "total": total, "page": pagination.page,
            "page_size": pagination.page_size}


class DeviceCardIn(Schema):
    uid: str = Field(min_length=4, max_length=200)
    name: str | None = Field(default=None, max_length=120)
    kind: Literal["card", "tag"] = "card"
    assign_to_business: bool = False  # register it as a company card (assignee = the business)
    note: str | None = Field(default=None, max_length=500)  # kept in the card's history


class ProgrammedIn(Schema):
    uid: str = Field(min_length=4, max_length=200)


@router.post("/business/cards", status_code=201, summary="Register a scanned card (needs cards.register)")
async def device_register_card(body: DeviceCardIn, device: CurrentDevice, session: SessionDep,
                               client: ClientDep) -> dict[str, Any]:
    from app.api.v1.routes.cards import ensure_uid_free, history, normalize_uid, unique_public_code

    business = await _business_device(session, device, "cards.register")
    uid = normalize_uid(body.uid)
    await ensure_uid_free(session, business.id, uid)
    await biz.ensure_business_limit(session, business, "cards")
    card = Card(business_id=business.id, kind=body.kind, name=(body.name or "").strip() or f"Card {uid[-4:]}",
                uid=uid, public_code=await unique_public_code(session), status="active", total_taps=0,
                unique_visitors=0, assigned_to_business=body.assign_to_business)
    session.add(card)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise AppError(409, "card_uid_exists", "Another card of this business already uses this UID") from None
    note = (body.note or "").strip() or None
    history(session, card, "created", device_id=device.id, name=card.name, via="device", note=note)
    if body.assign_to_business:
        history(session, card, "assigned", device_id=device.id, assignee_type="business", assignee_id=business.id)
    audit.record(session, action="card.create", user_id=None, client=client, resource_type="card",
                 resource_id=card.id, metadata={"via": "device", "device_id": str(device.id)})
    await session.commit()
    card = (await session.execute(select(Card).where(Card.id == card.id)
                                  .execution_options(populate_existing=True))).scalar_one()
    return card_out(card, business).model_dump(mode="json")


@router.post("/business/cards/{card_id}/programmed", summary="Report a card as programmed (needs cards.program)")
async def device_card_programmed(card_id: uuid.UUID, body: ProgrammedIn, device: CurrentDevice, session: SessionDep,
                                 client: ClientDep) -> dict[str, Any]:
    from app.api.v1.routes.cards import ensure_uid_free, history, normalize_uid

    business = await _business_device(session, device, "cards.program")
    card = (await session.execute(select(Card).where(Card.id == card_id, Card.business_id == business.id,
                                                     Card.deleted_at.is_(None)))).scalar_one_or_none()
    if card is None:
        raise AppError(404, "not_found", "Card not found")
    uid = normalize_uid(body.uid)
    if card.uid is None:
        await ensure_uid_free(session, business.id, uid, card.id)
        card.uid = uid
    elif card.uid != uid:
        raise AppError(409, "card_uid_mismatch", "This card is already bound to a different UID")
    card.programmed_at = datetime.now(UTC)
    history(session, card, "programmed", device_id=device.id, uid=uid)
    audit.record(session, action="card.programmed", user_id=None, client=client, resource_type="card",
                 resource_id=card.id, metadata={"device_id": str(device.id)})
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise AppError(409, "card_uid_exists", "Another card of this business already uses this UID") from None
    card = (await session.execute(select(Card).where(Card.id == card_id)
                                  .execution_options(populate_existing=True))).scalar_one()
    return card_out(card, business).model_dump(mode="json")
