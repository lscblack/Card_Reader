"""Redis sliding-window rate limiting (sorted set per bucket). Fails open."""

from __future__ import annotations

import hashlib
import logging
import math
import re
import secrets
import time
from dataclasses import dataclass

import jwt
from starlette.requests import Request

from app.core.config import settings
from app.core.redis import get_redis
from app.core.security import decode_access_token

logger = logging.getLogger("app.rate_limit")

AUTH_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v1/auth/verify-email",
    "/api/v1/auth/resend-verification",
}
_INVITE_ACCEPT_RE = re.compile(r"^/api/v1/invitations/[^/]+/accept$")


def is_credential_endpoint(method: str, path: str) -> bool:
    """Only credential-handling POSTs get the strict per-IP bucket; /auth/me etc. use the per-user bucket."""
    return method == "POST" and (path in AUTH_PATHS or bool(_INVITE_ACCEPT_RE.match(path)))
EXEMPT_PREFIXES = ("/api/v1/health", "/docs", "/redoc", "/openapi.json", "/media/")
PUBLIC_PREFIXES = (
    "/api/v1/public/", "/api/v1/errors", "/api/v1/meta", "/api/v1/actions/types", "/api/v1/billing/plans",
    "/api/v1/invitations/", "/api/v1/billing/promotions/active",
)

_last_warning = 0.0


@dataclass
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_at: int  # unix seconds
    retry_after: int


def client_ip(request: Request) -> str:
    if settings.TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    return request.client.host if request.client else "unknown"


def _default_limit() -> tuple[int, int]:
    from app.services.platform_settings import rate_limit_override

    return rate_limit_override() or (settings.RATE_LIMIT_REQUESTS, settings.RATE_LIMIT_WINDOW_SECONDS)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:32]


def bucket_for(request: Request) -> tuple[str, int, int] | None:
    """Returns (bucket key, limit, window) or None when exempt."""
    path = request.url.path
    if request.method == "OPTIONS" or path.startswith(EXEMPT_PREFIXES):
        return None
    ip = client_ip(request)
    limit, window = _default_limit()
    if path.startswith(("/t/", "/downloads/")):
        return f"public:ip:{ip}", limit, window
    if path.startswith("/sandbox/"):
        token = path.split("/", 3)[2] if path.count("/") >= 2 else ""
        return f"sandbox:{token[:32]}", limit, window
    if not path.startswith("/api/"):
        return None
    if is_credential_endpoint(request.method, path):
        return (
            f"auth:ip:{ip}",
            settings.AUTH_RATE_LIMIT_REQUESTS,
            settings.AUTH_RATE_LIMIT_WINDOW_SECONDS,
        )
    auth = request.headers.get("authorization", "")
    if path.startswith(PUBLIC_PREFIXES) and request.method == "GET":
        return f"public:ip:{ip}", limit, window
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token.startswith(settings.API_KEY_PREFIX) and not token.startswith("nfcd_"):
            return f"apikey:{_hash(token)}", limit, window
        if token.startswith("nfcd_"):
            return f"device:{_hash(token)}", limit, window
        try:
            sub = decode_access_token(token)["sub"]
            return f"user:{sub}", limit, window
        except jwt.PyJWTError:
            pass
    return f"ip:{ip}", limit, window


async def hit(bucket: str, limit: int, window: int) -> RateLimitResult | None:
    """Record one request. Returns None when Redis is unavailable (fail open)."""
    global _last_warning
    key = f"nfc:rl:{bucket}"
    now_ms = int(time.time() * 1000)
    window_ms = window * 1000
    member = f"{now_ms}-{secrets.token_hex(4)}"
    try:
        redis = get_redis()
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, 0, now_ms - window_ms)
            pipe.zcard(key)
            pipe.zadd(key, {member: now_ms})
            pipe.pexpire(key, window_ms)
            pipe.zrange(key, 0, 0, withscores=True)
            _, count_before, _, _, oldest = await pipe.execute()
        allowed = count_before < limit
        if not allowed:
            # Rejected requests don't consume a slot.
            await redis.zrem(key, member)
        oldest_ms = int(oldest[0][1]) if oldest else now_ms
        reset_at = math.ceil((oldest_ms + window_ms) / 1000)
        used = count_before + (1 if allowed else 0)
        return RateLimitResult(
            allowed=allowed,
            limit=limit,
            remaining=max(0, limit - used),
            reset_at=reset_at,
            retry_after=max(1, reset_at - int(now_ms / 1000)),
        )
    except Exception as exc:
        now = time.monotonic()
        if now - _last_warning > 30:
            _last_warning = now
            logger.warning("Rate limiter unavailable, failing open: %s", exc.__class__.__name__)
        return None
