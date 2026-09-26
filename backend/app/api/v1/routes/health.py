from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import VERSION, settings
from app.core.redis import redis_ok
from app.db.session import SessionLocal

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    summary="Service health",
    description=(
        "`status` is `ok` when the database and Redis are reachable, `degraded` when only Redis is down "
        "(the API keeps working: rate limiting fails open and retries wait), `error` (HTTP 503) when the "
        "database is unreachable."
    ),
    responses={200: {"content": {"application/json": {"example": {
        "status": "ok", "database": "ok", "redis": "ok", "version": VERSION}}}}},
)
async def health() -> JSONResponse:
    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
        db = "ok"
    except Exception:
        db = "error"
    redis = "ok" if await redis_ok() else "error"
    overall = "ok" if db == "ok" and redis == "ok" else ("error" if db != "ok" else "degraded")
    return JSONResponse(
        status_code=200 if db == "ok" else 503,
        content={"status": overall, "database": db, "redis": redis, "version": VERSION},
    )


@router.get(
    "/meta",
    summary="Public server info",
    description="`device_server_url` is the URL to enter as *Server URL* in the nexTap app.",
)
async def meta() -> dict[str, str]:
    return {
        "device_server_url": (settings.DEVICE_SERVER_URL or settings.API_BASE_URL).rstrip("/"),
        "environment": settings.ENVIRONMENT,
        "version": VERSION,
    }


@router.get(
    "/meta/status",
    summary="Public platform status (Part 2)",
    description="`maintenance_message` is set by admins in platform settings (null = none).",
)
async def meta_status() -> dict[str, str | None]:
    from app.services import platform_settings

    await platform_settings.ensure_fresh()
    return {
        "maintenance_message": platform_settings.effective()["maintenance_message"],
        "public_api_url": settings.public_api_url,
        "public_web_url": settings.public_web_url,
        "version": VERSION,
    }
