"""Part 4: personal accounts, mobile sessions, digital cards, contacts, activity, business card invites."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAt, Timestamps, UUIDPk
from app.models.business import Business, Employee


class PersonalSession(UUIDPk, CreatedAt, Base):
    """A signed-in phone (My Card space). One share key per session (key_id → encrypted 32-byte secret)."""

    __tablename__ = "personal_sessions"
    __table_args__ = (
        Index("ix_personal_sessions_user", "user_id", "created_at"),
        Index("ix_personal_sessions_install", "user_id", "installation_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    key_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    share_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    device_name: Mapped[str] = mapped_column(String(100), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="android")
    model: Mapped[str | None] = mapped_column(String(100))
    os_version: Mapped[str | None] = mapped_column(String(64))
    app_version: Mapped[str | None] = mapped_column(String(32))
    installation_id: Mapped[str | None] = mapped_column(String(64))
    internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # server-side key for web QR codes
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PersonalLoginCode(UUIDPk, CreatedAt, Base):
    __tablename__ = "personal_login_codes"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
                                               index=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("personal_sessions.id", ondelete="SET NULL"))


class CardTemplate(Base):
    __tablename__ = "card_templates"
    __table_args__ = (
        CheckConstraint("layout IN ('centered','left','split','hero_photo','banner','compact')", name="layout"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    layout: Mapped[str] = mapped_column(String(16), nullable=False)
    default_design: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    supports: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    premium: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class DigitalCard(UUIDPk, Timestamps, Base):
    __tablename__ = "digital_cards"
    __table_args__ = (
        CheckConstraint("status IN ('active','inactive')", name="status"),
        Index("ix_digital_cards_user", "user_id", "created_at"),
        Index("ix_digital_cards_business", "business_id", "employee_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    share_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, nullable=False, default=uuid.uuid4)
    label: Mapped[str] = mapped_column(String(60), nullable=False, default="Personal")
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active")
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    template_id: Mapped[str] = mapped_column(String(32), ForeignKey("card_templates.id"), nullable=False)
    design: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    photo_path: Mapped[str | None] = mapped_column(String(300))
    cover_path: Mapped[str | None] = mapped_column(String(300))
    logo_path: Mapped[str | None] = mapped_column(String(300))
    fields: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    visibility: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    share_settings: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # §6 business link
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="SET NULL"))
    employee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("employees.id", ondelete="SET NULL"))
    locked_fields: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    template_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    nfc_taps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exchanges: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    leads: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    business: Mapped[Business | None] = relationship(lazy="joined")
    employee: Mapped[Employee | None] = relationship(lazy="joined")
    template: Mapped[CardTemplate] = relationship(lazy="joined", innerjoin=True)


class Contact(UUIDPk, Timestamps, Base):
    __tablename__ = "contacts"
    __table_args__ = (
        CheckConstraint("source IN ('nfc_exchange','qr_exchange','web_lead','manual')", name="source"),
        Index("ix_contacts_owner_created", "owner_id", "created_at"),
        Index("ix_contacts_owner_counterpart", "owner_id", "counterpart_card_id"),
        Index("ix_contacts_counterpart_live", "counterpart_card_id", postgresql_where=text("live")),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    owner_card_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("digital_cards.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    counterpart_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    counterpart_card_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("digital_cards.id", ondelete="SET NULL"))
    card: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # "public" or "contacts": which visibility level this contact is entitled to (for live refreshes)
    access_level: Mapped[str] = mapped_column(String(12), nullable=False, default="public")
    live: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    met_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PersonalActivity(UUIDPk, CreatedAt, Base):
    __tablename__ = "personal_activity"
    __table_args__ = (
        Index("ix_personal_activity_user_created", "user_id", "created_at"),
        Index("ix_personal_activity_card_created", "card_id", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    card_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("digital_cards.id", ondelete="SET NULL"))
    type: Mapped[str] = mapped_column(String(24), nullable=False)  # view | nfc_tap | exchange | lead | terminal_read
    source: Mapped[str | None] = mapped_column(String(16))  # nfc | qr | link | web | terminal
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class DigitalCardInvite(UUIDPk, CreatedAt, Base):
    __tablename__ = "digital_card_invites"
    __table_args__ = (Index("ix_digital_card_invites_email", "email", "created_at"),)

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"),
                                                   nullable=False)
    employee_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("employees.id", ondelete="CASCADE"),
                                                   nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    template_id: Mapped[str | None] = mapped_column(String(32))
    design: Mapped[dict | None] = mapped_column(JSONB)
    locked_fields: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    declined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    card_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("digital_cards.id", ondelete="SET NULL"))

    business: Mapped[Business] = relationship(lazy="joined", innerjoin=True)

    def status_at(self, now: datetime) -> str:
        if self.accepted_at is not None:
            return "accepted"
        if self.declined_at is not None:
            return "declined"
        if self.revoked_at is not None:
            return "revoked"
        if self.expires_at <= now:
            return "expired"
        return "pending"
