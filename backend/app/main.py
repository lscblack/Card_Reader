"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router, root_router
from app.core.config import VERSION, settings
from app.core.cors import DynamicCORSMiddleware
from app.core.errors import error_response, register_exception_handlers
from app.core.logging import request_id_ctx, setup_logging
from app.core.rate_limit import bucket_for, hit, ip_bucket_for
from app.core.redis import close_redis, redis_ok
from app.db.session import SessionLocal, engine
from app.services import delivery, platform_settings, request_logs
from app.services.media import media_root
from app.services.seed import seed

logger = logging.getLogger("app")
access_logger = logging.getLogger("app.access")

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

API_DESCRIPTION = """
**NFC detection → Card ID → Secure delivery.**

Developers create **applications**, get an **API key**, register Android phones as NFC readers,
and every card tap is forwarded to the developer's endpoint as an HMAC-signed webhook.

> A card UID is an *identifier*, not proof of identity. Every event carries
> `security.authenticated = false` and `security.level = "uid_only"`.

## Authentication
| Caller | Header |
|---|---|
| Dashboard | `Authorization: Bearer <jwt>` (from `POST /auth/login`) |
| Device registration | `Authorization: Bearer nfc_...` (API key) |
| Other `/device/*` calls | `Authorization: Bearer nfcd_...` (device token) |

## Errors
Every non-2xx response has the shape
`{"error": {"code": "invalid_credentials", "message": "...", "details": null}}`.
Validation errors use `code: "validation_error"` with `details = [{"field": "body.email", "message": "..."}]`.

## Rate limits
Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix seconds).
On `429` the code is `rate_limited` and a `Retry-After` header is set. Auth endpoints allow 10 requests/min per IP.

## Delivery modes
* **relay** (default) — phone → platform → your endpoint. Signed with the application's webhook secret, retried
  server-side (10s, 60s, 300s … up to `WEBHOOK_MAX_RETRIES`).
* **direct** — phone → your endpoint. Signed with a per-device secret:
  `device_signing_secret = hex(HMAC_SHA256(key=webhook_secret, msg="device:" + device_id))`.

## Verifying webhook signatures
Each delivery is a `POST` with JSON body and these headers:
`X-NFC-Event-Id`, `X-NFC-Timestamp` (unix seconds), `X-NFC-Nonce` (32 hex), `X-NFC-Device-Id`,
`X-NFC-Delivery-Mode` (`relay`|`direct`) and `X-NFC-Signature: v1=<hex>`.

1. Pick the key: **relay** → your webhook secret (the full `whsec_...` string, UTF-8).
   **direct** → `hex(HMAC_SHA256(webhook_secret, "device:" + X-NFC-Device-Id))` (the 64-char hex string, UTF-8).
2. Compute `hex(HMAC_SHA256(key, "{timestamp}.{nonce}." + raw_body_bytes))` over the **raw** request body.
3. Compare with the value after `v1=` in constant time.
4. Reject timestamps older than 5 minutes, reject reused nonces, and dedupe on `X-NFC-Event-Id`.

```python
import hashlib, hmac, time

def verify(secret: str, headers, raw_body: bytes) -> bool:
    ts, nonce = headers["X-NFC-Timestamp"], headers["X-NFC-Nonce"]
    if headers.get("X-NFC-Delivery-Mode") == "direct":
        secret = hmac.new(secret.encode(), f"device:{headers['X-NFC-Device-Id']}".encode(),
                          hashlib.sha256).hexdigest()
    if abs(time.time() - int(ts)) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.{nonce}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest("v1=" + expected, headers["X-NFC-Signature"])
```

Respond with any `2xx` to acknowledge. Anything else (or a timeout) counts as a failed attempt.
Redirects are not followed.
"""

OPENAPI_TAGS = [
    {"name": "Health", "description": "Liveness / dependency status."},
    {"name": "Auth", "description": "Dashboard accounts and JWTs."},
    {"name": "Account", "description": "Dashboard overview."},
    {"name": "Applications", "description": "Applications, endpoints and webhook secrets."},
    {"name": "API keys", "description": "Keys used by devices to register (stored hashed, shown once)."},
    {"name": "Devices", "description": "Manage registered NFC readers."},
    {"name": "Events & deliveries", "description": "Card events and webhook delivery attempts."},
    {"name": "Usage & billing", "description": "Plans, subscription and usage counters."},
    {"name": "Audit logs", "description": "Security-relevant actions on your account."},
    {"name": "Admin", "description": "Platform administration (role = admin)."},
    {"name": "Device API (mobile terminal)", "description": "Endpoints called by the nexTap Android app."},
]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("Starting %s v%s (environment=%s)", settings.APP_NAME, VERSION, settings.ENVIRONMENT)
    try:
        async with SessionLocal() as session:
            await seed(session)
    except Exception:
        logger.exception("Startup seeding failed (is the database migrated? run `alembic upgrade head`)")
        raise
    if not await redis_ok():
        logger.warning("Redis is unreachable: rate limiting fails open and retries are delayed until it returns")

    await platform_settings.ensure_fresh()
    media_root()
    from app.services import app_builds

    try:
        if moved := app_builds.migrate_legacy_artifacts():
            logger.info("Moved %d APK artifact(s) from MEDIA_ROOT to RELEASES_ROOT", moved)
    except OSError as exc:
        logger.warning("Could not move legacy APK artifacts: %s", exc)

    stop = asyncio.Event()
    tasks: list[asyncio.Task[None]] = [
        # Request logs are flushed by every API process (its in-process fallback buffer lives here).
        asyncio.create_task(request_logs.run_flusher(SessionLocal, stop), name="request-log-flusher"),
    ]
    if settings.DELIVERY_WORKER_ENABLED:
        tasks.append(asyncio.create_task(delivery.run_worker(SessionLocal, stop), name="delivery-worker"))
    try:
        yield
    finally:
        stop.set()
        for task in tasks:
            try:
                await asyncio.wait_for(task, timeout=10)
            except (TimeoutError, asyncio.TimeoutError):
                task.cancel()
        await delivery.close_http_client()
        await close_redis()
        await engine.dispose()


