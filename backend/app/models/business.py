"""Business domain (Part 2 §B): workspaces, team, employees, customers, cards/tags, profiles, taps."""

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
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAt, Timestamps, UUIDPk
from app.models.user import Plan


class BusinessCategory(Base):
    __tablename__ = "business_categories"

    code: Mapped[str] = mapped_column(String(48), primary_key=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Business(UUIDPk, Timestamps, Base):
    __tablename__ = "businesses"
    __table_args__ = (CheckConstraint("status IN ('active','suspended')", name="status"),)

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    country: Mapped[str | None] = mapped_column(String(2))
    category: Mapped[str | None] = mapped_column(String(48))
    description: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(String(2048))
    address: Mapped[str | None] = mapped_column(String(500))
    logo_path: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("plans.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    plan: Mapped[Plan | None] = relationship(lazy="joined")

    @property
    def verified(self) -> bool:
        return self.verified_at is not None


class BusinessSlugRedirect(CreatedAt, Base):
    """Old slugs keep resolving for 90 days after a rename."""

    __tablename__ = "business_slug_redirects"

    slug: Mapped[str] = mapped_column(String(48), primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BusinessMember(UUIDPk, Base):
    __tablename__ = "business_members"
    __table_args__ = (
        UniqueConstraint("business_id", "user_id", name="uq_business_members_business_user"),
        CheckConstraint("role IN ('owner','admin','manager','staff')", name="role"),
        CheckConstraint("status IN ('active','suspended')", name="status"),
        Index("ix_business_members_user", "user_id"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    extra_permissions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    business: Mapped[Business] = relationship(lazy="joined", innerjoin=True)


class BusinessInvitation(UUIDPk, CreatedAt, Base):
    __tablename__ = "business_invitations"
    __table_args__ = (
        CheckConstraint("role IN ('owner','admin','manager','staff')", name="role"),
        Index("ix_business_invitations_business", "business_id", "created_at"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))

    business: Mapped[Business] = relationship(lazy="joined", innerjoin=True)

    def status_at(self, now: datetime) -> str:
        if self.accepted_at is not None:
            return "accepted"
        if self.revoked_at is not None:
            return "revoked"
        if self.expires_at <= now:
            return "expired"
        return "pending"


class Employee(UUIDPk, Timestamps, Base):
    __tablename__ = "employees"
    __table_args__ = (
        CheckConstraint("status IN ('active','inactive')", name="status"),
        Index("ix_employees_business", "business_id", "status"),
        Index("uq_employees_business_slug", "business_id", "slug", unique=True),
        Index("uq_employees_business_number", "business_id", "employee_number", unique=True,
              postgresql_where=text("employee_number IS NOT NULL")),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    photo_path: Mapped[str | None] = mapped_column(String(300))
    position: Mapped[str | None] = mapped_column(String(120))
    department: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(320))
    social_links: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    employee_number: Mapped[str | None] = mapped_column(String(32))  # Part 5 §4 (badge id / barcode default)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    total_taps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_tap_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class Customer(UUIDPk, Timestamps, Base):
    __tablename__ = "customers"
    __table_args__ = (
        CheckConstraint("status IN ('active','inactive')", name="status"),
        Index("ix_customers_business", "business_id", "status"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    company: Mapped[str | None] = mapped_column(String(160))
    notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    total_taps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_tap_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Profile(UUIDPk, Timestamps, Base):
    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint("type IN ('business','employee','custom','menu','product')", name="type"),
        Index("uq_profiles_business_slug", "business_id", "slug", unique=True,
              postgresql_where=text("deleted_at IS NULL")),
        Index("ix_profiles_employee", "employee_id"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    employee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("employees.id", ondelete="CASCADE"))
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    theme: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    sections: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Card(UUIDPk, Timestamps, Base):
    __tablename__ = "cards"
    __table_args__ = (
        CheckConstraint("kind IN ('card','tag')", name="kind"),
        CheckConstraint("status IN ('active','inactive')", name="status"),
        CheckConstraint("(employee_id IS NOT NULL)::int + (customer_id IS NOT NULL)::int "
                        "+ assigned_to_business::int <= 1", name="single_assignee"),
        Index("uq_cards_business_uid", "business_id", "uid", unique=True,
              postgresql_where=text("uid IS NOT NULL AND deleted_at IS NULL")),
        Index("ix_cards_business", "business_id", "created_at"),
        Index("ix_cards_employee", "employee_id"),
        Index("ix_cards_customer", "customer_id"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="card")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    uid: Mapped[str | None] = mapped_column(String(64))
    public_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    employee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("employees.id", ondelete="SET NULL"))
    customer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("customers.id", ondelete="SET NULL"))
    # Assigned to the company itself (not a person); exclusive with employee_id / customer_id.
    assigned_to_business: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False,
                                                       server_default=text("false"))
    profile_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="SET NULL"))
    action: Mapped[dict | None] = mapped_column(JSONB)
    programmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_taps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unique_visitors: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_tap_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    employee: Mapped[Employee | None] = relationship(lazy="joined")
    customer: Mapped[Customer | None] = relationship(lazy="joined")


class CardHistory(UUIDPk, CreatedAt, Base):
    __tablename__ = "card_history"
    __table_args__ = (Index("ix_card_history_card", "card_id", "created_at"),)

    card_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False)
    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    actor_device_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("devices.id", ondelete="SET NULL"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class CardTap(UUIDPk, CreatedAt, Base):
    __tablename__ = "card_taps"
    __table_args__ = (
        CheckConstraint("source IN ('web','reader')", name="source"),
        Index("ix_card_taps_business_created", "business_id", "created_at"),
        Index("ix_card_taps_card_created", "card_id", "created_at"),
        Index("ix_card_taps_card_visitor", "card_id", "visitor_hash"),
        Index("ix_card_taps_nfc_event", "nfc_event_id"),
        Index("ix_card_taps_device_created", "device_id", "created_at"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    card_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("cards.id", ondelete="SET NULL"))
    card_name: Mapped[str | None] = mapped_column(String(120))
    card_kind: Mapped[str | None] = mapped_column(String(8))
    assignee_type: Mapped[str | None] = mapped_column(String(16))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    assignee_name: Mapped[str | None] = mapped_column(String(160))
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    action_type: Mapped[str | None] = mapped_column(String(32))
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    device_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("devices.id", ondelete="SET NULL"))
    device_name: Mapped[str | None] = mapped_column(String(100))
    nfc_event_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    scanned_uid: Mapped[str | None] = mapped_column(String(64))
    visitor_hash: Mapped[str | None] = mapped_column(String(32))
    device_type: Mapped[str | None] = mapped_column(String(16))
    browser: Mapped[str | None] = mapped_column(String(32))
    country: Mapped[str | None] = mapped_column(String(2))
    is_bot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
