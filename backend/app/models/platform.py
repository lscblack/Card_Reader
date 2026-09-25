"""Platform observability & tooling (Part 2 §A): request logs, platform settings, sandbox."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAt, UUIDPk


class RequestLog(Base):
    __tablename__ = "request_logs"
    __table_args__ = (
        Index("ix_request_logs_created", "created_at"),
        Index("ix_request_logs_user_created", "user_id", "created_at"),
        Index("ix_request_logs_business_created", "business_id", "created_at"),
        Index("ix_request_logs_app_created", "application_id", "created_at"),
        Index("ix_request_logs_device_created", "device_id", "created_at"),
        Index("ix_request_logs_status", "status_code", "created_at"),
        Index("ix_request_logs_route", "route", "created_at"),
        Index("ix_request_logs_request_id", "request_id"),
        Index("ix_request_logs_error_code", "error_code", "created_at",
              postgresql_where=text("error_code IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    route: Mapped[str] = mapped_column(String(200), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64))
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    application_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    device_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    ip_hash: Mapped[str | None] = mapped_column(String(32))
    user_agent: Mapped[str | None] = mapped_column(String(256))
    country: Mapped[str | None] = mapped_column(String(2))


class PlatformSetting(Base):
    """Single-row key/value store for admin-editable platform settings."""

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))


class SandboxEndpoint(UUIDPk, CreatedAt, Base):
    __tablename__ = "sandbox_endpoints"
    __table_args__ = (
        Index("ix_sandbox_endpoints_owner", "owner_id"),
        Index("ix_sandbox_endpoints_business", "business_id"),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"))
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    token: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False, default=200)
    response_delay_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    response_body: Mapped[str] = mapped_column(Text, nullable=False, default='{"ok":true}')
    response_headers: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    request_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_request_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SandboxRequest(UUIDPk, Base):
    __tablename__ = "sandbox_requests"
    __table_args__ = (Index("ix_sandbox_requests_endpoint_received", "endpoint_id", "received_at"),)

    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("sandbox_endpoints.id", ondelete="CASCADE"), nullable=False
    )
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    query: Mapped[str | None] = mapped_column(String(2048))
    headers: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    body: Mapped[str | None] = mapped_column(Text)
    body_json: Mapped[dict | list | None] = mapped_column(JSONB)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_ip_hash: Mapped[str | None] = mapped_column(String(32))
    signature: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    checks: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_delay_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    event_id: Mapped[str | None] = mapped_column(String(64))
    device_id: Mapped[str | None] = mapped_column(String(64))
