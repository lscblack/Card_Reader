"""Online upgrades: one row per Stripe Checkout Session."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk


class CheckoutSession(UUIDPk, Timestamps, Base):
    __tablename__ = "checkout_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('open','complete','expired')", name="status"),
        CheckConstraint("billing_interval IN ('month','year')", name="billing_interval"),
    )

    stripe_session_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Set for business upgrades (plans live on the business).
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"))
    plan_code: Mapped[str] = mapped_column(String(32), nullable=False)
    billing_interval: Mapped[str] = mapped_column(String(8), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    promotion_code: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
