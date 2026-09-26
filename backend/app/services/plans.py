"""Plans, subscriptions and plan-limit enforcement."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import plan_limit
from app.models import Application, Device, Plan, Subscription, User
from app.services import usage

PLAN_SEED: list[dict] = [
    {
        "code": "free",
        "name": "Free",
        "price_monthly_cents": 0,
        "currency": "USD",
        "events_per_month": 10_000,
        "max_applications": 3,
        "max_devices": 5,
        "features": ["Relay & direct delivery", "HMAC-signed webhooks", "7-day event log", "Community support"],
        "sort_order": 0,
    },
    {
        "code": "pro",
        "name": "Pro",
        "price_monthly_cents": 2900,
        "currency": "USD",
        "events_per_month": 250_000,
        "max_applications": 20,
        "max_devices": 100,
        "features": ["Everything in Free", "Custom endpoint headers", "90-day event log", "Email support"],
        "sort_order": 1,
    },
    {
        "code": "business",
        "name": "Business",
        "price_monthly_cents": 19900,
        "currency": "USD",
        "events_per_month": 5_000_000,
        "max_applications": None,
        "max_devices": None,
        "features": ["Everything in Pro", "Unlimited applications & devices", "1-year event log", "Priority support"],
        "sort_order": 2,
    },
    # ── Business plans (Part 2 §B8): events_per_month = taps per month ──
    {
        "code": "biz_starter",
        "name": "Business Starter",
        "price_monthly_cents": 0,
        "currency": "USD",
        "events_per_month": 10_000,
        "max_applications": None,
        "max_devices": 3,
        "max_cards": 50,
        "max_members": 5,
        "audience": "business",
        "features": ["50 cards & tags", "3 nexTap devices", "5 team members", "Public profiles & menus",
                     "Tap analytics"],
        "sort_order": 10,
    },
    {
        "code": "biz_growth",
        "name": "Business Growth",
        "price_monthly_cents": 4900,
        "currency": "USD",
        "events_per_month": 250_000,
        "max_applications": None,
        "max_devices": 25,
        "max_cards": 1000,
        "max_members": 25,
        "audience": "business",
        "features": ["1,000 cards & tags", "25 devices", "25 team members", "Developer webhooks & API",
                     "Priority support"],
        "sort_order": 11,
    },
    {
        "code": "biz_enterprise",
        "name": "Business Enterprise",
        "price_monthly_cents": 19900,
        "currency": "USD",
        "events_per_month": None,
        "max_applications": None,
        "max_devices": None,
        "max_cards": None,
        "max_members": None,
        "audience": "business",
        "features": ["Unlimited cards, devices and members", "Unlimited taps", "Dedicated support", "SLA"],
        "sort_order": 12,
    },
]
_PRESENTATION = {  # Part 3: badge / featured / yearly price / description (admin-editable afterwards)
    "free": (False, None, None, "Everything you need to prototype an NFC integration."),
    "pro": (True, "Most popular", 29000, "For production apps with more devices and events."),
    "business": (False, None, 199000, "High-volume integrations with unlimited apps and devices."),
    "biz_starter": (False, None, None, "Get your business started with NFC cards and tags."),
    "biz_growth": (True, "Best value", 49000, "For growing teams with many cards and devices."),
    "biz_enterprise": (False, None, 199000, "Unlimited scale with dedicated support."),
    "personal_free": (False, None, None, "Your digital business card: share by NFC, QR or link."),
    "personal_pro": (True, "Pro", 4900, "More cards, unlimited contacts and lead export."),
}
PLAN_SEED += [
    {"code": "personal_free", "name": "Personal Free", "price_monthly_cents": 0, "currency": "USD",
     "events_per_month": None, "max_applications": None, "max_devices": None, "max_cards": 3, "max_members": None,
     "max_contacts": 1000, "audience": "personal", "sort_order": 20,
     "features": ["3 digital cards", "NFC, QR and link sharing", "1,000 contacts", "Lead capture"]},
    {"code": "personal_pro", "name": "Personal Pro", "price_monthly_cents": 499, "currency": "USD",
     "events_per_month": None, "max_applications": None, "max_devices": None, "max_cards": 20, "max_members": None,
     "max_contacts": None, "audience": "personal", "sort_order": 21,
     "features": ["20 digital cards", "Unlimited contacts", "Lead capture export", "Premium templates"]},
]
for _plan in PLAN_SEED:
    _plan.setdefault("max_contacts", None)
    _plan.setdefault("audience", "developer")
    _plan.setdefault("max_cards", None)
    _plan.setdefault("max_members", None)
    _featured, _badge, _yearly, _desc = _PRESENTATION[_plan["code"]]
    _plan.update(is_featured=_featured, badge=_badge, price_yearly_cents=_yearly, description=_desc, is_active=True)

DEFAULT_PLAN_CODES = ("free", "biz_starter")  # used at registration; never deletable

BUSINESS_CATEGORIES: list[tuple[str, str]] = [
    ("restaurant", "Restaurant"), ("cafe", "Café & bakery"), ("bar", "Bar & nightlife"), ("hotel", "Hotel & lodging"),
    ("retail", "Retail & shop"), ("supermarket", "Supermarket & grocery"), ("fashion", "Fashion & apparel"),
    ("beauty", "Beauty & salon"), ("fitness", "Gym & fitness"), ("healthcare", "Healthcare & clinic"),
    ("pharmacy", "Pharmacy"), ("education", "Education & training"), ("real_estate", "Real estate"),
    ("professional_services", "Professional services"), ("technology", "Technology & software"),
    ("finance", "Banking & finance"), ("insurance", "Insurance"), ("automotive", "Automotive"),
    ("transport", "Transport & logistics"), ("travel", "Travel & tourism"), ("events", "Events & venues"),
    ("entertainment", "Entertainment & media"), ("nonprofit", "Non-profit & NGO"), ("government", "Government"),
    ("manufacturing", "Manufacturing"), ("agriculture", "Agriculture"), ("construction", "Construction"),
    ("other", "Other"),
]


async def get_plan(session: AsyncSession, code: str) -> Plan | None:
    return (await session.execute(select(Plan).where(Plan.code == code))).scalar_one_or_none()


async def list_plans(session: AsyncSession, audience: str | None = None) -> list[Plan]:
    stmt = select(Plan).where(Plan.is_active).order_by(Plan.sort_order)
    if audience:
        stmt = stmt.where(Plan.audience == audience)
    return list((await session.execute(stmt)).scalars())



async def create_free_subscription(session: AsyncSession, user: User) -> Subscription:
    plan = await get_plan(session, "free")
    if plan is None:  # pragma: no cover - seeded on startup
        raise RuntimeError("free plan missing; seeding did not run")
    start, end = usage.month_bounds()
    sub = Subscription(
        user_id=user.id, plan_id=plan.id, status="active",
        current_period_start=start, current_period_end=end,
    )
    sub.plan = plan
    session.add(sub)
    user.subscription = sub
    return sub


async def create_subscription(session: AsyncSession, user: User, plan_code: str) -> Subscription:
    plan = await get_plan(session, plan_code)
    if plan is None:  # pragma: no cover - seeded on startup
        raise RuntimeError(f"{plan_code} plan missing; seeding did not run")
    start, end = usage.month_bounds()
    sub = Subscription(user_id=user.id, plan_id=plan.id, status="active",
                       current_period_start=start, current_period_end=end)
    sub.plan = plan
    session.add(sub)
    user.subscription = sub
    return sub


async def get_subscription(session: AsyncSession, user: User) -> Subscription:
    sub = (
        await session.execute(select(Subscription).where(Subscription.user_id == user.id))
    ).scalar_one_or_none()
    if sub is None:
        sub = await create_free_subscription(session, user)
        await session.commit()
    now = datetime.now(UTC)
    if sub.current_period_end <= now:
        # Roll the (monthly) period forward; no payment provider yet.
        sub.current_period_start, sub.current_period_end = usage.month_bounds(now)
        await session.commit()
    return sub


async def get_user_plan(session: AsyncSession, user_id: uuid.UUID) -> Plan:
    plan = (
        await session.execute(
            select(Plan).join(Subscription, Subscription.plan_id == Plan.id).where(
                Subscription.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    # Developer limits (applications/devices/events) come from a developer plan. Personal plans leave these limits
    # unset (= unlimited), so a personal subscription must not lift them: fall back to the free developer plan.
    if plan is None or plan.audience != "developer":
        plan = await get_plan(session, "free")
        assert plan is not None
    return plan


async def count_applications(session: AsyncSession, owner_id: uuid.UUID) -> int:
    return int(
        (
            await session.execute(
                select(func.count()).select_from(Application).where(
                    Application.owner_id == owner_id, Application.deleted_at.is_(None),
                    Application.business_id.is_(None),
                )
            )
        ).scalar_one()
    )


async def count_active_devices(session: AsyncSession, owner_id: uuid.UUID) -> int:
    return int(
        (
            await session.execute(
                select(func.count()).select_from(Device).where(
                    Device.owner_id == owner_id,
                    Device.status == "active",
                    Device.deleted_at.is_(None),
                    Device.application_id.in_(
                        select(Application.id).where(Application.owner_id == owner_id,
                                                     Application.business_id.is_(None))
                    ),
                )
            )
        ).scalar_one()
    )


async def ensure_can_create_application(session: AsyncSession, owner_id: uuid.UUID) -> None:
    plan = await get_user_plan(session, owner_id)
    if plan.max_applications is not None and await count_applications(session, owner_id) >= plan.max_applications:
        raise plan_limit(
            f"Your {plan.name} plan allows {plan.max_applications} applications. Upgrade to add more."
        )


async def ensure_can_add_device(session: AsyncSession, owner_id: uuid.UUID) -> None:
    plan = await get_user_plan(session, owner_id)
    if plan.max_devices is not None and await count_active_devices(session, owner_id) >= plan.max_devices:
        raise plan_limit(
            f"Your {plan.name} plan allows {plan.max_devices} active devices. Revoke a device or upgrade."
        )


async def ensure_can_record_event(session: AsyncSession, owner_id: uuid.UUID) -> None:
    plan = await get_user_plan(session, owner_id)
    if plan.events_per_month is None:
        return
    if await usage.events_this_month(session, owner_id) >= plan.events_per_month:
        raise plan_limit(
            f"Your {plan.name} plan allows {plan.events_per_month} events per month. Upgrade to continue."
        )
