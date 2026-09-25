from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
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


class Application(UUIDPk, Timestamps, Base):
    __tablename__ = "applications"
    __table_args__ = (
        CheckConstraint("delivery_mode IN ('relay','direct')", name="delivery_mode"),
        CheckConstraint(
            "endpoint_timeout_seconds BETWEEN 1 AND 30", name="endpoint_timeout_seconds"
        ),
        Index("ix_applications_owner_active", "owner_id", postgresql_where=text("deleted_at IS NULL")),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Part 2 §B8: applications may belong to a business workspace (NULL = developer-owned).
    business_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    delivery_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="relay")

    endpoint_url: Mapped[str | None] = mapped_column(String(2048))
    endpoint_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    endpoint_timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    endpoint_custom_headers: Mapped[dict[str, str]] = mapped_column(
        JSONB, nullable=False, default=dict
    )
    endpoint_last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    endpoint_last_test_success: Mapped[bool | None] = mapped_column(Boolean)

    # Endpoint host allowlist (contract 7.1). Empty = no restriction beyond SSRF rules.
    allowed_domains: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )

    webhook_secret_encrypted: Mapped[str | None] = mapped_column(Text)
    webhook_secret_last4: Mapped[str | None] = mapped_column(String(4))
    webhook_secret_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApiKey(UUIDPk, CreatedAt, Base):
    __tablename__ = "api_keys"
    __table_args__ = (Index("ix_api_keys_owner_created", "owner_id", "created_at"),)

    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    last4: Mapped[str] = mapped_column(String(4), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    application: Mapped[Application] = relationship(lazy="joined", innerjoin=True)

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None


class Device(UUIDPk, Timestamps, Base):
    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint("status IN ('active','revoked')", name="status"),
        Index("ix_devices_owner_status", "owner_id", "status"),
        Index("ix_devices_app_installation", "application_id", "installation_id"),
    )

    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    registered_by_api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("api_keys.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="android")
    model: Mapped[str | None] = mapped_column(String(100))
    os_version: Mapped[str | None] = mapped_column(String(64))
    app_version: Mapped[str | None] = mapped_column(String(32))
    installation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_ip: Mapped[str | None] = mapped_column(String(64))
    events_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    assigned_employee_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("employees.id", ondelete="SET NULL")
    )

    application: Mapped[Application] = relationship(lazy="joined", innerjoin=True)


class AllowedOrigin(UUIDPk, CreatedAt, Base):
    """Admin-managed CORS origin (contract 7.2), in addition to env CORS_ORIGINS."""

    __tablename__ = "allowed_origins"

    origin: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )


class PairingCode(UUIDPk, CreatedAt, Base):
    """Single-use QR pairing code (contract 7.3). Only the SHA-256 hash is stored."""

    __tablename__ = "pairing_codes"
    __table_args__ = (Index("ix_pairing_codes_app_created", "application_id", "created_at"),)

    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(100))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("devices.id", ondelete="SET NULL")
    )

    application: Mapped[Application] = relationship(lazy="joined", innerjoin=True)

    def status_at(self, now: datetime) -> str:
        if self.used_at is not None:
            return "used"
        if self.cancelled_at is not None or self.expires_at <= now:
            return "expired"
        return "pending"
