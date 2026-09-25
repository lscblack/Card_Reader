from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAt, UUIDPk
from app.models.application import Application, Device

EVENT_STATUSES = ("pending", "delivered", "retrying", "failed")
TERMINAL_STATUSES = ("delivered", "failed")


class NfcEvent(CreatedAt, Base):
    """A card tap. `id` is the phone-generated event_id (idempotency key)."""

    __tablename__ = "nfc_events"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','delivered','retrying','failed','logged')", name="status"
        ),
        CheckConstraint("delivery_mode IN ('relay','direct')", name="delivery_mode"),
        Index("ix_nfc_events_owner_received", "owner_id", "received_at"),
        Index("ix_nfc_events_app_received", "application_id", "received_at"),
        Index("ix_nfc_events_device_received", "device_id", "received_at"),
        Index("ix_nfc_events_owner_card", "owner_id", "card_id"),
        Index(
            "ix_nfc_events_retry_due",
            "next_attempt_at",
            postgresql_where=text("status = 'retrying'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    # NULL for business web taps delivered through a `developer_webhook` action (no reader involved).
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("devices.id", ondelete="CASCADE"), nullable=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, default="card.detected")
    card_id: Mapped[str] = mapped_column(String(64), nullable=False)
    card_type: Mapped[str | None] = mapped_column(String(64))
    card_technologies: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    delivery_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_status_code: Mapped[int | None] = mapped_column(Integer)
    last_error: Mapped[str | None] = mapped_column(Text)
    last_error_code: Mapped[str | None] = mapped_column(String(64))
    # Extra payload fields for business `card.tapped` events (card, assignee, source).
    extra: Mapped[dict | None] = mapped_column(JSONB)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    application: Mapped[Application] = relationship(lazy="joined", innerjoin=True)
    device: Mapped[Device | None] = relationship(lazy="joined")


class Delivery(UUIDPk, CreatedAt, Base):
    __tablename__ = "deliveries"
    __table_args__ = (
        CheckConstraint("mode IN ('relay','direct')", name="mode"),
        Index("ix_deliveries_owner_created", "owner_id", "created_at"),
        Index("ix_deliveries_app_created", "application_id", "created_at"),
        Index("ix_deliveries_event", "event_id", "attempt"),
        Index("ix_deliveries_error_code", "error_code", "created_at",
              postgresql_where=text("error_code IS NOT NULL")),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("nfc_events.id", ondelete="CASCADE"), nullable=False
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048))
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(64))
    response_excerpt: Mapped[str | None] = mapped_column(String(500))


class UsageDaily(Base):
    """Per-application daily counters (bucketed by event received_at, UTC)."""

    __tablename__ = "usage_daily"
    __table_args__ = (Index("ix_usage_daily_owner_date", "owner_id", "day"),)

    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    events: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delivered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AuditLog(UUIDPk, CreatedAt, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_user_created", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(32))
    resource_id: Mapped[str | None] = mapped_column(String(64))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    meta: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)


