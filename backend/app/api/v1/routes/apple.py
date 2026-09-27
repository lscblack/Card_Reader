"""iOS universal links: the apple-app-site-association file for card tap links (/t/{code})."""

from __future__ import annotations

import re

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.errors import error_response
from app.services.request_logs import set_actor

root_router = APIRouter(tags=["Public"])

# The nexTap app adds ?via=app when it opens a tap link in the browser itself (e.g. a card of another
# business): those must not come straight back to the app. /t/ ignores the parameter.
BROWSER_MARKER = {"via": "app"}

TEAM_ID = re.compile(r"^[A-Z0-9]{10}$")


def association() -> dict | None:
    """The AASA document, or None when the iOS app isn't configured (no Team ID)."""
    team = settings.APPLE_TEAM_ID.strip().upper()
    bundle = settings.IOS_BUNDLE_ID.strip()
    # A wrong Team ID would publish a file that silently never matches the app: better no file at all.
    if not TEAM_ID.match(team) or not bundle:
        return None
    return {
        "applinks": {
            "details": [{
                "appIDs": [f"{team}.{bundle}"],
                "components": [
                    {"/": "/t/*", "?": BROWSER_MARKER, "exclude": True,
                     "comment": "Opened by the app itself: stay in the browser"},
                    {"/": "/t/*", "comment": "Card tap links open the nexTap app when it is installed"},
                ],
            }],
        },
    }


@root_router.get("/.well-known/apple-app-site-association", include_in_schema=False)
async def apple_app_site_association(request: Request) -> Response:
    # Fetched by Apple's CDN when the app is installed: plain JSON, no redirect, no auth.
    set_actor(request, "public")
    body = association()
    if body is None:
        return error_response(404, "not_found", "iOS app links are not configured (APPLE_TEAM_ID: 10 letters/digits)",
                              request=request)
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=3600"})
