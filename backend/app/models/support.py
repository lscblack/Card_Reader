"""Customer support requests (the Support page), answered from Admin → Support."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk

SUPPORT_CATEGORIES = ("billing", "technical", "account", "cards", "feedback", "other")
SUPPORT_STATUSES = ("open", "in_progress", "resolved")


class SupportTicket(UUIDPk, Timestamps, Base):
    __tablename__ = "support_tickets"
    __table_args__ = (
        CheckConstraint("status IN ('open','in_progress','resolved')", name="status"),
    )

    # Set when the request was sent while signed in.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40))
    category: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    admin_note: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
