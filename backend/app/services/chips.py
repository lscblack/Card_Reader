"""Chips registered to a personal digital card or a developer application (`chip_registrations`).

A chip UID is registered at most once on the whole platform: business `cards` and `chip_registrations` are both
checked before either is written, and each table has its own unique index as the backstop.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import Application, Card, ChipRegistration, DigitalCard


def uid_taken() -> AppError:
    return AppError(409, "card_uid_taken", "This card is already registered and cannot be set up again")


async def chip_for_uid(session: AsyncSession, uid: str) -> ChipRegistration | None:
    return (await session.execute(select(ChipRegistration).where(ChipRegistration.uid == uid))).scalar_one_or_none()


async def ensure_free(session: AsyncSession, uid: str, *, user_id: uuid.UUID) -> None:
    """409 unless nobody registered this chip. The caller's own registration is named (it leaks nothing)."""
    card = (await session.execute(select(Card.id).where(Card.uid == uid, Card.deleted_at.is_(None)).limit(1))).first()
    if card is not None:
        raise uid_taken()
    chip = await chip_for_uid(session, uid)
    if chip is None:
        return
    if chip.user_id == user_id:
        raise AppError(409, "card_uid_exists", "You already registered this card",
                       {"chip_id": str(chip.id), "label": chip.label,
                        "digital_card_id": str(chip.digital_card_id) if chip.digital_card_id else None,
                        "application_id": str(chip.application_id) if chip.application_id else None})
    raise uid_taken()


async def uid_registered_as_chip(session: AsyncSession, uid: str) -> bool:
    return (await session.execute(select(ChipRegistration.id).where(ChipRegistration.uid == uid))).first() is not None


def chip_out(chip: ChipRegistration, card: DigitalCard | None = None) -> dict[str, Any]:
    return {
        "id": chip.id,
        "uid": chip.uid,
        "label": chip.label,
        "note": chip.note,
        "digital_card_id": chip.digital_card_id,
        "digital_card_label": card.label if card is not None else None,
        "application_id": chip.application_id,
        "taps": chip.taps,
        "last_tap_at": chip.last_tap_at,
        "created_at": chip.created_at,
    }


async def app_card_for_tap(session: AsyncSession, app: Application, uid: str) -> dict[str, Any]:
    """Developer devices: `{registered, id?, label?}` for the device's tap response; counts the tap."""
    chip = (await session.execute(select(ChipRegistration).where(
        ChipRegistration.uid == uid, ChipRegistration.application_id == app.id))).scalar_one_or_none()
    if chip is None:
        # registered elsewhere (a business, a person, another app): not this app's to register
        taken = await uid_registered_as_chip(session, uid) or (await session.execute(
            select(Card.id).where(Card.uid == uid, Card.deleted_at.is_(None)).limit(1))).first() is not None
        return {"registered": False, "can_register": not taken}
    chip.taps += 1
    chip.last_tap_at = datetime.now(UTC)
    return {"registered": True, "id": str(chip.id), "label": chip.label}


async def personal_card_for_uid(session: AsyncSession, uid: str) -> DigitalCard | None:
    """The live digital card a chip opens, if a person registered it."""
    row = (await session.execute(
        select(ChipRegistration, DigitalCard)
        .join(DigitalCard, DigitalCard.id == ChipRegistration.digital_card_id)
        .where(ChipRegistration.uid == uid, DigitalCard.deleted_at.is_(None), DigitalCard.status == "active")
    )).first()
    if row is None:
        return None
    chip, card = row
    chip.taps += 1
    chip.last_tap_at = datetime.now(UTC)
    return card
