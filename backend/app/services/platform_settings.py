"""Admin-editable platform settings (Part 2 §A5), cached ≤ 30 s per process."""

from __future__ import annotations

import asyncio
import copy
import logging
import time
import uuid
from typing import Any

from app.core.config import settings

logger = logging.getLogger("app.platform_settings")

KEY = "platform"
CACHE_TTL_SECONDS = 30.0
DEFAULTS: dict[str, Any] = {
    "signups_enabled": {"developer": True, "business": True},
    "request_log_retention_days": 90,
    "default_rate_limit": None,  # None → env RATE_LIMIT_REQUESTS / RATE_LIMIT_WINDOW_SECONDS
    "maintenance_message": None,
}

_stored: dict[str, Any] = {}
_loaded_at = float("-inf")
_lock: asyncio.Lock | None = None


def effective(stored: dict[str, Any] | None = None) -> dict[str, Any]:
    data = copy.deepcopy(DEFAULTS)
    src = _stored if stored is None else stored
    for key, value in src.items():
        if key == "signups_enabled" and isinstance(value, dict):
            data[key].update({k: bool(v) for k, v in value.items() if k in ("developer", "business")})
        elif key in data:
            data[key] = value
    if not data["default_rate_limit"]:
        data["default_rate_limit"] = {
            "requests": settings.RATE_LIMIT_REQUESTS,
            "window_seconds": settings.RATE_LIMIT_WINDOW_SECONDS,
        }
    return data


def rate_limit_override() -> tuple[int, int] | None:
    value = _stored.get("default_rate_limit")
    if isinstance(value, dict) and value.get("requests") and value.get("window_seconds"):
        return int(value["requests"]), int(value["window_seconds"])
    return None


def set_cache(stored: dict[str, Any]) -> None:
    global _stored, _loaded_at
    _stored = dict(stored)
    _loaded_at = time.monotonic()


async def reload() -> None:
    from app.db.session import SessionLocal
    from app.models import PlatformSetting

    async with SessionLocal() as session:
        row = await session.get(PlatformSetting, KEY)
    set_cache(dict(row.value) if row else {})


async def ensure_fresh() -> None:
    global _lock, _loaded_at
    if time.monotonic() - _loaded_at < CACHE_TTL_SECONDS:
        return
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        if time.monotonic() - _loaded_at < CACHE_TTL_SECONDS:
            return
        try:
            await reload()
        except Exception as exc:
            _loaded_at = time.monotonic()
            logger.warning("Could not load platform settings: %s", exc.__class__.__name__)


async def save(session, patch: dict[str, Any], user_id: uuid.UUID | None) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    from app.models import PlatformSetting

    row = await session.get(PlatformSetting, KEY)
    current = dict(row.value) if row else {}
    for key, value in patch.items():
        if key == "signups_enabled" and isinstance(value, dict):
            merged = dict(current.get("signups_enabled") or {})
            merged.update(value)
            current[key] = merged
        else:
            current[key] = value
    if row is None:
        session.add(PlatformSetting(key=KEY, value=current, updated_by=user_id))
    else:
        row.value = current
        row.updated_by = user_id
    await session.commit()
    set_cache(current)
    return effective(current)
