"""Overview, usage, billing and audit logs."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from typing import Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from app.api.deps import ClientDep, CurrentUser, PaginationDep, SessionDep, PlatformUser
from app.models import ApiKey, Application, AuditLog, NfcEvent, Plan, Promotion, UsageDaily
from app.schemas.common import Schema
from pydantic import Field
from app.schemas.common import Page
from app.schemas.resources import (
    AuditLogOut,
    OverviewOut,
    PlanOut,
    SubscriptionOut,
    UsageDay,
    UsageLimits,
    UsageOut,
    UsageTotals,
)
from app.services import plans as plan_service
from app.services import audit, free_periods, promotions, usage
from app.services.request_logs import set_actor
from app.services.applications import developer_app_ids
from app.services.serializers import audit_out, event_out, plan_out

router = APIRouter(tags=["Account"])


@router.get("/overview", response_model=OverviewOut, tags=["Account"], summary="Dashboard overview")
async def overview(user: PlatformUser, session: SessionDep) -> OverviewOut:
    today = datetime.now(UTC).date()
    month_start, month_end = usage.month_bounds()
    events_today = (await usage.events_in_range(session, user.id, today, today + timedelta(days=1)))[0]
    month_events, delivered, failed = await usage.events_in_range(
        session, user.id, month_start.date(), month_end.date()
    )
    active_keys = (
        await session.execute(
            select(func.count()).select_from(ApiKey)
            .join(Application, Application.id == ApiKey.application_id)
            .where(ApiKey.owner_id == user.id, ApiKey.revoked_at.is_(None), Application.deleted_at.is_(None),
                   Application.business_id.is_(None))
        )
    ).scalar_one()
    recent = (
        await session.execute(
            select(NfcEvent).where(NfcEvent.owner_id == user.id,
                                   NfcEvent.application_id.in_(developer_app_ids(user.id)))
            .order_by(NfcEvent.received_at.desc()).limit(10)
        )
    ).scalars().unique()
    finished = delivered + failed
    return OverviewOut(
        applications=await plan_service.count_applications(session, user.id),
        active_devices=await plan_service.count_active_devices(session, user.id),
        active_api_keys=int(active_keys),
        events_today=events_today,
        events_this_month=month_events,
        delivery_success_rate=round(delivered / finished, 4) if finished else 0.0,
        recent_events=[event_out(e) for e in recent],
    )


@router.get("/usage", response_model=UsageOut, tags=["Usage & billing"], summary="Usage for the current period")
async def get_usage(
    user: PlatformUser, session: SessionDep, days: int = Query(default=30, ge=1, le=365)
) -> UsageOut:
    sub = await plan_service.get_subscription(session, user)
    plan = sub.plan
    events, delivered, failed = await usage.events_in_range(
        session, user.id, sub.current_period_start.date(), sub.current_period_end.date()
    )
    today = datetime.now(UTC).date()
    first = today - timedelta(days=days - 1)
    rows = (
        await session.execute(
            select(
                UsageDaily.day,
                func.sum(UsageDaily.events),
                func.sum(UsageDaily.delivered),
                func.sum(UsageDaily.failed),
            )
            .where(UsageDaily.owner_id == user.id, UsageDaily.day >= first, UsageDaily.day <= today,
                   UsageDaily.application_id.in_(developer_app_ids(user.id)))
            .group_by(UsageDaily.day)
        )
    ).all()
    by_day: dict[date, tuple[int, int, int]] = {r[0]: (int(r[1]), int(r[2]), int(r[3])) for r in rows}
    daily = []
    for i in range(days):
        d = first + timedelta(days=i)
        e, ok, ko = by_day.get(d, (0, 0, 0))
        daily.append(UsageDay(date=d, events=e, delivered=ok, failed=ko))
    return UsageOut(
        plan=plan_out(plan),
        period_start=sub.current_period_start,
        period_end=sub.current_period_end,
        totals=UsageTotals(
            events=events,
            delivered=delivered,
            failed=failed,
            applications=await plan_service.count_applications(session, user.id),
            devices=await plan_service.count_active_devices(session, user.id),
        ),
        limits=UsageLimits(
            events_per_month=plan.events_per_month,
            applications=plan.max_applications,
            devices=plan.max_devices,
        ),
        daily=daily,
    )


@router.get("/billing/plans", response_model=list[PlanOut], tags=["Usage & billing"],
            summary="Available plans (public)", description="Filter with `?audience=developer|business`.")
async def list_plans(session: SessionDep, request: Request,
                     audience: Literal["developer", "business", "personal"] | None = None) -> list[PlanOut]:
    set_actor(request, "public")
    now = datetime.now(UTC)
    promos = await promotions.live_promotions(session, now)
    out = []
    for p in await plan_service.list_plans(session, audience):
        item = plan_out(p)
        best = promotions.best_for(p, promos, now)
        item.promotion = promotions.applied_out(best, p) if best else None
        out.append(item)
    return out


@router.get("/billing/promotions/active", tags=["Usage & billing"], summary="Promotions for the landing page (public)",
            description="Active promotions with `show_on_landing = true`.")
async def active_promotions(session: SessionDep, request: Request) -> list[dict]:  # type: ignore[type-arg]
    set_actor(request, "public")
    now = datetime.now(UTC)
    return [promotions.promotion_out(p, now) for p in await promotions.live_promotions(session, now)
            if p.show_on_landing]


class ClaimIn(Schema):
    business_id: uuid.UUID | None = None


@router.get("/billing/free-offers", tags=["Usage & billing"], summary="Free-period offers you can claim",
            description="Promotions like \"1 year free\" for accounts on a free plan, whether you can claim them now, "
                        "and your running free period (`active`). Business accounts: the business you own "
                        "(`business_id` picks one if you own several).")
async def free_offers(user: CurrentUser, session: SessionDep,
                      business_id: uuid.UUID | None = None) -> dict:  # type: ignore[type-arg]
    return await free_periods.offers(session, user, business_id)


@router.post("/billing/free-offers/{promotion_id}/claim", status_code=201, tags=["Usage & billing"],
             summary="Claim a free-period offer (switches to the paid plan until it ends)")
async def claim_free_offer(promotion_id: uuid.UUID, body: ClaimIn, user: CurrentUser, session: SessionDep,
                           client: ClientDep) -> dict:  # type: ignore[type-arg]
    row = await free_periods.claim(session, user, promotion_id, body.business_id)
    audit.record(session, action="promotion.claim", user_id=user.id, client=client, resource_type="promotion",
                 resource_id=promotion_id, metadata={"plan": row.plan_code, "ends_at": row.ends_at.isoformat()})
    await session.commit()
    return await free_periods.offers(session, user, body.business_id)


class PromoValidateIn(Schema):
    code: str = Field(min_length=1, max_length=32)
    plan_code: str = Field(min_length=1, max_length=32)


@router.post("/billing/promotions/validate", tags=["Usage & billing"], summary="Check a promotion code for a plan")
async def validate_promotion(body: PromoValidateIn, user: CurrentUser, session: SessionDep) -> dict:  # type: ignore[type-arg]
    now = datetime.now(UTC)
    plan = (await session.execute(select(Plan).where(Plan.code == body.plan_code, Plan.is_active.is_(True)))
            ).scalar_one_or_none()
    promo = (await session.execute(select(Promotion).where(Promotion.code == body.code.strip().upper()))
             ).scalar_one_or_none()
    reason = None
    if plan is None:
        reason = "unknown_plan"
    elif promo is None:
        reason = "unknown_code"
    elif promo.status_at(now) != "active":
        reason = f"promotion_{promo.status_at(now)}"
    elif not promotions.applies_to(promo, plan):
        reason = "not_applicable"
    if reason:
        return {"valid": False, "promotion": None, "discounted_price_monthly_cents": None, "reason": reason}
    assert plan is not None and promo is not None
    return {"valid": True, "promotion": promotions.applied_out(promo, plan),
            "discounted_price_monthly_cents": promotions.discounted_price(promo, plan.price_monthly_cents),
            "reason": None}


@router.get(
    "/billing/subscription",
    response_model=SubscriptionOut,
    tags=["Usage & billing"],
    summary="Current subscription",
    description="Paid upgrades are architecture-only; no payment provider is connected yet.",
)
async def get_subscription(user: CurrentUser, session: SessionDep) -> SubscriptionOut:
    sub = await plan_service.get_subscription(session, user)
    return SubscriptionOut(
        plan=plan_out(sub.plan),
        status=sub.status,
        current_period_start=sub.current_period_start,
        current_period_end=sub.current_period_end,
    )


@router.get("/audit-logs", response_model=Page[AuditLogOut], tags=["Audit logs"], summary="Your audit trail")
async def audit_logs(user: CurrentUser, session: SessionDep, pagination: PaginationDep) -> Page[AuditLogOut]:
    cond = AuditLog.user_id == user.id
    total = (await session.execute(select(func.count()).select_from(AuditLog).where(cond))).scalar_one()
    rows = (
        await session.execute(
            select(AuditLog).where(cond).order_by(AuditLog.created_at.desc(), AuditLog.id)
            .offset(pagination.offset).limit(pagination.page_size)
        )
    ).scalars()
    return Page[AuditLogOut](
        items=[audit_out(a) for a in rows], total=total, page=pagination.page, page_size=pagination.page_size
    )
