"""Dashboard resource schemas: applications, API keys, devices, events, deliveries, usage."""

from __future__ import annotations

import re
import uuid
from datetime import date
from typing import Any, Literal

from pydantic import Field, field_validator

from app.schemas.common import Schema, UTCDateTime

DeliveryMode = Literal["relay", "direct"]
EventStatus = Literal["pending", "delivered", "retrying", "failed", "logged"]

HEADER_NAME_RE = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$")
RESERVED_HEADERS = {
    "host",
    "content-type",
    "content-length",
    "user-agent",
    "transfer-encoding",
    "connection",
    "authorization-signature",
}
MAX_CUSTOM_HEADERS = 20


def validate_custom_headers(headers: dict[str, str] | None) -> dict[str, str]:
    headers = headers or {}
    if len(headers) > MAX_CUSTOM_HEADERS:
        raise ValueError(f"at most {MAX_CUSTOM_HEADERS} custom headers are allowed")
    clean: dict[str, str] = {}
    for name, value in headers.items():
        if not HEADER_NAME_RE.match(name):
            raise ValueError(f"invalid header name: {name!r}")
        lower = name.lower()
        if lower in RESERVED_HEADERS or lower.startswith("x-nfc-"):
            raise ValueError(f"header {name!r} is reserved")
        if not isinstance(value, str) or len(value) > 1024 or "\r" in value or "\n" in value:
            raise ValueError(f"invalid value for header {name!r}")
        clean[name] = value
    return clean


# ── Applications ────────────────────────────────────────────────────────
class EndpointConfig(Schema):
    url: str | None
    enabled: bool
    timeout_seconds: int
    custom_headers: dict[str, str]
    last_tested_at: UTCDateTime | None
    last_test_success: bool | None


class WebhookSecretInfo(Schema):
    configured: bool
    last4: str | None
    rotated_at: UTCDateTime | None


class ApplicationOut(Schema):
    id: uuid.UUID
    name: str
    description: str | None
    is_active: bool
    delivery_mode: DeliveryMode
    endpoint: EndpointConfig
    webhook_secret: WebhookSecretInfo
    allowed_domains: list[str]
    device_count: int
    created_at: UTCDateTime
    updated_at: UTCDateTime


