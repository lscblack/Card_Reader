"""Physical chips registered outside businesses: to a personal digital card, or to a developer application."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk


class ChipRegistration(UUIDPk, Timestamps, Base):
    """One row per registered chip UID. Business cards live in `cards`; a UID is unique across both tables."""

    __tablename__ = "chip_registrations"
    __table_args__ = (
        CheckConstraint("(digital_card_id IS NOT NULL)::int + (application_id IS NOT NULL)::int = 1",
                        name="single_target"),
        Index("uq_chip_registrations_uid", "uid", unique=True),
        Index("ix_chip_registrations_user", "user_id", "created_at"),
        Index("ix_chip_registrations_application", "application_id", "created_at"),
    )

    uid: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # personal: tapping the chip opens this card
    digital_card_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("digital_cards.id", ondelete="CASCADE"))
    # developer: the chip is one of this application's known cards
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"))
    label: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(String(500))
    taps: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_tap_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
