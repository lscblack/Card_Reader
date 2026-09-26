"""Part 2 schemas: businesses, team, employees, customers, cards, profiles, taps, sandbox, request logs."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import Field, field_validator

from app.schemas.common import Schema, UTCDateTime
from app.schemas.resources import DeviceOut, PlanOut

Role = Literal["owner", "admin", "manager", "staff"]
# Unique per business; also the default badge id / Code-128 barcode value (printable ASCII).
EMPLOYEE_NUMBER_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,31}$"


def _safe_link(value: str | None) -> str | None:
    """Links shown on public pages / vCards: no javascript:, data: or other non-web schemes."""
    from app.services.url_validation import unsafe_url_scheme

    if value is not None and unsafe_url_scheme(value):
        raise ValueError("must be an http(s) URL")
    return value


# ── Registration / auth additions ───────────────────────────────────────
class BusinessRegistrationIn(Schema):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    phone: str = Field(min_length=3, max_length=40)
    country: str = Field(min_length=2, max_length=2, description="ISO-3166 alpha-2")
    category: str = Field(min_length=1, max_length=48, description="Code from /meta/business-categories")
    description: str = Field(default="", max_length=2000)
    website: str | None = Field(default=None, max_length=2048)
    address: str | None = Field(default=None, max_length=500)

    @field_validator("country")
    @classmethod
    def _country(cls, v: str) -> str:
        if not v.isalpha():
            raise ValueError("country must be an ISO-3166 alpha-2 code")
        return v.upper()

    @field_validator("website")
    @classmethod
    def _website(cls, v: str | None) -> str | None:
        return _safe_link(v)


class MembershipOut(Schema):
    business_id: uuid.UUID
    business_name: str
    business_slug: str
    role: Role


class VerifyEmailIn(Schema):
    token: str = Field(min_length=10, max_length=256)


class CategoryOut(Schema):
    code: str
    label: str


# ── Business ────────────────────────────────────────────────────────────
class BusinessSettings(Schema):
    devices_can_register_cards: bool = True
    default_card_action: dict[str, Any] | None = None
    timezone: str = "UTC"


class BusinessOut(Schema):
    id: uuid.UUID
    name: str
    slug: str
    email: str | None
    phone: str | None
    country: str | None
    category: str | None
    description: str | None
    website: str | None
    address: str | None
    logo_url: str | None
    status: Literal["active", "suspended"]
    verified: bool
    settings: BusinessSettings
    plan: PlanOut | None
    public_url: str
    role: Role | None = None
    created_at: UTCDateTime


class BusinessUpdateIn(Schema):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    slug: str | None = Field(default=None, min_length=3, max_length=48)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    category: str | None = Field(default=None, max_length=48)
    description: str | None = Field(default=None, max_length=2000)
    website: str | None = Field(default=None, max_length=2048)
    address: str | None = Field(default=None, max_length=500)
    settings: dict[str, Any] | None = None

    @field_validator("website")
    @classmethod
    def _website(cls, v: str | None) -> str | None:
        return _safe_link(v)


class BusinessMeOut(Schema):
    role: Role
    permissions: list[str]


class BillingOut(Schema):
    plan: PlanOut
    usage: dict[str, int]
    limits: dict[str, int | None]
    status: str


# ── People ──────────────────────────────────────────────────────────────
class CardSummary(Schema):
    id: uuid.UUID
    name: str
    kind: str
    status: str
    effective_status: str
    public_code: str


class SocialLink(Schema):
    platform: str = Field(min_length=1, max_length=32)
    url: str = Field(min_length=1, max_length=2048)

    @field_validator("url")
    @classmethod
    def _http_url(cls, value: str) -> str:
        # Rendered as a link on the public employee page: only http(s) (no javascript:/data: URLs).
        value = value.strip()
        if not value.lower().startswith(("https://", "http://")) or len(value) < 11 or any(c.isspace() for c in value):
            raise ValueError("must be an http(s) URL")
        return value


class EmployeeOut(Schema):
    id: uuid.UUID
    business_id: uuid.UUID
    first_name: str
    last_name: str
    full_name: str
    photo_url: str | None
    position: str | None
    department: str | None
    phone: str | None
    email: str | None
    social_links: list[dict[str, Any]]
    slug: str
    status: Literal["active", "inactive"]
    profile_published: bool
    profile_id: uuid.UUID | None = None
    public_url: str | None = None
    cards: list[CardSummary]
    total_taps: int
    last_tap_at: UTCDateTime | None
    created_at: UTCDateTime
    digital_card: dict[str, Any] | None = None  # Part 4 §6
    employee_number: str | None = None  # Part 5 §4


class EmployeeIn(Schema):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(default="", max_length=80)
    position: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=320)
    social_links: list[SocialLink] = Field(default_factory=list, max_length=20)
    profile_published: bool | None = None
    employee_number: str | None = Field(default=None, max_length=32, pattern=EMPLOYEE_NUMBER_PATTERN)


class EmployeeUpdateIn(Schema):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, max_length=80)
    position: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=320)
    social_links: list[SocialLink] | None = Field(default=None, max_length=20)
    profile_published: bool | None = None
    employee_number: str | None = Field(default=None, max_length=32, pattern=EMPLOYEE_NUMBER_PATTERN)


class CustomerOut(Schema):
    id: uuid.UUID
    business_id: uuid.UUID
    full_name: str
    email: str | None
    phone: str | None
    company: str | None
    notes: str | None
    tags: list[str]
    status: Literal["active", "inactive"]
    cards: list[CardSummary]
    total_taps: int
    last_tap_at: UTCDateTime | None
    created_at: UTCDateTime


class CustomerIn(Schema):
    full_name: str = Field(min_length=1, max_length=160)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    company: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=5000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    status: Literal["active", "inactive"] = "active"


class CustomerUpdateIn(Schema):
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    company: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=5000)
    tags: list[str] | None = Field(default=None, max_length=30)
    status: Literal["active", "inactive"] | None = None


# ── Cards ───────────────────────────────────────────────────────────────
class ActionIn(Schema):
    type: str
    config: dict[str, Any] = Field(default_factory=dict)
    label: str | None = None


class CardOut(Schema):
    id: uuid.UUID
    business_id: uuid.UUID
    kind: Literal["card", "tag"]
    name: str
    uid: str | None
    uid_masked: str | None
    public_code: str
    tap_url: str
    status: Literal["active", "inactive"]
    effective_status: str
    assignee: dict[str, Any] | None
    profile_id: uuid.UUID | None
    action: dict[str, Any] | None
    programmed: bool
    programmed_at: UTCDateTime | None
    total_taps: int
    unique_visitors: int
    last_tap_at: UTCDateTime | None
    created_at: UTCDateTime


class CardIn(Schema):
    kind: Literal["card", "tag"] = "card"
    name: str = Field(min_length=1, max_length=120)
    uid: str | None = Field(default=None, max_length=200)
    status: Literal["active", "inactive"] = "active"
    assignee_type: Literal["employee", "customer"] | None = None
    assignee_id: uuid.UUID | None = None
    profile_id: uuid.UUID | None = None
    action: dict[str, Any] | None = None


class CardUpdateIn(Schema):
    kind: Literal["card", "tag"] | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    uid: str | None = Field(default=None, max_length=200)
    profile_id: uuid.UUID | None = None
    action: dict[str, Any] | None = None


class AssignIn(Schema):
    assignee_type: Literal["employee", "customer"]
    assignee_id: uuid.UUID




class ActionPreviewIn(Schema):
    action: dict[str, Any]
    card_id: uuid.UUID | None = None


class ActionPreviewOut(Schema):
    resolved_url: str | None
    kind: Literal["redirect", "page", "vcard", "webhook"]


class CardTapOut(Schema):
    id: uuid.UUID
    business_id: uuid.UUID
    card_id: uuid.UUID | None
    card_name: str | None
    card_kind: str | None
    assignee: dict[str, Any] | None
    source: Literal["web", "reader"]
    action_type: str | None
    result: str
    device_id: uuid.UUID | None
    device_name: str | None
    nfc_event_id: uuid.UUID | None
    visitor_hash: str | None
    device_type: str | None
    browser: str | None
    country: str | None
    is_bot: bool
    created_at: UTCDateTime


# ── Profiles ────────────────────────────────────────────────────────────
class ProfileOut(Schema):
    id: uuid.UUID
    business_id: uuid.UUID
    type: Literal["business", "employee", "custom", "menu", "product"]
    slug: str
    title: str
    employee_id: uuid.UUID | None
    published: bool
    theme: dict[str, Any]
    sections: list[dict[str, Any]]
    public_url: str
    updated_at: UTCDateTime


class ProfileIn(Schema):
    type: Literal["custom", "menu", "product"] = "custom"
    title: str = Field(min_length=1, max_length=160)
    slug: str | None = Field(default=None, min_length=1, max_length=64)
    published: bool = False
    theme: dict[str, Any] = Field(default_factory=dict)
    sections: list[dict[str, Any]] = Field(default_factory=list, max_length=50)


class ProfileUpdateIn(Schema):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    slug: str | None = Field(default=None, min_length=1, max_length=64)
    published: bool | None = None
    theme: dict[str, Any] | None = None
    sections: list[dict[str, Any]] | None = Field(default=None, max_length=50)


# ── Team ────────────────────────────────────────────────────────────────
class MemberOut(Schema):
    id: uuid.UUID
    business_id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    email: str
    role: Role
    extra_permissions: list[str]
    permissions: list[str]
    status: Literal["active", "suspended"]
    joined_at: UTCDateTime
    last_active_at: UTCDateTime | None


class MemberUpdateIn(Schema):
    role: Role | None = None
    extra_permissions: list[str] | None = None
    status: Literal["active", "suspended"] | None = None


class InvitationOut(Schema):
    id: uuid.UUID
    email: str
    role: Role
    status: Literal["pending", "accepted", "revoked", "expired"]
    invited_by: uuid.UUID | None
    expires_at: UTCDateTime
    created_at: UTCDateTime
    dev_invite_url: str | None = None


class InvitationIn(Schema):
    email: str = Field(min_length=3, max_length=320)
    role: Role = "staff"


class PublicInvitationOut(Schema):
    business_name: str
    role: Role
    email: str
    expires_at: UTCDateTime
    status: Literal["pending", "accepted", "revoked", "expired"]


# ── Sandbox ─────────────────────────────────────────────────────────────
class SandboxEndpointOut(Schema):
    id: uuid.UUID
    name: str
    url: str
    token: str
    application_id: uuid.UUID | None
    business_id: uuid.UUID | None = None
    response_status: int
    response_delay_ms: int
    response_body: str
    response_headers: dict[str, str]
    request_count: int
    last_request_at: UTCDateTime | None
    created_at: UTCDateTime


class SandboxEndpointIn(Schema):
    name: str = Field(default="Sandbox", min_length=1, max_length=100)
    application_id: uuid.UUID | None = None
    response_status: int = Field(default=200, ge=100, le=599)
    response_delay_ms: int = Field(default=0, ge=0, le=15000)
    response_body: str = Field(default='{"ok":true}', max_length=4096)
    response_headers: dict[str, str] = Field(default_factory=dict)


class SandboxEndpointUpdateIn(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    application_id: uuid.UUID | None = None
    response_status: int | None = Field(default=None, ge=100, le=599)
    response_delay_ms: int | None = Field(default=None, ge=0, le=15000)
    response_body: str | None = Field(default=None, max_length=4096)
    response_headers: dict[str, str] | None = None


class SandboxRequestOut(Schema):
    id: uuid.UUID
    endpoint_id: uuid.UUID
    received_at: UTCDateTime
    method: str
    path: str
    query: str | None
    headers: dict[str, str]
    body: str | None
    body_json: Any = None
    size_bytes: int
    source_ip_hash: str | None
    signature: dict[str, Any]
    checks: list[dict[str, Any]]
    response_status: int
    response_delay_ms: int
    event_id: str | None
    device_id: str | None


# ── Request logs ────────────────────────────────────────────────────────
class RequestLogOut(Schema):
    id: uuid.UUID
    created_at: UTCDateTime
    request_id: str
    method: str
    route: str
    path: str
    status_code: int
    outcome: Literal["success", "client_error", "server_error"]
    latency_ms: int
    error_code: str | None
    error_ref: str | None
    actor_type: str
    actor_id: uuid.UUID | None
    user_id: uuid.UUID | None
    business_id: uuid.UUID | None
    application_id: uuid.UUID | None
    device_id: uuid.UUID | None
    ip_hash: str | None
    user_agent: str | None
    country: str | None


class BusinessDeviceOut(DeviceOut):
    assigned_employee: dict[str, Any] | None
    last_scan_at: UTCDateTime | None
    online: bool
    business_id: uuid.UUID | None = None


class BusinessDeviceUpdateIn(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    assigned_employee_id: uuid.UUID | None = None
