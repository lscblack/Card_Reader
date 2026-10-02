"""Page visits on the public site, the Support page, business pages (/b/…) and personal cards (/p/…)."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAt, UUIDPk

VISIT_KINDS = ("site", "support", "business", "personal")


class PageVisit(UUIDPk, CreatedAt, Base):
    __tablename__ = "page_visits"
    __table_args__ = (
        CheckConstraint("kind IN ('site','support','business','personal')", name="kind"),
        Index("ix_page_visits_kind_created", "kind", "created_at"),
        Index("ix_page_visits_business_created", "business_id", "created_at"),
    )

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"))
    profile_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="SET NULL"))
    digital_card_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("digital_cards.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    # Daily-rotating salted hash of IP + user agent (no IPs are stored).
    visitor_hash: Mapped[str | None] = mapped_column(String(32))
    referrer_host: Mapped[str | None] = mapped_column(String(200))
    device_type: Mapped[str | None] = mapped_column(String(16))
