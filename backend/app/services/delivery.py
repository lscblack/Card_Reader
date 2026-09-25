"""Webhook delivery: payload building, HMAC signing, sending, retries (Redis delayed queue)."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import RETRY_BACKOFF_SECONDS, VERSION, settings
from app.core.redis import get_redis
from app.core.security import decrypt_secret, new_nonce, sign_payload
from app.models import Application, Delivery, NfcEvent
from app.schemas.common import _iso_z
from app.services import usage
from app.services.url_validation import InvalidEndpointURL, url_matches_allowlist, validate_endpoint_url

logger = logging.getLogger("app.delivery")

QUEUE_KEY = "nfc:delivery:queue"
WORKER_HEARTBEAT_KEY = "nfc:worker:heartbeat"
LOCK_PREFIX = "nfc:delivery:lock:"
LOCK_TTL_MS = 120_000
EXCERPT_MAX_CHARS = 500
_READ_LIMIT_BYTES = 4096
RELAY_USER_AGENT = "NFCPlatform-Webhook/1.0"
DIRECT_USER_AGENT = "NFCPlatform-Terminal/1.0"
NIL_UUID = "00000000-0000-0000-0000-000000000000"

# Errors that will not get better by retrying.
PERMANENT_ERRORS = (
    "application_disabled", "endpoint_not_configured", "endpoint_disabled", "invalid_endpoint_url",
    "domain_not_allowed",
)


# ── HTTP client ──────────────────────────────────────────────────────────
_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            follow_redirects=False,
            trust_env=False,
            limits=httpx.Limits(max_connections=200, max_keepalive_connections=50),
            headers={"Accept": "*/*"},
        )
    return _client


async def close_http_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ── Payload & signing ────────────────────────────────────────────────────
def build_event_payload(event: NfcEvent, mode: str = "relay") -> dict[str, Any]:
    return {
        "event_id": str(event.id),
        "event": event.event_type,
        "card_id": event.card_id,
        "card": {
            "uid": event.card_id,
            "uid_length": math.ceil(len(event.card_id) / 2),
            "technologies": list(event.card_technologies or []),
            "type": event.card_type,
        },
        "security": {"authenticated": False, "level": "signed_token" if (event.extra or {}).get(
            "digital_card", {}).get("verified") else "uid_only"},
        "device_id": str(event.device_id) if event.device_id else None,
        "application_id": str(event.application_id),
        "delivery_mode": mode,
        "test": False,
        "timestamp": _iso_z(event.detected_at),
        **(event.extra or {}),
    }


def build_test_payload(application_id: uuid.UUID) -> dict[str, Any]:
    return {
        "event_id": str(uuid.uuid4()),
        "event": "endpoint.test",
        "card_id": "TEST0000",
        "card": {"uid": "TEST0000", "uid_length": 4, "technologies": ["NfcA"], "type": None},
        "security": {"authenticated": False, "level": "uid_only"},
        "device_id": NIL_UUID,
        "application_id": str(application_id),
        "delivery_mode": "relay",
        "test": True,
        "timestamp": _iso_z(datetime.now(UTC)),
    }


def serialize_body(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def signed_headers(
    *,
    secret: str,
    raw_body: bytes,
    event_id: str,
    device_id: str,
    mode: str,
    custom_headers: dict[str, str] | None = None,
    timestamp: int | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    ts = str(timestamp if timestamp is not None else int(time.time()))
    nonce = nonce or new_nonce()
    headers: dict[str, str] = dict(custom_headers or {})
    headers.update(
        {
            "Content-Type": "application/json",
            "User-Agent": RELAY_USER_AGENT if mode == "relay" else DIRECT_USER_AGENT,
            "X-NFC-Event-Id": event_id,
            "X-NFC-Timestamp": ts,
            "X-NFC-Nonce": nonce,
            "X-NFC-Device-Id": device_id,
            "X-NFC-Delivery-Mode": mode,
            "X-NFC-Signature": sign_payload(secret, ts, nonce, raw_body),
        }
    )
    return headers


# ── Sending ──────────────────────────────────────────────────────────────
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
_SIMPLE_CODES = ("application_disabled", "endpoint_not_configured", "endpoint_disabled", "domain_not_allowed",
                 "webhook_secret_not_configured")


def error_code_for(error: str | None, status_code: int | None) -> str | None:
    """Maps an attempt's error text to a catalog code (Part 2 §A1)."""
    if not error:
        return None
    for code in _SIMPLE_CODES:
        if error.startswith(code):
            return code
    if error.startswith("invalid_endpoint_url"):
        return "delivery_ssrf_blocked"
    if error.startswith("timeout"):
        return "delivery_timeout"
    if error.startswith("response too large"):
        return "delivery_response_too_large"
    if status_code is not None:
        if 300 <= status_code < 400:
            return "delivery_redirect_blocked"
        if 400 <= status_code < 500:
            return "delivery_http_4xx"
        if status_code >= 500:
            return "delivery_http_5xx"
    return "delivery_failed"


