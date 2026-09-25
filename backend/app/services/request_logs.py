"""Request logs (Part 2 §A2): captured per request, buffered in Redis, flushed in batches.

Never slows or fails a request: the push is a background task; if Redis is down entries go to a
bounded in-process buffer (dropped with a warning when full).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
import uuid
from collections import deque
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import Request

from app.core.config import settings
from app.core.redis import get_redis

logger = logging.getLogger("app.request_logs")

BUFFER_KEY = "nfc:reqlog:buffer"
PURGE_KEY = "nfc:reqlog:purged"
LOCAL_MAX = 5000
EXCLUDED_PREFIXES = ("/api/v1/health", "/docs", "/redoc", "/openapi.json", "/media/", "/favicon")

_local: deque[dict[str, Any]] = deque()
_pending: set[asyncio.Task[None]] = set()
_redis_down_until = 0.0
_last_drop_warning = 0.0

_IP_KEY = hashlib.sha256(("ip-hash:" + settings.JWT_SECRET).encode()).digest()


def ip_hash(ip: str | None) -> str | None:
    if not ip or ip == "unknown":
        return None
    return hmac.new(_IP_KEY, ip.encode(), hashlib.sha256).hexdigest()[:32]


def country_from(request: Request) -> str | None:
    """Only from a trusted proxy header (no GeoIP, no raw IP)."""
    if not settings.TRUST_PROXY_HEADERS:
        return None
    for header in ("cf-ipcountry", "x-country-code", "x-vercel-ip-country", "cloudfront-viewer-country"):
        value = (request.headers.get(header) or "").strip().upper()
        if len(value) == 2 and value.isalpha() and value not in ("XX", "T1"):
            return value
    return None


def should_log(request: Request) -> bool:
    if not settings.REQUEST_LOG_ENABLED or request.method == "OPTIONS":
        return False
    return not request.url.path.startswith(EXCLUDED_PREFIXES)


def set_actor(request: Request, actor_type: str, actor_id: Any = None, **ids: Any) -> None:
    """Called by auth dependencies/routes to attribute the request."""
    state = request.state
    # The strongest credential wins (device/api_key over anonymous/public).
    state.actor_type = actor_type
    state.actor_id = actor_id
    for key, value in ids.items():
        if value is not None:
            setattr(state, key, value)


def route_template(request: Request) -> str:
    """Full route template (e.g. /api/v1/applications/{application_id}); routers are nested, so the matched
    route's own path is relative — rebuild the prefix from the real path."""
    route = request.scope.get("route")
    rel = getattr(route, "path", None)
    if not rel:
        return "(unmatched)"
    path = request.url.path
    params = request.scope.get("path_params") or {}
    try:
        rendered = rel.format(**{k: v for k, v in params.items()})
    except (KeyError, IndexError, ValueError):
        rendered = None
    if rendered and path.endswith(rendered):
        return path[: len(path) - len(rendered)] + rel
    values = {str(v): k for k, v in params.items()}
    return "/".join("{" + values[seg] + "}" if seg in values else seg for seg in path.split("/"))


def build_entry(request: Request, status_code: int, latency_ms: int, request_id: str) -> dict[str, Any]:
    from app.core.rate_limit import client_ip

    state = request.state
    template = route_template(request)
    outcome = "success" if status_code < 400 else ("client_error" if status_code < 500 else "server_error")

    def _s(name: str) -> str | None:
        value = getattr(state, name, None)
        return str(value) if value is not None else None

    return {
        "id": str(uuid.uuid4()),
        "created_at": datetime.now(UTC).isoformat(),
        "request_id": request_id,
        "method": request.method,
        "route": template[:200],
        "path": request.url.path[:500],
        "status_code": status_code,
        "outcome": outcome,
        "latency_ms": latency_ms,
        "error_code": getattr(state, "error_code", None),
        "actor_type": getattr(state, "actor_type", None) or "anonymous",
        "actor_id": _s("actor_id"),
        "user_id": _s("user_id"),
        "business_id": _s("business_id"),
        "application_id": _s("application_id"),
        "device_id": _s("device_id"),
        "ip_hash": ip_hash(client_ip(request)),
        "user_agent": (request.headers.get("user-agent") or "")[:256] or None,
        "country": country_from(request),
    }


