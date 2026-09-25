"""Shared async Redis client (overridable in tests)."""

from __future__ import annotations

from redis.asyncio import Redis

from app.core.config import settings

_client: Redis | None = None


def get_redis() -> Redis:
    global _client
    if _client is None:
        _client = Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_timeout=2,
            socket_connect_timeout=2,
            health_check_interval=30,
        )
    return _client


def set_redis(client: Redis | None) -> None:
    """Replace the client (tests use fakeredis)."""
    global _client
    _client = client


async def close_redis() -> None:
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        finally:
            _client = None


async def redis_ok() -> bool:
    try:
        return bool(await get_redis().ping())
    except Exception:
        return False