def _classify_exception(exc: BaseException) -> str:
    parts: list[str] = []
    cur: BaseException | None = exc
    for _ in range(6):
        if cur is None:
            break
        parts.append(f"{cur.__class__.__name__} {cur}")
        cur = cur.__cause__ or cur.__context__
    text = " ".join(parts).lower()
    if "ssl" in text or "certificate" in text or "tls" in text:
        return "delivery_tls_error"
    if any(k in text for k in ("name or service not known", "nodename nor servname", "getaddrinfo",
                               "name resolution", "no address associated", "gaierror")):
        return "delivery_dns_failure"
    if "refused" in text or "errno 111" in text:
        return "delivery_connection_refused"
    return "delivery_connection_error"


@dataclass
class AttemptResult:
    success: bool
    status_code: int | None = None
    latency_ms: int | None = None
    error: str | None = None
    response_excerpt: str | None = None
    error_code: str | None = None
    request_payload: dict[str, Any] | None = None
    response_headers: dict[str, str] | None = None

    def __post_init__(self) -> None:
        if not self.success and self.error_code is None:
            self.error_code = error_code_for(self.error, self.status_code)

    @property
    def error_ref(self) -> str | None:
        from app.core.error_catalog import ref_for

        return ref_for(self.error_code)


async def send_signed(**kwargs: Any) -> AttemptResult:
    result = await _send_signed(**kwargs)
    result.request_payload = kwargs.get("payload")
    return result


