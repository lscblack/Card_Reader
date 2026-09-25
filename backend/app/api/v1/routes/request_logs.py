"""Request logs (Part 2 §A2) — scoped to what the caller owns."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import and_, func, or_, select

from app.api.deps import CurrentUser, PaginationDep, SessionDep, load_business_context
from app.core.errors import not_found
from app.models import RequestLog, User
from app.schemas.business import RequestLogOut
from app.schemas.common import Page
from app.services.applications import developer_app_ids
from app.services.business_serializers import request_log_out

router = APIRouter(prefix="/request-logs", tags=["Request logs"])


def filter_conditions(
    *, status: int | None = None, outcome: str | None = None, route: str | None = None,
    error_code: str | None = None, application_id: uuid.UUID | None = None, device_id: uuid.UUID | None = None,
    date_from: datetime | None = None, date_to: datetime | None = None, request_id: str | None = None,
    user_id: uuid.UUID | None = None, business_id: uuid.UUID | None = None, actor_type: str | None = None,
    min_latency_ms: int | None = None,
) -> list:  # type: ignore[type-arg]
    conds = []
    if status is not None:
        conds.append(RequestLog.status_code == status)
    if outcome:
        conds.append(RequestLog.outcome == outcome)
    if route:
        conds.append(RequestLog.route == route)
    if error_code:
        conds.append(RequestLog.error_code == error_code)
    if application_id:
        conds.append(RequestLog.application_id == application_id)
    if device_id:
        conds.append(RequestLog.device_id == device_id)
    if date_from:
        conds.append(RequestLog.created_at >= date_from)
    if date_to:
        conds.append(RequestLog.created_at < date_to)
    if request_id:
        conds.append(RequestLog.request_id == request_id)
    if user_id:
        conds.append(RequestLog.user_id == user_id)
    if business_id:
        conds.append(RequestLog.business_id == business_id)
    if actor_type:
        conds.append(RequestLog.actor_type == actor_type)
    if min_latency_ms is not None:
        conds.append(RequestLog.latency_ms >= min_latency_ms)
    return conds


async def scope_conditions(session: SessionDep, user: User, business_id: uuid.UUID | None, request: Request) -> list:  # type: ignore[type-arg]
    if business_id is not None:
        ctx = await load_business_context(session, user, business_id, request)
        ctx.require("api.view")
        return [RequestLog.business_id == business_id]
    # Developer: own dashboard requests + requests hitting own (non-business) apps/devices.
    return [
        RequestLog.business_id.is_(None),
        or_(RequestLog.user_id == user.id,
            and_(RequestLog.application_id.is_not(None), RequestLog.application_id.in_(developer_app_ids(user.id)))),
    ]


async def paginate(session: SessionDep, conds: list, pagination: PaginationDep) -> Page[RequestLogOut]:  # type: ignore[type-arg]
    total = (await session.execute(select(func.count()).select_from(RequestLog).where(*conds))).scalar_one()
    rows = (await session.execute(
        select(RequestLog).where(*conds).order_by(RequestLog.created_at.desc(), RequestLog.id)
        .offset(pagination.offset).limit(pagination.page_size)
    )).scalars()
    return Page[RequestLogOut](items=[request_log_out(r) for r in rows], total=total, page=pagination.page,
                               page_size=pagination.page_size)


@router.get("", response_model=Page[RequestLogOut], summary="Request logs (successful and failed)",
            description="Developer: own dashboard requests and requests to own applications/devices. "
                        "With `business_id` (needs `api.view`): the business's apps, devices and public taps.")
async def list_request_logs(
    user: CurrentUser, session: SessionDep, pagination: PaginationDep, request: Request,
    status: int | None = Query(default=None, ge=100, le=599),
    outcome: Literal["success", "client_error", "server_error"] | None = None,
    route: str | None = Query(default=None, max_length=200),
    error_code: str | None = Query(default=None, max_length=64),
    application_id: uuid.UUID | None = None, device_id: uuid.UUID | None = None,
    date_from: datetime | None = None, date_to: datetime | None = None,
    request_id: str | None = Query(default=None, max_length=64),
    business_id: uuid.UUID | None = None,
) -> Page[RequestLogOut]:
    conds = await scope_conditions(session, user, business_id, request)
    conds += filter_conditions(status=status, outcome=outcome, route=route, error_code=error_code,
                               application_id=application_id, device_id=device_id, date_from=date_from,
                               date_to=date_to, request_id=request_id)
    return await paginate(session, conds, pagination)


@router.get("/{log_id}", response_model=RequestLogOut, summary="One request log")
async def get_request_log(log_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request,
                          business_id: uuid.UUID | None = None) -> RequestLogOut:
    row = await session.get(RequestLog, log_id)
    if row is None:
        raise not_found("Request log")
    scope_business = business_id or row.business_id
    conds = await scope_conditions(session, user, scope_business, request)
    visible = (await session.execute(select(RequestLog.id).where(RequestLog.id == log_id, *conds))).first()
    if not visible:
        raise not_found("Request log")
    return request_log_out(row)
