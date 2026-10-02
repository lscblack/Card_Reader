"""Page visit tracking (public) and the site-wide visits report for admins."""

from __future__ import annotations

from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import Field

from app.api.deps import AdminUser, ClientDep, SessionDep
from app.api.v1.routes.support import optional_user
from app.models import User
from app.schemas.common import Schema
from app.services import visits
from app.services.request_logs import set_actor

router = APIRouter(tags=["Visits"])
admin_router = APIRouter(prefix="/admin", tags=["Admin"])


class VisitIn(Schema):
    path: str = Field(min_length=1, max_length=2048)
    referrer: str | None = Field(default=None, max_length=2048)


@router.post("/visits", status_code=204, summary="Record a page visit",
             description="Sent by the web app when a public page is opened. Bots and signed-in areas are ignored.")
async def record_visit(body: VisitIn, request: Request, session: SessionDep, client: ClientDep,
                       user: Annotated[User | None, Depends(optional_user)]) -> Response:
    if user is None:
        set_actor(request, "public")
    origin = request.headers.get("origin") or request.headers.get("referer")
    own_host = urlsplit(origin).hostname if origin else None
    await visits.record(session, path=body.path, referrer=body.referrer, ip=client.ip, ua=client.user_agent,
                        own_host=own_host, user_id=user.id if user else None)
    return Response(status_code=204)


@admin_router.get("/visits", summary="Website visits")
async def site_visits(admin: AdminUser, session: SessionDep, days: int = Query(default=30, ge=1, le=365)) -> dict:  # type: ignore[type-arg]
    return await visits.site_report(session, days)
