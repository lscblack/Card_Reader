"""Live run mode SSE (Part 3 §8) and in-app notifications (§10)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update

from app.api.deps import CurrentUser, PaginationDep, PlatformUser, SessionDep
from app.core.errors import AppError, not_found
from app.core.redis import redis_ok
from app.models import Notification
from app.services import live
from app.services.applications import get_owned_application

router = APIRouter(tags=["Live & notifications"])


@router.get(
    "/live/applications/{application_id}",
    summary="Live stream of an application's activity (Server-Sent Events)",
    description="`text/event-stream` over fetch (Authorization header). Events: `event.received`, `delivery.attempt`, "
                "`sandbox.request`, `business.tap`; heartbeat comment every 15 s. `?since=<ISO>` replays up to 100 "
                "events from the last 10 minutes. Max 5 concurrent streams per user (`429 too_many_streams`); "
                "`503 live_unavailable` without Redis.",
)
async def live_stream(application_id: uuid.UUID, request: Request, user: PlatformUser, session: SessionDep,
                      since: datetime | None = None) -> StreamingResponse:
    app = await get_owned_application(session, user, application_id, permission="api.view")
    app_id = str(app.id)
    user_id = user.id
    await session.close()  # don't hold a DB connection for the lifetime of the stream
    if not await redis_ok():
        raise AppError(503, "live_unavailable", "Live updates are unavailable (Redis); fall back to polling")
    if since is not None and since.tzinfo is None:
        since = since.replace(tzinfo=UTC)
    if not await live.acquire_slot(user_id):
        raise AppError(429, "too_many_streams", "Too many live streams open for this user (max 5)")

    async def frames():  # type: ignore[no-untyped-def]
        try:
            async for frame in live.event_stream(app_id, since, request.is_disconnected):
                yield frame
        finally:
            await live.release_slot(user_id)

    return StreamingResponse(frames(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


def _notification_out(n: Notification) -> dict[str, Any]:
    return {"id": str(n.id), "type": n.type, "title": n.title, "body": n.body, "link": n.link, "severity": n.severity,
            "read_at": n.read_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if n.read_at else None,
            "created_at": n.created_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


@router.get("/notifications", summary="My notifications")
async def list_notifications(user: CurrentUser, session: SessionDep, pagination: PaginationDep,
                             unread: bool | None = None) -> dict[str, Any]:
    conds = [Notification.user_id == user.id]
    if unread is True:
        conds.append(Notification.read_at.is_(None))
    elif unread is False:
        conds.append(Notification.read_at.is_not(None))
    total = (await session.execute(select(func.count()).select_from(Notification).where(*conds))).scalar_one()
    rows = (await session.execute(select(Notification).where(*conds)
                                  .order_by(Notification.created_at.desc(), Notification.id)
                                  .offset(pagination.offset).limit(pagination.page_size))).scalars()
    return {"items": [_notification_out(n) for n in rows], "total": total, "page": pagination.page,
            "page_size": pagination.page_size}


@router.get("/notifications/unread-count", summary="Unread notification count")
async def unread_count(user: CurrentUser, session: SessionDep) -> dict[str, int]:
    count = (await session.execute(select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, Notification.read_at.is_(None)))).scalar_one()
    return {"unread": int(count)}


@router.post("/notifications/{notification_id}/read", summary="Mark one notification read")
async def mark_read(notification_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> dict[str, Any]:
    n = await session.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise not_found("Notification")
    if n.read_at is None:
        n.read_at = datetime.now(UTC)
        await session.commit()
    return _notification_out(n)


@router.post("/notifications/read-all", status_code=204, summary="Mark all notifications read")
async def mark_all_read(user: CurrentUser, session: SessionDep) -> Response:
    await session.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
                          .values(read_at=datetime.now(UTC)))
    await session.commit()
    return Response(status_code=204)
