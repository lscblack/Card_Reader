"""Admin-managed CORS origins (contract 7.2): env CORS_ORIGINS ∪ DB, cached ≤ 30 s per process."""

from __future__ import annotations

import asyncio
import logging
import time
from urllib.parse import urlsplit

from sqlalchemy import select

from app.core.config import settings

logger = logging.getLogger("app.origins")

CACHE_TTL_SECONDS = 30.0
_db_origins: frozenset[str] = frozenset()
_loaded_at: float = float("-inf")
_lock: asyncio.Lock | None = None


def normalize_origin(value: str) -> str:
    """`scheme://host[:port]`, lowercase, no path/query/fragment, default ports dropped."""
    raw = (value or "").strip()
    if raw.endswith("/"):
        raw = raw[:-1]
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as exc:
        raise ValueError("origin is malformed") from exc
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("origin must start with http:// or https://")
    if scheme != "https" and not settings.is_development:
        raise ValueError("origin must use https outside development")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise ValueError("origin must not contain credentials")
    if parts.path or parts.query or parts.fragment or "?" in raw or "#" in raw:
        raise ValueError("origin must not contain a path, query or fragment")
    host = (parts.hostname or "").lower()
    if not host or "*" in host:
        raise ValueError("origin must contain a concrete host")
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    if port is not None and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
        return f"{scheme}://{host}:{port}"
    return f"{scheme}://{host}"


def env_origins() -> list[str]:
    return list(settings.CORS_ORIGINS)


def is_db_allowed(origin: str) -> bool:
    return origin in _db_origins


def invalidate() -> None:
    global _loaded_at
    _loaded_at = float("-inf")


def set_cache(origins: set[str] | frozenset[str]) -> None:
    global _db_origins, _loaded_at
    _db_origins = frozenset(origins)
    _loaded_at = time.monotonic()


async def reload() -> None:
    from app.db.session import SessionLocal
    from app.models import AllowedOrigin

    async with SessionLocal() as session:
        rows = (await session.execute(select(AllowedOrigin.origin))).scalars().all()
    set_cache(set(rows))


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
            # Keep the previous set; try again after the TTL.
            _loaded_at = time.monotonic()
            logger.warning("Could not refresh allowed origins: %s", exc.__class__.__name__)