class ApplicationCreateIn(Schema):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    delivery_mode: DeliveryMode = "relay"
    endpoint_url: str | None = Field(default=None, max_length=2048)
    webhook_secret: str | None = Field(default=None, min_length=24, max_length=256)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class ApplicationUpdateIn(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None


class EndpointUpdateIn(Schema):
    url: str | None = Field(default=None, max_length=2048)
    enabled: bool
    timeout_seconds: int | None = Field(default=None, ge=1, le=30)
    custom_headers: dict[str, str] | None = None
    delivery_mode: DeliveryMode | None = None

    @field_validator("custom_headers")
    @classmethod
    def _headers(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        return None if v is None else validate_custom_headers(v)


class AllowedDomainsIn(Schema):
    domains: list[str] = Field(max_length=100)


class EndpointTestOut(Schema):
    success: bool
    status_code: int | None
    latency_ms: int | None
    error: str | None
    error_code: str | None = None
    error_ref: str | None = None
    response_excerpt: str | None


class RotateSecretIn(Schema):
    webhook_secret: str | None = Field(default=None, min_length=24, max_length=256)


class RotateSecretOut(Schema):
    webhook_secret_plaintext: str
    last4: str
    rotated_at: UTCDateTime


# ── API keys ────────────────────────────────────────────────────────────
class ApiKeyOut(Schema):
    id: uuid.UUID
    application_id: uuid.UUID
    application_name: str
    name: str
    prefix: str
    last4: str
    created_at: UTCDateTime
    last_used_at: UTCDateTime | None
    revoked_at: UTCDateTime | None
    is_active: bool


class ApiKeyCreateIn(Schema):
    application_id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)


class ApiKeyCreatedOut(Schema):
    api_key: ApiKeyOut
    plaintext: str


class ApplicationCreatedOut(Schema):
    application: ApplicationOut
    api_key: ApiKeyOut
    api_key_plaintext: str
    webhook_secret_plaintext: str


# ── Devices ─────────────────────────────────────────────────────────────
class DeviceOut(Schema):
    id: uuid.UUID
    application_id: uuid.UUID
    application_name: str
    name: str
    platform: str
    model: str | None
    os_version: str | None
    app_version: str | None
    status: Literal["active", "revoked"]
    last_seen_at: UTCDateTime | None
    last_ip: str | None
    events_count: int
    created_at: UTCDateTime


class DeviceRenameIn(Schema):
    name: str = Field(min_length=1, max_length=100)


# ── Events & deliveries ─────────────────────────────────────────────────
class EventOut(Schema):
    id: uuid.UUID
    application_id: uuid.UUID
    application_name: str
    device_id: uuid.UUID | None
    device_name: str | None
    event_type: str
    card_id: str
    card_type: str | None
    card_technologies: list[str]
    authenticated: bool = False
    delivery_mode: DeliveryMode
    status: EventStatus
    attempts: int
    last_status_code: int | None
    last_error: str | None
    error_code: str | None = None
    error_ref: str | None = None
    detected_at: UTCDateTime
    received_at: UTCDateTime
    delivered_at: UTCDateTime | None


class DeliveryOut(Schema):
    id: uuid.UUID
    event_id: uuid.UUID
    application_id: uuid.UUID
    attempt: int
    mode: DeliveryMode
    url: str | None
    success: bool
    status_code: int | None
    latency_ms: int | None
    error: str | None
    error_code: str | None = None
    error_ref: str | None = None
    response_excerpt: str | None
    created_at: UTCDateTime


class EventDetailOut(EventOut):
    deliveries: list[DeliveryOut]


# ── Overview, usage, billing, audit ─────────────────────────────────────
class OverviewOut(Schema):
    applications: int
    active_devices: int
    active_api_keys: int
    events_today: int
    events_this_month: int
    delivery_success_rate: float
    recent_events: list[EventOut]


class PlanOut(Schema):
    code: str
    name: str
    price_monthly_cents: int
    currency: str
    events_per_month: int | None
    max_applications: int | None
    max_devices: int | None
    features: list[str]
    audience: Literal["developer", "business", "personal"] = "developer"
    max_cards: int | None = None
    max_members: int | None = None
    max_contacts: int | None = None
    # Part 3 §2
    price_yearly_cents: int | None = None
    is_active: bool = True
    is_featured: bool = False
    sort_order: int = 0
    badge: str | None = None
    description: str | None = None
    promotion: dict[str, Any] | None = None


class SubscriptionOut(Schema):
    plan: PlanOut
    status: str
    current_period_start: UTCDateTime
    current_period_end: UTCDateTime


class UsageTotals(Schema):
    events: int
    delivered: int
    failed: int
    applications: int
    devices: int


class UsageLimits(Schema):
    events_per_month: int | None
    applications: int | None
    devices: int | None


class UsageDay(Schema):
    date: date
    events: int
    delivered: int
    failed: int


class UsageOut(Schema):
    plan: PlanOut
    period_start: UTCDateTime
    period_end: UTCDateTime
    totals: UsageTotals
    limits: UsageLimits
    daily: list[UsageDay]


class AuditLogOut(Schema):
    id: uuid.UUID
    action: str
    resource_type: str | None
    resource_id: str | None
    ip_address: str | None
    user_agent: str | None
    metadata: dict[str, Any]
    created_at: UTCDateTime


# ── Allowed origins (admin, 7.2) ────────────────────────────────────────
class AllowedOriginOut(Schema):
    id: uuid.UUID
    origin: str
    note: str | None
    created_by: uuid.UUID | None
    created_by_email: str | None = None
    created_at: UTCDateTime


class AllowedOriginCreateIn(Schema):
    origin: str = Field(min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=255)


class AllowedOriginsOut(Schema):
    env: list[str]
    items: list[AllowedOriginOut]


# ── Pairing codes (7.3) ─────────────────────────────────────────────────
class PairingCodeCreateIn(Schema):
    device_name: str | None = Field(default=None, max_length=100)


class PairingCodeCreatedOut(Schema):
    id: uuid.UUID
    code: str
    expires_at: UTCDateTime
    server_url: str
    qr_payload: str


class PairingCodeStatusOut(Schema):
    id: uuid.UUID
    application_id: uuid.UUID
    status: Literal["pending", "used", "expired"]
    expires_at: UTCDateTime
    used_at: UTCDateTime | None
    device: DeviceOut | None
