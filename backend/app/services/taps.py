"""Card taps (Part 2 §B7/§C2): recording, counters, visitor hashing, reader resolution, webhook actions."""

from __future__ import annotations

import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.useragent import browser, device_type, is_bot
from app.models import Application, Business, Card, CardTap, Customer, Device, Employee, NfcEvent
from app.services import usage
from app.services.actions import Resolution, effective_action, resolve
from app.services.business import assignee_of, card_effective_status, tap_url

logger = logging.getLogger("app.taps")

RESULT_BY_KIND = {"redirect": "redirected", "page": "page", "vcard": "vcard", "webhook": "webhook"}
_SALT_KEY = hashlib.sha256(("visitor-salt:" + settings.JWT_SECRET).encode()).digest()


def visitor_hash(ip: str | None, ua: str | None, day: str | None = None) -> str | None:
    """Daily-rotating salted hash: unique visitors per day without storing IPs."""
    if not ip:
        return None
    day = day or datetime.now(UTC).strftime("%Y-%m-%d")
    salt = hmac.new(_SALT_KEY, day.encode(), hashlib.sha256).digest()
    return hmac.new(salt, f"{ip}|{ua or ''}".encode(), hashlib.sha256).hexdigest()[:32]


async def record_tap(
    session: AsyncSession,
    *,
    business: Business,
    card: Card | None,
    source: str,
    result: str,
    action_type: str | None,
    device: Device | None = None,
    nfc_event_id: uuid.UUID | None = None,
    scanned_uid: str | None = None,
    ip: str | None = None,
    ua: str | None = None,
    country: str | None = None,
) -> CardTap:
    bot = is_bot(ua) if source == "web" else False
    vhash = visitor_hash(ip, ua) if source == "web" and not bot else None
    assignee = assignee_of(card) if card is not None else None
    now = datetime.now(UTC)
    tap = CardTap(
        business_id=business.id,
        card_id=card.id if card else None,
        card_name=card.name if card else None,
        card_kind=card.kind if card else None,
        assignee_type=assignee["type"] if assignee else None,
        assignee_id=assignee["id"] if assignee else None,
        assignee_name=assignee["name"] if assignee else None,
        source=source,
        action_type=action_type,
        result=result,
        device_id=device.id if device else None,
        device_name=device.name if device else None,
        nfc_event_id=nfc_event_id,
        scanned_uid=scanned_uid,
        visitor_hash=vhash,
        device_type=device_type(ua) if source == "web" else "android",
        browser=browser(ua) if source == "web" else None,
        country=country,
        is_bot=bot,
        created_at=now,
    )
    if card is not None and not bot:
        new_visitor = False
        if vhash:
            seen = (await session.execute(
                select(CardTap.id).where(CardTap.card_id == card.id, CardTap.visitor_hash == vhash).limit(1)
            )).first()
            new_visitor = seen is None
        await session.execute(
            update(Card).where(Card.id == card.id).values(
                total_taps=Card.total_taps + 1,
                unique_visitors=Card.unique_visitors + (1 if new_visitor else 0),
                last_tap_at=now,
            ).execution_options(synchronize_session=False)
        )
        if card.employee_id:
            await session.execute(update(Employee).where(Employee.id == card.employee_id).values(
                total_taps=Employee.total_taps + 1, last_tap_at=now).execution_options(synchronize_session=False))
        elif card.customer_id:
            await session.execute(update(Customer).where(Customer.id == card.customer_id).values(
                total_taps=Customer.total_taps + 1, last_tap_at=now).execution_options(synchronize_session=False))
    session.add(tap)
    if not bot:
        await publish_tap(session, business, tap)
    return tap


async def publish_tap(session: AsyncSession, business: Business, tap: CardTap) -> None:
    """Live mode (§8): `business.tap` to every active application of the business."""
    from app.services import live

    app_ids = (await session.execute(select(Application.id).where(
        Application.business_id == business.id, Application.deleted_at.is_(None)))).scalars().all()
    data = {"card_id": str(tap.card_id) if tap.card_id else None, "card_name": tap.card_name,
            "assignee_name": tap.assignee_name, "result": tap.result, "action_type": tap.action_type,
            "source": tap.source}
    for app_id in app_ids:
        live.publish_later(app_id, "business.tap", data)


async def create_webhook_event(
    session: AsyncSession,
    *,
    business: Business,
    card: Card,
    application_id: uuid.UUID | None,
    source: str,
    device: Device | None,
    tap: CardTap,
) -> NfcEvent | None:
    """A `card.tapped` NfcEvent for a developer_webhook action; queued for the normal signed pipeline."""
    if application_id is None:
        return None
    app = await session.get(Application, application_id)
    if app is None or app.business_id != business.id or app.deleted_at is not None or not app.is_active:
        return None
    now = datetime.now(UTC)
    assignee = assignee_of(card)
    event = NfcEvent(
        id=uuid.uuid4(),
        application_id=app.id,
        device_id=device.id if device else None,
        owner_id=app.owner_id,
        event_type="card.tapped",
        card_id=(card.uid or card.public_code)[:64],
        card_type=None,
        card_technologies=[],
        delivery_mode="relay",
        status="retrying",
        attempts=0,
        detected_at=now,
        received_at=now,
        next_attempt_at=now,
        extra={
            "tap": {
                "id": str(tap.id) if tap.id else None,
                "source": source,
                "business_id": str(business.id),
                "card": {"id": str(card.id), "name": card.name, "kind": card.kind, "public_code": card.public_code,
                         "tap_url": tap_url(card.public_code)},
                "assignee": ({"type": assignee["type"], "id": str(assignee["id"]), "name": assignee["name"]}
                             if assignee else None),
            }
        },
    )
    event.application = app
    session.add(event)
    await usage.bump(session, application_id=app.id, owner_id=app.owner_id, day=now.date(), events=1)
    return event