async def _send_signed(
    *,
    url: str,
    secret: str,
    payload: dict[str, Any],
    timeout_seconds: int,
    custom_headers: dict[str, str] | None = None,
) -> AttemptResult:
    """One signed POST. Never raises; never follows redirects."""
    try:
        await validate_endpoint_url(url)
    except InvalidEndpointURL as exc:
        return AttemptResult(success=False, error=f"invalid_endpoint_url: {exc}")

    raw_body = serialize_body(payload)
    headers = signed_headers(
        secret=secret,
        raw_body=raw_body,
        event_id=payload["event_id"],
        device_id=payload["device_id"] or NIL_UUID,
        mode="relay",
        custom_headers=custom_headers,
    )
    started = time.perf_counter()
    status_code: int | None = None
    try:
        async with asyncio.timeout(timeout_seconds):
            async with get_http_client().stream(
                "POST", url, content=raw_body, headers=headers, timeout=timeout_seconds
            ) as response:
                status_code = response.status_code
                latency_ms = int((time.perf_counter() - started) * 1000)
                resp_headers = {k: response.headers[k] for k in ("content-type", "content-length")
                                if k in response.headers}
                declared = int(response.headers.get("content-length") or 0)
                if declared > MAX_RESPONSE_BYTES:
                    return AttemptResult(False, status_code, latency_ms,
                                         f"response too large ({declared} bytes)", None)
                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) >= _READ_LIMIT_BYTES:
                        break
        live_excerpt = bytes(chunks[:2048]).decode("utf-8", errors="replace") or None
        excerpt = (live_excerpt or "")[:EXCERPT_MAX_CHARS] or None
        success = 200 <= status_code < 300
        error = None
        if not success:
            error = f"HTTP {status_code}"
            if 300 <= status_code < 400:
                error += " (redirects are not followed)"
        result = AttemptResult(success, status_code, latency_ms, error, excerpt)
        result.response_headers = {k: v for k, v in resp_headers.items()}
        result.live_excerpt = live_excerpt  # type: ignore[attr-defined]
        return result
    except (TimeoutError, asyncio.TimeoutError, httpx.TimeoutException):
        return AttemptResult(
            False, status_code, int((time.perf_counter() - started) * 1000),
            f"timeout after {timeout_seconds}s",
        )
    except httpx.HTTPError as exc:
        return AttemptResult(
            False, status_code, int((time.perf_counter() - started) * 1000),
            f"connection_error: {exc.__class__.__name__}", None, _classify_exception(exc),
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Unexpected delivery error")
        return AttemptResult(False, status_code, None, f"error: {exc.__class__.__name__}")


async def test_endpoint(application: Application) -> AttemptResult:
    if not application.endpoint_url:
        return AttemptResult(False, error="endpoint_not_configured")
    if not application.webhook_secret_encrypted:
        return AttemptResult(False, error="webhook_secret_not_configured")
    if not url_matches_allowlist(application.endpoint_url, application.allowed_domains):
        return AttemptResult(False, error="domain_not_allowed")
    return await send_signed(
        url=application.endpoint_url,
        secret=decrypt_secret(application.webhook_secret_encrypted),
        payload=build_test_payload(application.id),
        timeout_seconds=application.endpoint_timeout_seconds,
        custom_headers=application.endpoint_custom_headers,
    )


# ── Relay attempts ───────────────────────────────────────────────────────
def backoff_seconds(attempt_no: int) -> int:
    return RETRY_BACKOFF_SECONDS[min(max(attempt_no, 1) - 1, len(RETRY_BACKOFF_SECONDS) - 1)]


async def _relay_send(application: Application, event: NfcEvent) -> AttemptResult:
    if application.deleted_at is not None or not application.is_active:
        return AttemptResult(False, error="application_disabled")
    if not application.endpoint_url or not application.webhook_secret_encrypted:
        return AttemptResult(False, error="endpoint_not_configured")
    if not application.endpoint_enabled:
        return AttemptResult(False, error="endpoint_disabled")
    if not url_matches_allowlist(application.endpoint_url, application.allowed_domains):
        return AttemptResult(False, error="domain_not_allowed")  # endpoint is not contacted
    return await send_signed(
        url=application.endpoint_url,
        secret=decrypt_secret(application.webhook_secret_encrypted),
        payload=build_event_payload(event, "relay"),
        timeout_seconds=application.endpoint_timeout_seconds,
        custom_headers=application.endpoint_custom_headers,
    )


async def perform_relay_attempt(
    session: AsyncSession,
    event: NfcEvent,
    *,
    schedule_retries: bool = True,
    is_redelivery: bool = False,
) -> Delivery:
    """Makes one signed attempt, records a Delivery row, updates the event, commits."""
    application = event.application
    result = await _relay_send(application, event)
    attempt_no = event.attempts + 1
    now = datetime.now(UTC)

    delivery = Delivery(
        event_id=event.id,
        application_id=event.application_id,
        owner_id=event.owner_id,
        attempt=attempt_no,
        mode="relay",
        url=application.endpoint_url,
        success=result.success,
        status_code=result.status_code,
        latency_ms=result.latency_ms,
        error=result.error,
        error_code=result.error_code,
        response_excerpt=result.response_excerpt,
    )
    session.add(delivery)
    event.attempts = attempt_no
    event.last_status_code = result.status_code
    event.last_error = result.error
    event.last_error_code = result.error_code

    enqueue_at: datetime | None = None
    if result.success:
        event.delivered_at = now
        event.next_attempt_at = None
        await usage.set_status(session, event, "delivered")
    else:
        permanent = (result.error or "").startswith(PERMANENT_ERRORS)
        if schedule_retries and not permanent and attempt_no <= settings.WEBHOOK_MAX_RETRIES:
            enqueue_at = now + timedelta(seconds=backoff_seconds(attempt_no))
            event.next_attempt_at = enqueue_at
            await usage.set_status(session, event, "retrying")
        elif is_redelivery and event.status == "retrying" and not permanent:
            pass  # the scheduled retries continue
        else:
            event.next_attempt_at = None
            await usage.set_status(session, event, "failed")
    await session.commit()

    if enqueue_at is not None:
        await enqueue(event.id, enqueue_at)
    from app.services import live

    live.publish_later(event.application_id, "delivery.attempt", {
        "event_id": str(event.id), "attempt": attempt_no, "mode": "relay", "url": application.endpoint_url,
        "success": result.success, "status_code": result.status_code, "latency_ms": result.latency_ms,
        "error_code": result.error_code, "error_ref": result.error_ref,
        "response_excerpt": getattr(result, "live_excerpt", result.response_excerpt),
        "response_headers": result.response_headers or {}, "request_payload": result.request_payload,
    })
    log = logger.info if result.success else logger.warning
    log(
        "delivery attempt event=%s attempt=%d success=%s status=%s latency_ms=%s error=%s",
        event.id, attempt_no, result.success, result.status_code, result.latency_ms, result.error,
    )
    return delivery


# ── Queue & locks ────────────────────────────────────────────────────────
async def enqueue(event_id: uuid.UUID, due: datetime) -> bool:
    try:
        await get_redis().zadd(QUEUE_KEY, {str(event_id): due.timestamp()})
        return True
    except Exception as exc:
        logger.warning(
            "Could not enqueue retry for event %s (%s); the recovery scan will pick it up",
            event_id, exc.__class__.__name__,
        )
        return False


async def acquire_lock(event_id: uuid.UUID | str) -> str | None:
    token = secrets.token_hex(8)
    try:
        ok = await get_redis().set(f"{LOCK_PREFIX}{event_id}", token, nx=True, px=LOCK_TTL_MS)
    except Exception:
        return "no-redis"  # fail open; DB status checks still guard double processing
    return token if ok else None


async def release_lock(event_id: uuid.UUID | str, token: str) -> None:
    if token == "no-redis":
        return
    key = f"{LOCK_PREFIX}{event_id}"
    try:
        redis = get_redis()
        if await redis.get(key) == token:
            await redis.delete(key)
    except Exception:
        pass


async def _load_event(session: AsyncSession, event_id: uuid.UUID) -> NfcEvent | None:
    return (
        await session.execute(
            select(NfcEvent).where(NfcEvent.id == event_id).execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def process_event(session: AsyncSession, event_id: uuid.UUID, now: datetime | None = None) -> bool:
    """Processes one due retry. Returns True if an attempt was made."""
    event = await _load_event(session, event_id)
    if event is None or event.status != "retrying":
        return False
    now = now or datetime.now(UTC)
    if event.next_attempt_at and event.next_attempt_at > now + timedelta(seconds=1):
        await enqueue(event.id, event.next_attempt_at)  # rescheduled elsewhere
        return False
    await perform_relay_attempt(session, event, schedule_retries=True)
    return True


async def process_due(
    session_factory: async_sessionmaker[AsyncSession], *, now: float | None = None, batch: int = 50
) -> int:
    """Pops due retries from the queue and processes them. Returns attempts made."""
    redis = get_redis()
    now = now if now is not None else time.time()
    ids: list[str] = await redis.zrangebyscore(QUEUE_KEY, "-inf", now, start=0, num=batch)
    processed = 0
    for raw_id in ids:
        token = await acquire_lock(raw_id)
        if token is None:
            continue
        try:
            if not await redis.zrem(QUEUE_KEY, raw_id):
                continue  # another worker took it
            async with session_factory() as session:
                if await process_event(session, uuid.UUID(raw_id), datetime.fromtimestamp(now, UTC)):
                    processed += 1
        except Exception:
            logger.exception("Failed processing retry for event %s", raw_id)
        finally:
            await release_lock(raw_id, token)
    return processed


async def recover_orphans(session_factory: async_sessionmaker[AsyncSession], grace_seconds: int = 30) -> int:
    """Re-queues `retrying` events whose queue entry was lost (Redis outage/crash)."""
    cutoff = datetime.now(UTC) - timedelta(seconds=grace_seconds)
    async with session_factory() as session:
        rows = (
            await session.execute(
                select(NfcEvent.id, NfcEvent.next_attempt_at)
                .where(NfcEvent.status == "retrying", NfcEvent.next_attempt_at < cutoff)
                .limit(500)
            )
        ).all()
    if not rows:
        return 0
    redis = get_redis()
    added = await redis.zadd(QUEUE_KEY, {str(r[0]): r[1].timestamp() for r in rows}, nx=True)
    if added:
        logger.info("Recovered %d orphaned retries", added)
    return int(added)


async def run_worker(
    session_factory: async_sessionmaker[AsyncSession],
    stop: asyncio.Event,
    poll_seconds: float | None = None,
) -> None:
    poll = poll_seconds or settings.DELIVERY_WORKER_POLL_SECONDS
    logger.info("Delivery worker started (v%s, poll=%.1fs)", VERSION, poll)
    last_recovery = 0.0
    from app.services import app_builds, request_logs

    try:
        await app_builds.recover_orphans(session_factory)
    except Exception as exc:
        logger.warning("Orphaned build recovery failed: %s", exc.__class__.__name__)
    while not stop.is_set():
        try:
            await get_redis().set(WORKER_HEARTBEAT_KEY, datetime.now(UTC).isoformat(), ex=120)
        except Exception:
            pass
        try:
            from app.services import app_builds

            await app_builds.maybe_start(session_factory)
        except Exception as exc:
            logger.warning("App build check failed: %s", exc.__class__.__name__)
        try:
            from app.services import email as email_service

            await email_service.process_queue(session_factory)
        except Exception as exc:
            logger.warning("Email queue iteration failed: %s", exc.__class__.__name__)
        try:
            await request_logs.flush(session_factory)
            await request_logs.purge(session_factory)
        except Exception as exc:
            logger.warning("Request log maintenance failed: %s", exc.__class__.__name__)
        try:
            if time.monotonic() - last_recovery > 30:
                last_recovery = time.monotonic()
                await recover_orphans(session_factory)
            await process_due(session_factory)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Delivery worker iteration failed: %s", exc.__class__.__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=poll)
        except (TimeoutError, asyncio.TimeoutError):
            pass
    logger.info("Delivery worker stopped")
