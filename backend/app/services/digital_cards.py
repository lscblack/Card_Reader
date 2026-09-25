"""Part 4 §5: terminals (developer & business devices) reading a phone's digital card."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_catalog import ref_for
from app.core.errors import AppError
from app.models import Application, Business, CardTap, DigitalCard, Device, NfcEvent
from app.services import card_tokens, personal

PAYLOAD_FIELDS = ("full_name", "headline", "company", "job_title")


@dataclass
class TerminalOutcome:
    block: dict[str, Any] | None
    webhook_event: NfcEvent | None = None


@dataclass
class DigitalRead:
    share_id: str | None
    verified: bool
    error_code: str | None
    card: DigitalCard | None
    payload: dict[str, Any]
    response: dict[str, Any]
    outcome: TerminalOutcome | None = field(default=None)


def _public_payload(card: DigitalCard) -> dict[str, Any]:
    """Only fields whose visibility is `public` (others are null)."""
    fields = personal.filtered_fields(card, "public")
    images = personal.image_urls(card, "public")
    return {"id": str(card.share_id), "verified": True, **{k: fields.get(k) for k in PAYLOAD_FIELDS},
            "photo_url": images["photo_url"], "public_url": personal.public_url(card)}


async def read_by_terminal(session: AsyncSession, token: str, card_id: str, app: Application,
                           business: Business | None) -> DigitalRead:
    share_hex = None
    try:
        parsed = card_tokens.parse(token)
        share_hex = parsed.share_id.hex.upper()
    except card_tokens.TokenError:
        parsed = None
    if share_hex is not None and card_id != share_hex:
        raise AppError(422, "card_id_mismatch", "card_id must equal the token's share_id (32 uppercase hex chars)",
                       [{"field": "body.card_id", "message": f"expected {share_hex}"}])
    share_id = str(parsed.share_id) if parsed else None
    try:
        resolved = await personal.resolve_token(session, token)  # checks nfc_sharing_enabled
    except AppError as exc:
        payload = {"id": share_id, "verified": False}
        return DigitalRead(share_id, False, exc.code, None, payload,
                           {"verified": False, "error_code": exc.code, "error_ref": ref_for(exc.code)})
    card = resolved.card
    return DigitalRead(share_id, True, None, card, _public_payload(card),
                       {"verified": True, "error_code": None, "error_ref": None})


async def after_event(session: AsyncSession, read: DigitalRead, event: NfcEvent, device: Device, app: Application,
                      business: Business | None) -> None:
    card = read.card
    if card is not None:
        reader = business.name if business is not None else app.name
        card.nfc_taps += 1
        personal.record_activity(session, card.user_id, card.id, "terminal_read", f"Read by a terminal of {reader}",
                                 "nfc", counterpart_name=reader)
    if business is None:
        return
    if card is None:
        read.outcome = TerminalOutcome({"result": "unknown_card", "card": None, "assignee": None, "action": None,
                                        "message": "Digital card could not be verified",
                                        "digital_card": read.response})
        return
    info = read.payload
    if card.business_id == business.id and card.employee is not None:
        emp = card.employee
        from app.services.business import media_url

        assignee = {"type": "employee", "id": str(emp.id), "name": emp.full_name, "position": emp.position,
                    "photo_url": media_url(emp.photo_path)}
        tap = CardTap(
            business_id=business.id, card_id=None, card_name=card.label, card_kind="digital",
            assignee_type="employee", assignee_id=emp.id, assignee_name=emp.full_name, source="reader",
            action_type=None, result="recognized", device_id=device.id, device_name=device.name,
            nfc_event_id=event.id, scanned_uid=read.share_id, visitor_hash=None, device_type="android",
            browser=None, country=None, is_bot=False, created_at=datetime.now(UTC))
        session.add(tap)
        from app.services.taps import publish_tap

        await publish_tap(session, business, tap)

        read.outcome = TerminalOutcome({
            "result": "recognized",
            "card": {"id": str(card.id), "name": card.label, "kind": "digital", "status": "active",
                     "effective_status": "active"},
            "assignee": assignee, "action": {"type": "profile", "label": None, "url": info["public_url"]},
            "message": f"{emp.full_name} · {emp.position}" if emp.position else emp.full_name,
            "digital_card": read.response})
        return
    name = info.get("full_name") or "Digital card"
    detail = " · ".join(x for x in (info.get("job_title"), info.get("company")) if x)
    read.outcome = TerminalOutcome({
        "result": "digital_card",
        "card": {"id": str(card.id), "name": card.label, "kind": "digital", "status": "active",
                 "effective_status": "active"},
        "assignee": {"type": "person", "id": str(card.share_id), "name": name, "position": info.get("job_title"),
                     "photo_url": info.get("photo_url")},
        "action": {"type": "profile", "label": None, "url": info["public_url"]},
        "message": f"{name} · {detail}" if detail else name,
        "digital_card": read.response})
