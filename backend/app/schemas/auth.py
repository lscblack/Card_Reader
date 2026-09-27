from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import AfterValidator, EmailStr, Field, field_validator

from app.core.countries import normalize_country
from app.schemas.common import Schema, UTCDateTime


def _norm_email(v: str) -> str:
    return v.strip().lower()


Email = Annotated[EmailStr, AfterValidator(_norm_email)]


class MembershipInfo(Schema):
    business_id: uuid.UUID
    business_name: str
    business_slug: str
    role: Literal["owner", "admin", "manager", "staff"]


class UserOut(Schema):
    id: uuid.UUID
    email: str
    full_name: str
    role: Literal["developer", "admin"]
    is_active: bool
    created_at: UTCDateTime
    plan: str = "free"
    account_type: Literal["developer", "business", "personal"] = "developer"
    email_verified: bool = False
    email_verified_at: UTCDateTime | None = None
    memberships: list[MembershipInfo] = []
    # Part 3 §4
    avatar_url: str | None = None
    phone: str | None = None
    company: str | None = None
    country: str | None = None
    job_title: str | None = None
    last_login_at: UTCDateTime | None = None
    login_count: int = 0
    preferences: dict = {}  # type: ignore[type-arg]


class RegisterIn(Schema):
    email: Email
    password: str = Field(min_length=10, max_length=128)
    full_name: str = Field(min_length=1, max_length=200)
    account_type: Literal["developer", "business", "personal"] = "developer"
    business: "BusinessRegistrationIn | None" = None
    phone: str | None = Field(default=None, max_length=40)
    card_invite: str | None = Field(default=None, min_length=10, max_length=256)
    card_invite_token: str | None = Field(default=None, min_length=10, max_length=256)  # alias used by the web app
    invite_token: str | None = Field(default=None, min_length=10, max_length=256)
    # Required for every account (a business sign-up may give it in `business.country` instead).
    country: str | None = Field(default=None, max_length=2)
    client_id: str | None = Field(default=None, min_length=8, max_length=64)

    @field_validator("country")
    @classmethod
    def _country(cls, v: str | None) -> str | None:
        return normalize_country(v)

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("full_name must not be blank")
        return v


class LoginIn(Schema):
    email: Email
    password: str = Field(min_length=1, max_length=128)
    # Random id the browser keeps: signing in again on the same browser needs no confirmation.
    client_id: str | None = Field(default=None, min_length=8, max_length=64)


class TokenOut(Schema):
    status: Literal["ok"] = "ok"
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut
    dev_verification_url: str | None = None


class ExistingSessionOut(Schema):
    id: str
    kind: Literal["web", "mobile"]
    device_name: str
    created_at: str | None = None
    last_seen_at: str | None = None
    via: str | None = None


class LoginOut(Schema):
    """`status: ok` → signed in (token fields set). `status: confirm` → show the challenge step: enter the emailed
    code (`otp_required`) and/or confirm signing out `existing_session`, then `POST /auth/login/confirm`."""

    status: Literal["ok", "confirm"]
    access_token: str | None = None
    token_type: Literal["bearer"] | None = None
    expires_in: int | None = None
    user: UserOut | None = None
    challenge_id: str | None = None
    otp_required: bool | None = None
    otp_sent_to: str | None = None
    existing_session: ExistingSessionOut | None = None
    expires_at: str | None = None
    dev_code: str | None = None


class LoginConfirmIn(Schema):
    challenge_id: uuid.UUID
    code: str | None = Field(default=None, max_length=12)


class ChallengeIdIn(Schema):
    challenge_id: uuid.UUID


class EmailCodeStartIn(Schema):
    email: Email
    client_id: str | None = Field(default=None, min_length=8, max_length=64)


class EmailCodeStartOut(Schema):
    challenge_id: str
    sent_to: str
    expires_at: str | None = None
    dev_code: str | None = None


class PasskeyVerifyIn(Schema):
    challenge_id: uuid.UUID
    credential: dict  # type: ignore[type-arg]  # PublicKeyCredential JSON from navigator.credentials
    client_id: str | None = Field(default=None, min_length=8, max_length=64)
    name: str | None = Field(default=None, max_length=80)


class UpdateMeIn(Schema):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    company: str | None = Field(default=None, max_length=160)
    country: str | None = Field(default=None, max_length=2)
    job_title: str | None = Field(default=None, max_length=120)

    @field_validator("country")
    @classmethod
    def _country(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("country is required and cannot be cleared")
        return normalize_country(v)


class ChangePasswordIn(Schema):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class ForgotPasswordIn(Schema):
    email: Email


class ResetPasswordIn(Schema):
    token: str = Field(min_length=10, max_length=256)
    new_password: str = Field(min_length=10, max_length=128)


class AdminUserUpdateIn(Schema):
    is_active: bool


class AdminStatsOut(Schema):
    users: int
    applications: int
    devices: int
    events_total: int


from app.schemas.business import BusinessRegistrationIn  # noqa: E402

RegisterIn.model_rebuild()
