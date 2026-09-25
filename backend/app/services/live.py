"""Live run mode (Part 3 §8): per-application events over Redis pub/sub + a capped Redis stream for replay."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.redis import get_redis

logger = logging.getLogger("app.live")

CHANNEL = "nfc:live:app:{}"
STREAM = "nfc:live:log:{}"
CONN_KEY = "nfc:live:conn:{}"
STREAM_MAXLEN = 200
REPLAY_WINDOW = timedelta(minutes=10)
REPLAY_MAX = 100
HEARTBEAT_SECONDS = 15.0
MAX_STREAMS_PER_USER = 5


def _encode(data: Any) -> str:
    return json.dumps(data, default=str, separators=(",", ":"))


async def publish(application_id: uuid.UUID | str | None, type_: str, data: dict[str, Any]) -> None:
    """Fire-and-forget; never raises (live mode is best effort)."""
    if not application_id:
        return
    app_id = str(application_id)
    message = {"type": type_, "at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ"), "data": data}
    try:
        redis = get_redis()
        payload = _encode(message)
        await asyncio.wait_for(redis.xadd(STREAM.format(app_id), {"m": payload}, maxlen=STREAM_MAXLEN,
                                          approximate=True), timeout=1.0)
        await asyncio.wait_for(redis.expire(STREAM.format(app_id), int(REPLAY_WINDOW.total_seconds()) + 60), timeout=1.0)
        await asyncio.wait_for(redis.publish(CHANNEL.format(app_id), payload), timeout=1.0)
    except Exception as exc:  # pragma: no cover - best effort
        logger.debug("live publish failed: %s", exc.__class__.__name__)


def publish_later(application_id: uuid.UUID | str | None, type_: str, data: dict[str, Any]) -> None:
    try:
        task = asyncio.get_running_loop().create_task(publish(application_id, type_, data))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    except RuntimeError:  # pragma: no cover
        pass


_tasks: set[asyncio.Task[None]] = set()


async def wait_published() -> None:
    if _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def acquire_slot(user_id: uuid.UUID) -> bool:
    redis = get_redis()
    key = CONN_KEY.format(user_id)
    count = await redis.incr(key)
    await redis.expire(key, 3600)
    if count > MAX_STREAMS_PER_USER:
        await redis.decr(key)
        return False
    return True


async def release_slot(user_id: uuid.UUID) -> None:
    try:
        await get_redis().decr(CONN_KEY.format(user_id))
    except Exception:  # pragma: no cover
        pass


def _sse(message: dict[str, Any], event_id: str | None = None) -> str:
    lines = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {message.get('type', 'message')}")
    lines.append(f"data: {_encode(message)}")
    return "\n".join(lines) + "\n\n"


async def replay(app_id: str, since: datetime) -> list[tuple[str, dict[str, Any]]]:
    oldest = datetime.now(UTC) - REPLAY_WINDOW
    start = max(since, oldest)
    min_id = f"{int(start.timestamp() * 1000) + 1}-0"
    rows = await get_redis().xrange(STREAM.format(app_id), min=min_id, max="+", count=REPLAY_MAX)
    out = []
    for entry_id, fields in rows:
        try:
            out.append((entry_id if isinstance(entry_id, str) else entry_id.decode(), json.loads(fields["m"])))
        except (KeyError, ValueError, TypeError):
            continue
    return out


async def event_stream(
    app_id: str, since: datetime | None, is_disconnected: Callable[[], Awaitable[bool]],
    heartbeat: float = HEARTBEAT_SECONDS, poll: float = 1.0,
) -> AsyncIterator[str]:
    """Yields SSE frames: `retry`, replayed events, live events and heartbeat comments."""
    redis = get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe(CHANNEL.format(app_id))
    try:
        yield "retry: 3000\n\n"
        yield ": connected\n\n"
        if since is not None:
            for entry_id, message in await replay(app_id, since):
                yield _sse(message, entry_id)
        last_beat = time.monotonic()
        while not await is_disconnected():
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=poll)
            if msg and msg.get("type") == "message":
                try:
                    yield _sse(json.loads(msg["data"]))
                except (ValueError, TypeError):
                    pass
            if time.monotonic() - last_beat >= heartbeat:
                last_beat = time.monotonic()
                yield ": ping\n\n"
    finally:
        try:
            await pubsub.unsubscribe(CHANNEL.format(app_id))
            await pubsub.aclose()
        except Exception:  # pragma: no cover
            pass