# ── Reader taps (business devices, §C2) ─────────────────────────────────────
@dataclass
class ReaderOutcome:
    block: dict[str, Any]
    tap: CardTap
    webhook_event: NfcEvent | None


def _message(result: str, card: Card | None, eff: str | None) -> str:
    if result == "unknown_card":
        return "Unknown card"
    assert card is not None
    assignee = assignee_of(card)
    if result == "inactive":
        who = assignee["name"] if assignee else card.name
        return f"{who} · {'owner inactive' if eff == 'inactive_owner' else 'inactive'}"
    if assignee:
        detail = assignee.get("position") or ("Customer" if assignee["type"] == "customer" else card.name)
        return f"{assignee['name']} · {detail}"
    return card.name


async def resolve_reader_tap(
    session: AsyncSession, *, business: Business, device: Device, card_uid: str, nfc_event_id: uuid.UUID,
) -> ReaderOutcome:
    card = (await session.execute(
        select(Card).where(Card.business_id == business.id, Card.uid == card_uid, Card.deleted_at.is_(None))
    )).scalar_one_or_none()
    if card is None:
        tap = await record_tap(session, business=business, card=None, source="reader", result="unknown_card",
                               action_type=None, device=device, nfc_event_id=nfc_event_id, scanned_uid=card_uid)
        block = {"result": "unknown_card", "card": None, "assignee": None, "action": None,
                 "message": _message("unknown_card", None, None)}
        return ReaderOutcome(block, tap, None)

    eff = card_effective_status(card, business)
    assignee = assignee_of(card)
    card_info = {"id": str(card.id), "name": card.name, "kind": card.kind, "status": card.status,
                 "effective_status": eff}
    assignee_info = ({"type": assignee["type"], "id": str(assignee["id"]), "name": assignee["name"],
                      "position": assignee.get("position"), "photo_url": assignee.get("photo_url")}
                     if assignee else None)
    if eff in ("inactive", "inactive_owner", "business_suspended"):
        tap = await record_tap(session, business=business, card=card, source="reader", result="inactive",
                               action_type=None, device=device, nfc_event_id=nfc_event_id, scanned_uid=card_uid)
        block = {"result": "inactive", "card": card_info, "assignee": assignee_info, "action": None,
                 "message": _message("inactive", card, eff)}
        return ReaderOutcome(block, tap, None)

    action = effective_action(card, business)
    res: Resolution = await resolve(session, business, card, action)
    tap = await record_tap(session, business=business, card=card, source="reader",
                           result=RESULT_BY_KIND.get(res.kind, "redirected"), action_type=res.action_type,
                           device=device, nfc_event_id=nfc_event_id, scanned_uid=card_uid)
    await session.flush()
    webhook_event = None
    if res.kind == "webhook":
        webhook_event = await create_webhook_event(
            session, business=business, card=card, application_id=res.webhook_application_id,
            source="reader", device=device, tap=tap,
        )
    block = {
        "result": "recognized",
        "card": card_info,
        "assignee": assignee_info,
        "action": {"type": res.action_type, "label": res.label, "url": res.url if res.kind != "vcard" or res.url else None},
        "message": _message("recognized", card, eff),
    }
    return ReaderOutcome(block, tap, webhook_event)


async def block_for_existing_event(session: AsyncSession, nfc_event_id: uuid.UUID) -> dict[str, Any] | None:
    """Rebuilds the `business` response block for an idempotent replay."""
    tap = (await session.execute(
        select(CardTap).where(CardTap.nfc_event_id == nfc_event_id, CardTap.source == "reader").limit(1)
    )).scalar_one_or_none()
    if tap is None:
        return None
    card = await session.get(Card, tap.card_id) if tap.card_id else None
    business = await session.get(Business, tap.business_id)
    if card is None or business is None:
        return {"result": "unknown_card", "card": None, "assignee": None, "action": None, "message": "Unknown card"}
    eff = card_effective_status(card, business)
    assignee = assignee_of(card)
    result = "inactive" if tap.result == "inactive" else "recognized"
    res = await resolve(session, business, card) if result == "recognized" else None
    return {
        "result": result,
        "card": {"id": str(card.id), "name": card.name, "kind": card.kind, "status": card.status,
                 "effective_status": eff},
        "assignee": ({"type": assignee["type"], "id": str(assignee["id"]), "name": assignee["name"],
                      "position": assignee.get("position"), "photo_url": assignee.get("photo_url")}
                     if assignee else None),
        "action": {"type": res.action_type, "label": res.label, "url": res.url} if res else None,
        "message": _message(result, card, eff),
    }
