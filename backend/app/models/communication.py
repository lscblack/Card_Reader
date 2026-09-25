"""Part 3: promotions, email campaigns and email logs."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAt, Timestamps, UUIDPk


class Promotion(UUIDPk, Timestamps, Base):
    __tablename__ = "promotions"
    __table_args__ = (
        CheckConstraint("discount_type IN ('percent','amount')", name="discount_type"),
        CheckConstraint("audience IN ('developer','business','personal','all')", name="audience"),
        Index("uq_promotions_code", "code", unique=True, postgresql_where=text("code IS NOT NULL")),
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str | None] = mapped_column(String(32))
    description: Mapped[str | None] = mapped_column(String(500))
    discount_type: Mapped[str] = mapped_column(String(8), nullable=False)
    discount_value: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str | None] = mapped_column(String(3))
    audience: Mapped[str] = mapped_column(String(16), nullable=False, default="all")
    plan_codes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    show_on_landing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    banner_text: Mapped[str | None] = mapped_column(String(200))
    max_redemptions: Mapped[int | None] = mapped_column(Integer)
    redemptions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))

    def status_at(self, now: datetime) -> str:
        if not self.is_active:
            return "inactive"
        if self.ends_at is not None and self.ends_at <= now:
            return "expired"
        if self.max_redemptions is not None and self.redemptions >= self.max_redemptions:
            return "exhausted"
        if self.starts_at is not None and self.starts_at > now:
            return "scheduled"
        return "active"


class EmailCampaign(UUIDPk, CreatedAt, Base):
    __tablename__ = "email_campaigns"

    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    cta: Mapped[dict | None] = mapped_column(JSONB)
    filter: Mapped[dict | None] = mapped_column(JSONB)
    recipients: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Rendered once per campaign (no per-recipient secrets) — logs reference it instead of copying it.
    html: Mapped[str | None] = mapped_column(Text)
    text_body: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))


class EmailLog(UUIDPk, CreatedAt, Base):
    __tablename__ = "email_logs"
    __table_args__ = (
        CheckConstraint("status IN ('queued','sent','failed','logged')", name="status"),
        Index("ix_email_logs_created", "created_at"),
        Index("ix_email_logs_campaign", "campaign_id", "status"),
        Index("ix_email_logs_user", "user_id", "created_at"),
        Index("ix_email_logs_queue", "next_attempt_at", postgresql_where=text("status = 'queued'")),
    )

    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("email_campaigns.id", ondelete="SET NULL"))
    to_email: Mapped[str] = mapped_column(String(320), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    template: Mapped[str] = mapped_column(String(40), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    error: Mapped[str | None] = mapped_column(String(500))
    sent_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Stored copies never contain one-time links (replaced with "[link removed]").
    html: Mapped[str | None] = mapped_column(Text)
    text_body: Mapped[str | None] = mapped_column(Text)


class Notification(UUIDPk, CreatedAt, Base):
    """In-app notification (Part 3 §10)."""

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("severity IN ('info','success','warning','error')", name="severity"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
        Index("ix_notifications_user_unread", "user_id", postgresql_where=text("read_at IS NULL")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(500))
    severity: Mapped[str] = mapped_column(String(8), nullable=False, default="info")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AppRelease(UUIDPk, CreatedAt, Base):
    """Mobile NFC Terminal APK builds (Part 3 §9)."""

    __tablename__ = "app_releases"
    __table_args__ = (
        CheckConstraint("status IN ('queued','building','succeeded','failed','cancelled')", name="status"),
        CheckConstraint("channel IN ('stable','beta')", name="channel"),
        CheckConstraint("build_type IN ('release','debug')", name="build_type"),
        Index("ix_app_releases_published", "channel", "is_published", "created_at"),
    )

    version_name: Mapped[str] = mapped_column(String(32), nullable=False)
    build_number: Mapped[int] = mapped_column(Integer, nullable=False)
    channel: Mapped[str] = mapped_column(String(8), nullable=False, default="stable")
    build_type: Mapped[str] = mapped_column(String(8), nullable=False, default="release")
    api_base_url: Mapped[str] = mapped_column(String(300), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(String(64))
    artifact_path: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="queued")
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    publish_on_success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    log: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(String(500))
    downloads: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
