"""Business workspace helpers: slugs, public codes, workspace creation, plan limits, card status."""

from __future__ import annotations

import re
import secrets
import string
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.core.security import generate_webhook_secret
from app.models import (
    Application,
    Business,
    BusinessCategory,
    BusinessMember,
    BusinessSlugRedirect,
    Card,
    CardTap,
    Device,
    Employee,
    Plan,
    Profile,
    User,
)
from app.services.applications import set_webhook_secret
from app.services.usage import month_bounds

SLUG_RE = re.compile(r"^[a-z0-9-]{3,48}$")
BASE62 = string.ascii_letters + string.digits
BUSINESS_TERMINAL_APP = "Business Terminal"
DEFAULT_SETTINGS: dict[str, Any] = {
    "devices_can_register_cards": True,
    "default_card_action": None,
    "timezone": "UTC",
}


def slugify(value: str, max_len: int = 48) -> str:
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    value = re.sub(r"-{2,}", "-", value)[:max_len].strip("-")
    return value


async def unique_business_slug(session: AsyncSession, name: str, exclude_id: uuid.UUID | None = None) -> str:
    base = slugify(name) or "business"
    if len(base) < 3:
        base = f"{base}-biz"
    base = base[:40].strip("-")
    candidate = base
    for _ in range(50):
        if not await slug_in_use(session, candidate, exclude_id):
            return candidate
        candidate = f"{base}-{secrets.token_hex(2)}"
    return f"{base}-{secrets.token_hex(4)}"


async def slug_in_use(session: AsyncSession, slug: str, exclude_id: uuid.UUID | None = None) -> bool:
    stmt = select(Business.id).where(Business.slug == slug)
    if exclude_id:
        stmt = stmt.where(Business.id != exclude_id)
    if (await session.execute(stmt)).first():
        return True
    redirect = await session.get(BusinessSlugRedirect, slug)
    return bool(
        redirect
        and redirect.expires_at > datetime.now(UTC)
        and (exclude_id is None or redirect.business_id != exclude_id)
    )


async def unique_child_slug(session: AsyncSession, model: type, business_id: uuid.UUID, name: str,
                            exclude_id: uuid.UUID | None = None) -> str:
    base = slugify(name, 56) or "item"
    candidate = base
    for i in range(2, 200):
        stmt = select(model.id).where(model.business_id == business_id, model.slug == candidate)
        if hasattr(model, "deleted_at"):
            stmt = stmt.where(model.deleted_at.is_(None))
        if exclude_id:
            stmt = stmt.where(model.id != exclude_id)
        if not (await session.execute(stmt)).first():
            return candidate
        candidate = f"{base}-{i}"
    return f"{base}-{secrets.token_hex(3)}"


def generate_public_code() -> str:
    return "".join(secrets.choice(BASE62) for _ in range(10))


def tap_url(public_code: str) -> str:
    return f"{settings.public_api_url}/t/{public_code}"


def media_url(path: str | None) -> str | None:
    if not path:
        return None
    return f"{settings.public_api_url}/media/{path}"


def business_public_url(business: Business, profile_slug: str | None = None) -> str:
    base = f"{settings.public_web_url}/b/{business.slug}"
    return f"{base}/{profile_slug}" if profile_slug else base


async def get_plan(session: AsyncSession, code: str) -> Plan | None:
    return (await session.execute(select(Plan).where(Plan.code == code))).scalar_one_or_none()


async def valid_category(session: AsyncSession, code: str | None) -> bool:
    if not code:
        return False
    return (await session.get(BusinessCategory, code)) is not None


async def create_workspace(session: AsyncSession, owner: User, data: dict[str, Any]) -> Business:
    """Business + owner membership + business profile + "Business Terminal" app + plan (biz_starter)."""
    plan = await get_plan(session, "biz_starter")
    business = Business(
        name=data["name"].strip(),
        slug=await unique_business_slug(session, data["name"]),
        email=(data.get("email") or owner.email).strip().lower(),
        phone=data.get("phone"),
        country=(data.get("country") or "").upper() or None,
        category=data.get("category"),
        description=data.get("description"),
        website=data.get("website"),
        address=data.get("address"),
        status="active",
        settings=dict(DEFAULT_SETTINGS),
        plan_id=plan.id if plan else None,
        created_by=owner.id,
        verified_at=datetime.now(UTC) if owner.email_verified else None,
    )
    session.add(business)
    await session.flush()
    session.add(BusinessMember(business_id=business.id, user_id=owner.id, role="owner", status="active",
                               extra_permissions=[], joined_at=datetime.now(UTC)))
    session.add(Profile(
        business_id=business.id, type="business", slug="profile", title=business.name, published=True,
        theme={"accent": "#b91c1c"},
        sections=default_business_sections(business),
    ))
    app = Application(
        owner_id=owner.id, business_id=business.id, name=BUSINESS_TERMINAL_APP,
        description="Default application for this business's nexTap devices.",
        is_active=True, delivery_mode="relay", endpoint_url=None, endpoint_enabled=False,
        endpoint_timeout_seconds=max(1, min(30, settings.WEBHOOK_TIMEOUT_SECONDS)),
        endpoint_custom_headers={}, allowed_domains=[],
    )
    set_webhook_secret(app, generate_webhook_secret())
    session.add(app)
    await session.flush()
    return business


