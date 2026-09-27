"""Promotions (Part 3 §2): status maths, applicability, discounts and best-promotion selection."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Plan, Promotion


def applies_to(promo: Promotion, plan: Plan) -> bool:
    if promo.audience not in ("all", plan.audience):
        return False
    if promo.plan_codes and plan.code not in promo.plan_codes:
        return False
    if promo.discount_type == "amount" and (promo.currency or "").upper() != (plan.currency or "").upper():
        return False
    return True


def discounted_price(promo: Promotion, price_cents: int) -> int:
    if promo.discount_type == "free":  # free period (claimed in-app, see free_periods)
        return 0
    if promo.discount_type == "percent":
        return max(0, round(price_cents * (100 - promo.discount_value) / 100))
    return max(0, price_cents - promo.discount_value)


def best_for(plan: Plan, promos: list[Promotion], now: datetime) -> Promotion | None:
    """The applicable active promotion giving the lowest monthly price (ties: ends soonest)."""
    if plan.price_monthly_cents <= 0:
        return None
    candidates = [p for p in promos if p.discount_type != "free" and p.status_at(now) == "active" and applies_to(p, plan)
                  and discounted_price(p, plan.price_monthly_cents) < plan.price_monthly_cents]
    if not candidates:
        return None
    far = datetime.max.replace(tzinfo=UTC)
    return min(candidates, key=lambda p: (discounted_price(p, plan.price_monthly_cents), p.ends_at or far))


async def live_promotions(session: AsyncSession, now: datetime | None = None) -> list[Promotion]:
    """Promotions that are active right now (single query + exhaustion check)."""
    now = now or datetime.now(UTC)
    rows = (await session.execute(select(Promotion).where(
        Promotion.is_active.is_(True),
        or_(Promotion.starts_at.is_(None), Promotion.starts_at <= now),
        or_(Promotion.ends_at.is_(None), Promotion.ends_at > now),
    ))).scalars().all()
    return [p for p in rows if p.status_at(now) == "active"]


def applied_out(promo: Promotion, plan: Plan) -> dict[str, Any]:
    return {
        "id": str(promo.id), "name": promo.name, "banner_text": promo.banner_text,
        "discount_type": promo.discount_type, "discount_value": promo.discount_value,
        "discounted_price_monthly_cents": discounted_price(promo, plan.price_monthly_cents),
        "ends_at": _iso(promo.ends_at), "code": promo.code,
    }


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def promotion_out(p: Promotion, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    return {
        "id": str(p.id), "name": p.name, "code": p.code, "description": p.description,
        "discount_type": p.discount_type, "discount_value": p.discount_value, "currency": p.currency,
        "audience": p.audience, "plan_codes": list(p.plan_codes or []), "starts_at": _iso(p.starts_at),
        "ends_at": _iso(p.ends_at), "is_active": p.is_active, "show_on_landing": p.show_on_landing,
        "banner_text": p.banner_text, "max_redemptions": p.max_redemptions, "redemptions": p.redemptions,
        "status": p.status_at(now), "created_at": _iso(p.created_at), "updated_at": _iso(p.updated_at),
    }