def _local_append(entry: dict[str, Any]) -> None:
    global _last_drop_warning
    if len(_local) >= LOCAL_MAX:
        _local.popleft()
        now = time.monotonic()
        if now - _last_drop_warning > 30:
            _last_drop_warning = now
            logger.warning("Request log buffer full; dropping oldest entries")
    _local.append(entry)


async def _push(entry: dict[str, Any]) -> None:
    global _redis_down_until
    if time.monotonic() < _redis_down_until:
        _local_append(entry)
        return
    try:
        await asyncio.wait_for(get_redis().rpush(BUFFER_KEY, json.dumps(entry)), timeout=1.0)
    except Exception:
        _redis_down_until = time.monotonic() + 10
        _local_append(entry)


def schedule(entry: dict[str, Any]) -> None:
    try:
        task = asyncio.get_running_loop().create_task(_push(entry))
    except RuntimeError:  # pragma: no cover - no loop
        _local_append(entry)
        return
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def wait_pending() -> None:
    if _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


def _row(entry: dict[str, Any]) -> dict[str, Any]:
    row = dict(entry)
    row["created_at"] = datetime.fromisoformat(row["created_at"])
    for key in ("id", "actor_id", "user_id", "business_id", "application_id", "device_id"):
        if row.get(key):
            try:
                row[key] = uuid.UUID(str(row[key]))
            except ValueError:
                row[key] = None
    return row


async def buffer_depth() -> int:
    try:
        return int(await get_redis().llen(BUFFER_KEY)) + len(_local)
    except Exception:
        return len(_local)


async def flush(session_factory: async_sessionmaker[AsyncSession], batch: int = 500) -> int:
    """Moves buffered entries into request_logs. Returns rows written."""
    await wait_pending()
    entries: list[dict[str, Any]] = []
    while _local and len(entries) < batch * 4:
        entries.append(_local.popleft())
    try:
        redis = get_redis()
        while len(entries) < batch * 4:
            raw = await redis.lpop(BUFFER_KEY, batch)
            if not raw:
                break
            entries.extend(json.loads(r) for r in raw)
    except Exception:
        pass
    if not entries:
        return 0
    try:
        async with session_factory() as session:
            for i in range(0, len(entries), batch):
                await session.execute(insert(_model()), [_row(e) for e in entries[i : i + batch]])
            await session.commit()
    except Exception as exc:
        logger.warning("Request log flush failed (%s); keeping %d entries", exc.__class__.__name__, len(entries))
        for entry in entries[-LOCAL_MAX:]:
            _local_append(entry)
        return 0
    return len(entries)


def _model():  # type: ignore[no-untyped-def]
    from app.models import RequestLog

    return RequestLog


async def purge(session_factory: async_sessionmaker[AsyncSession], *, force: bool = False) -> int:
    """Deletes logs older than the retention period (once per day across all workers)."""
    from app.services import platform_settings

    if not force:
        try:
            if not await get_redis().set(PURGE_KEY, "1", nx=True, ex=86400):
                return 0
        except Exception:
            return 0
    days = int(platform_settings.effective()["request_log_retention_days"])
    cutoff = datetime.now(UTC) - timedelta(days=days)
    async with session_factory() as session:
        result = await session.execute(delete(_model()).where(_model().created_at < cutoff))
        await session.commit()
    return int(result.rowcount or 0)


async def run_flusher(session_factory: async_sessionmaker[AsyncSession], stop: asyncio.Event, poll: float = 2.0) -> None:
    while not stop.is_set():
        try:
            await flush(session_factory)
        except Exception as exc:  # pragma: no cover
            logger.warning("Request log flusher iteration failed: %s", exc.__class__.__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=poll)
        except (TimeoutError, asyncio.TimeoutError):
            pass
    await flush(session_factory)
