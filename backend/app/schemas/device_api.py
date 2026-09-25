"""Schemas for the mobile terminal (`/device/*`)."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import Field, field_validator

from app.schemas.common import Schema, UTCDateTime
from app.schemas.resources import DeliveryMode, DeviceOut

CARD_ID_RE = re.compile(r"^[0-9A-F]{4,64}$")
_TECH_PREFIX = "android.nfc.tech."


def normalize_card_id(value: str) -> str:
    return value.replace(":", "").replace(" ", "").strip().upper()


class DeviceRegisterIn(Schema):
    device_name: str = Field(min_length=1, max_length=100)
    platform: str = Field(default="android", min_length=1, max_length=32)
    model: str | None = Field(default=None, max_length=100)
    os_version: str | None = Field(default=None, max_length=64)
    app_version: str | None = Field(default=None, max_length=32)
    installation_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")

    @field_validator("device_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("device_name must not be blank")
        return v

    @field_validator("platform")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class DeviceConfigApplication(Schema):
    id: uuid.UUID
    name: str


class DeviceConfigOut(Schema):
    device_id: uuid.UUID
    device_name: str
    application: DeviceConfigApplication
    delivery_mode: DeliveryMode
    endpoint_url: str | None
    endpoint_enabled: bool
    timeout_seconds: int
    max_retries: int
    custom_headers: dict[str, str]
    signing_secret: str | None
    allowed_domains: list[str]
    account_type: Literal["developer", "business"] = "developer"
    business: dict[str, Any] | None = None
    assigned_employee: dict[str, Any] | None = None
    capabilities: list[str] = []


class DeviceRegisterOut(Schema):
    device: DeviceOut
    device_token: str
    config: DeviceConfigOut


class HeartbeatOut(Schema):
    status: Literal["active"] = "active"
    server_time: UTCDateTime


class DirectDeliveryIn(Schema):
    success: bool
    status_code: int | None = Field(default=None, ge=100, le=599)
    latency_ms: int | None = Field(default=None, ge=0, le=600_000)
    error: str | None = Field(default=None, max_length=1000)
    attempt: int = Field(default=1, ge=1, le=100)


class DeviceEventIn(Schema):
    event_id: uuid.UUID
    card_id: str = Field(min_length=1, max_length=200)
    card_technologies: list[str] = Field(default_factory=list, max_length=16)
    card_type: str | None = Field(default=None, max_length=64)
    detected_at: datetime
    direct_delivery: DirectDeliveryIn | None = None
    # Part 4 §5: phone-as-card token read over HCE (base64url, 55 chars)
    digital_card_token: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("card_id")
    @classmethod
    def _card_id(cls, v: str) -> str:
        v = normalize_card_id(v)
        if not CARD_ID_RE.match(v):
            raise ValueError("card_id must be 4-64 hex characters (separators ':' and ' ' allowed)")
        return v

    @field_validator("card_technologies")
    @classmethod
    def _techs(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for t in v:
            t = t.strip().removeprefix(_TECH_PREFIX)
            if not t or len(t) > 64:
                raise ValueError("invalid card technology")
            if t not in out:
                out.append(t)
        return out

    @field_validator("card_type")
    @classmethod
    def _card_type(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        return v or None

    @field_validator("detected_at")
    @classmethod
    def _detected_at(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        now = datetime.now(UTC)
        if v < now - timedelta(days=7):
            raise ValueError("detected_at is older than 7 days")
        if v > now + timedelta(minutes=5):
            raise ValueError("detected_at is more than 5 minutes in the future")
        return v.astimezone(UTC)


class DeviceEventOut(Schema):
    event_id: uuid.UUID
    status: Literal["pending", "delivered", "retrying", "failed", "logged"]
    status_code: int | None
    latency_ms: int | None
    error: str | None
    error_code: str | None = None
    error_ref: str | None = None
    business: dict[str, Any] | None = Field(
        default=None, description="Business devices only (§C2); absent for developer devices.")