def default_business_sections(business: Business) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    if business.description:
        sections.append({"type": "about", "text": business.description})
    sections.append({"type": "contact", "phone": business.phone, "email": business.email,
                     "website": business.website, "address": business.address})
    return sections


async def business_profile(session: AsyncSession, business_id: uuid.UUID) -> Profile | None:
    return (
        await session.execute(
            select(Profile).where(Profile.business_id == business_id, Profile.type == "business",
                                  Profile.deleted_at.is_(None)).limit(1)
        )
    ).scalar_one_or_none()


async def terminal_application(session: AsyncSession, business_id: uuid.UUID) -> Application | None:
    return (
        await session.execute(
            select(Application).where(Application.business_id == business_id, Application.deleted_at.is_(None))
            .order_by(Application.created_at).limit(1)
        )
    ).scalar_one_or_none()


# ── Plans & limits ────────────────────────────────────────────────────────
async def business_plan(session: AsyncSession, business: Business) -> Plan:
    if business.plan is not None:
        return business.plan
    plan = await get_plan(session, "biz_starter")
    assert plan is not None
    return plan


async def business_usage(session: AsyncSession, business_id: uuid.UUID) -> dict[str, int]:
    start, _ = month_bounds()
    cards = select(func.count()).select_from(Card).where(Card.business_id == business_id, Card.deleted_at.is_(None))
    devices = (
        select(func.count()).select_from(Device).join(Application, Application.id == Device.application_id)
        .where(Application.business_id == business_id, Device.status == "active", Device.deleted_at.is_(None))
    )
    members = select(func.count()).select_from(BusinessMember).where(
        BusinessMember.business_id == business_id, BusinessMember.status == "active"
    )
    taps = select(func.count()).select_from(CardTap).where(
        CardTap.business_id == business_id, CardTap.created_at >= start, CardTap.is_bot.is_(False)
    )
    row = (await session.execute(
        select(cards.scalar_subquery(), devices.scalar_subquery(), members.scalar_subquery(), taps.scalar_subquery())
    )).one()
    return {"cards": int(row[0]), "devices": int(row[1]), "members": int(row[2]), "taps_this_month": int(row[3])}


def plan_limits(plan: Plan) -> dict[str, int | None]:
    return {"cards": plan.max_cards, "devices": plan.max_devices, "members": plan.max_members,
            "taps_per_month": plan.events_per_month}


async def ensure_business_limit(session: AsyncSession, business: Business, resource: str, adding: int = 1) -> None:
    plan = await business_plan(session, business)
    limits = plan_limits(plan)
    key = {"cards": "cards", "devices": "devices", "members": "members", "taps": "taps_per_month"}[resource]
    maximum = limits[key]
    if maximum is None:
        return
    usage = await business_usage(session, business.id)
    current = usage["taps_this_month" if resource == "taps" else resource]
    if current + adding > maximum:
        raise AppError(
            402, "plan_limit_reached",
            f"Your {plan.name} plan allows {maximum} {resource.replace('_', ' ')}. Upgrade to add more.",
            {"limit": key, "max": maximum, "current": current},
        )


# ── Cards ─────────────────────────────────────────────────────────────────
def card_effective_status(card: Card, business: Business) -> str:
    if business.status != "active" or business.deleted_at is not None:
        return "business_suspended"
    if card.status != "active":
        return "inactive"
    if card.employee is not None and card.employee.status != "active":
        return "inactive_owner"
    if card.customer is not None and card.customer.status != "active":
        return "inactive_owner"
    if card.employee_id is None and card.customer_id is None:
        return "unassigned"
    return "active"


def mask_uid(uid: str | None) -> str | None:
    if not uid:
        return None
    if len(uid) <= 4:
        return uid
    return "•" * (len(uid) - 4) + uid[-4:]


def assignee_of(card: Card) -> dict[str, Any] | None:
    if card.employee is not None:
        e: Employee = card.employee
        return {"type": "employee", "id": e.id, "name": e.full_name, "photo_url": media_url(e.photo_path),
                "position": e.position}
    if card.customer is not None:
        c = card.customer
        return {"type": "customer", "id": c.id, "name": c.full_name, "photo_url": None, "position": None}
    return None
