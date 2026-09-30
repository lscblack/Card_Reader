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
    LargeBinary,
    String,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAt, Timestamps, UUIDPk



class User(UUIDPk, Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('developer','admin')", name="role"),
        CheckConstraint("account_type IN ('developer','business','personal')", name="account_type"),
    )

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="developer")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Tokens issued before this instant are rejected (password change / reset).
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    account_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="developer", server_default="developer"
    )
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Part 3 §4: profile
    avatar_path: Mapped[str | None] = mapped_column(String(300))
    phone: Mapped[str | None] = mapped_column(String(40))
    company: Mapped[str | None] = mapped_column(String(160))
    country: Mapped[str | None] = mapped_column(String(2))
    job_title: Mapped[str | None] = mapped_column(String(120))
    login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Part 3 §7: free-form UI preferences (≤ 8 KB), e.g. product tours
    preferences: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255))

    subscription: Mapped[Subscription | None] = relationship(
        back_populates="user", uselist=False, lazy="selectin"
    )

    # Active business memberships (Part 2 §A3).
    memberships: Mapped[list["BusinessMember"]] = relationship(  # noqa: F821
        "BusinessMember",
        primaryjoin="and_(User.id == foreign(BusinessMember.user_id), BusinessMember.status == 'active')",
        lazy="selectin",
        viewonly=True,
    )

    @property
    def plan_code(self) -> str:
        return self.subscription.plan.code if self.subscription else "free"


class Plan(UUIDPk, Timestamps, Base):
    __tablename__ = "plans"

    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    price_monthly_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    events_per_month: Mapped[int | None] = mapped_column(BigInteger)
    max_applications: Mapped[int | None] = mapped_column(Integer)
    max_devices: Mapped[int | None] = mapped_column(Integer)
    features: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    audience: Mapped[str] = mapped_column(String(16), nullable=False, default="developer", server_default="developer")
    # Part 3 §2
    price_yearly_cents: Mapped[int | None] = mapped_column(Integer)
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    badge: Mapped[str | None] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(String(500))
    max_cards: Mapped[int | None] = mapped_column(Integer)
    max_members: Mapped[int | None] = mapped_column(Integer)
    max_contacts: Mapped[int | None] = mapped_column(Integer)  # Part 4 (personal plans)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Subscription(UUIDPk, Timestamps, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint("status IN ('active','past_due','canceled')", name="status"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("plans.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # "stripe" (paid online) or "promotion" (free period); provider_subscription_id is the Stripe subscription id.
    provider: Mapped[str | None] = mapped_column(String(32))
    provider_subscription_id: Mapped[str | None] = mapped_column(String(255))

    user: Mapped[User] = relationship(back_populates="subscription")
    plan: Mapped[Plan] = relationship(lazy="joined", innerjoin=True)


class PasswordResetToken(UUIDPk, CreatedAt, Base):
    __tablename__ = "password_reset_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    requested_ip: Mapped[str | None] = mapped_column(String(64))


class EmailVerificationToken(UUIDPk, CreatedAt, Base):
    __tablename__ = "email_verification_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebSession(UUIDPk, CreatedAt, Base):
    """A signed-in browser. One live web session per user: signing in elsewhere revokes it (reason "replaced")."""

    __tablename__ = "web_sessions"
    __table_args__ = (Index("ix_web_sessions_user", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Browser")
    user_agent: Mapped[str | None] = mapped_column(String(400))
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    via: Mapped[str] = mapped_column(String(16), nullable=False, default="password")
    # Random id the browser keeps (localStorage): signing in again on the same browser needs no confirmation.
    client_id: Mapped[str | None] = mapped_column(String(64))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(16))  # replaced | logout | admin


class LoginChallenge(UUIDPk, CreatedAt, Base):
    """A pending sign-in step: an emailed code and/or the "this signs out your other device" confirmation."""

    __tablename__ = "login_challenges"
    __table_args__ = (
        CheckConstraint("kind IN ('web','mobile')", name="kind"),
        CheckConstraint("purpose IN ('login','email_code','passkey')", name="purpose"),
        Index("ix_login_challenges_user", "user_id", "created_at"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    code_hash: Mapped[str | None] = mapped_column(String(64))
    otp_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Passkey ceremonies: the WebAuthn challenge bytes (base64url) to verify against.
    webauthn_challenge: Mapped[str | None] = mapped_column(String(200))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    via: Mapped[str] = mapped_column(String(16), nullable=False, default="password")
    # Mobile sign-in: the device fields to create the session with once confirmed.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Passkey(UUIDPk, CreatedAt, Base):
    __tablename__ = "passkeys"
    __table_args__ = (Index("ix_passkeys_user", "user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    credential_id: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)  # base64url
    public_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sign_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    transports: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    name: Mapped[str] = mapped_column(String(80), nullable=False, default="Passkey")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
