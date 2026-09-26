"""Small shared validators."""

from __future__ import annotations

from app.core.errors import validation_error
from app.schemas.resources import HEADER_NAME_RE

# Sandbox receivers answer on the API origin: their simulated headers must not be able to set cookies, change the
# content type (→ HTML/script served from our origin), redirect visitors or weaken the security/CORS headers.
FORBIDDEN_SANDBOX_HEADERS = frozenset({
    "content-type", "content-length", "transfer-encoding", "connection", "set-cookie", "set-cookie2", "location",
    "refresh", "content-security-policy", "content-security-policy-report-only", "x-frame-options",
    "x-content-type-options", "strict-transport-security", "referrer-policy", "content-disposition",
    "clear-site-data", "link",
})


def forbidden_sandbox_header(name: str) -> bool:
    lower = name.lower()
    return lower in FORBIDDEN_SANDBOX_HEADERS or lower.startswith(("access-control-", "cross-origin-"))


def validate_response_headers(headers: dict[str, str] | None) -> dict[str, str]:
    headers = headers or {}
    if len(headers) > 20:
        raise validation_error("body.response_headers", "at most 20 headers")
    for name, value in headers.items():
        if not HEADER_NAME_RE.match(name) or not isinstance(value, str) or len(value) > 1024 \
                or "\r" in value or "\n" in value:
            raise validation_error("body.response_headers", f"invalid header {name!r}")
        if forbidden_sandbox_header(name):
            raise validation_error("body.response_headers", f"header {name!r} cannot be simulated")
    return dict(headers)