class MediaFiles(StaticFiles):
    """Public uploads. APK builds also live under MEDIA_ROOT (`releases/`) but are only served through
    `/downloads/android/*`, which enforces `is_published` and counts downloads."""

    PRIVATE_PREFIXES = ("releases/",)

    def lookup_path(self, path: str):  # type: ignore[no-untyped-def]
        if path.lstrip("/").startswith(self.PRIVATE_PREFIXES):
            return "", None
        return super().lookup_path(path)


def create_app() -> FastAPI:
    setup_logging(settings.LOG_LEVEL, settings.log_json, settings.API_KEY_PREFIX)
    app = FastAPI(
        title=f"{settings.APP_NAME} API",
        version=VERSION,
        description=API_DESCRIPTION,
        openapi_tags=OPENAPI_TAGS,
        servers=[{"url": settings.API_BASE_URL}],
        # Part 3 §6: no public Swagger/ReDoc/OpenAPI unless API_DOCS_ENABLED=true.
        docs_url="/docs" if settings.API_DOCS_ENABLED else None,
        redoc_url="/redoc" if settings.API_DOCS_ENABLED else None,
        openapi_url="/openapi.json" if settings.API_DOCS_ENABLED else None,
        lifespan=lifespan,
        debug=settings.DEBUG,
    )
    register_exception_handlers(app)
    app.include_router(api_router)
    app.include_router(root_router)
    app.mount("/media", MediaFiles(directory=str(media_root()), check_dir=False), name="media")

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        request.state.request_id = request_id
        started = time.perf_counter()
        log_it = request_logs.should_log(request)
        try:
            try:
                response = await _guarded(request, call_next)
            except Exception:
                if log_it:  # unhandled → 500 (rendered by the outer error middleware)
                    request.state.error_code = "internal_error"
                    request_logs.schedule(request_logs.build_entry(
                        request, 500, int((time.perf_counter() - started) * 1000), request_id))
                raise
            response.headers["X-Request-ID"] = request_id
            _security_headers(request, response)
            latency = int((time.perf_counter() - started) * 1000)
            access_logger.info(
                "%s %s -> %d (%.1f ms)", request.method, request.url.path, response.status_code,
                (time.perf_counter() - started) * 1000,
            )
            if log_it:
                request_logs.schedule(request_logs.build_entry(request, response.status_code, latency, request_id))
            return response
        finally:
            request_id_ctx.reset(token)

    # CORS outermost so that errors (incl. 429) carry CORS headers. Origins: env ∪ DB (admin-managed).
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID", "X-Client-Id"],
        expose_headers=[
            "X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After",
        ],
        max_age=600,
    )
    return app


async def _guarded(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    # HTTPS enforcement (behind a TLS-terminating proxy set TRUST_PROXY_HEADERS=true).
    if settings.enforce_https and not request.url.path.startswith("/api/v1/health"):
        scheme = request.url.scheme
        if settings.TRUST_PROXY_HEADERS:
            scheme = request.headers.get("x-forwarded-proto", scheme).split(",")[0].strip().lower()
        if scheme != "https":
            return error_response(403, "https_required", "HTTPS is required", request=request)

    rl_headers: dict[str, str] = {}
    await platform_settings.ensure_fresh()
    # /.well-known/* (apple-app-site-association) is fetched by Apple's CDN from a few shared IPs: never throttled.
    if settings.RATE_LIMIT_ENABLED and not request.url.path.startswith("/.well-known/"):
        ip_bucket = ip_bucket_for(request)
        if ip_bucket is not None:  # everyone also shares a per-IP ceiling (unverified tokens can't dodge it)
            ip_result = await hit(*ip_bucket)
            if ip_result is not None and not ip_result.allowed:
                return error_response(
                    429, "rate_limited", "Too many requests, slow down", {"retry_after": ip_result.retry_after},
                    headers={"Retry-After": str(ip_result.retry_after)}, request=request,
                )
        bucket = bucket_for(request)
        if bucket is not None:
            result = await hit(*bucket)
            if result is not None:
                rl_headers = {
                    "X-RateLimit-Limit": str(result.limit),
                    "X-RateLimit-Remaining": str(result.remaining),
                    "X-RateLimit-Reset": str(result.reset_at),
                }
                if not result.allowed:
                    return error_response(
                        429, "rate_limited", "Too many requests, slow down",
                        {"retry_after": result.retry_after},
                        headers={**rl_headers, "Retry-After": str(result.retry_after)},
                        request=request,
                    )
    response = await call_next(request)
    for k, v in rl_headers.items():
        response.headers[k] = v
    return response


def _security_headers(request: Request, response: Response) -> None:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    if settings.enforce_https:
        response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")


app = create_app()
