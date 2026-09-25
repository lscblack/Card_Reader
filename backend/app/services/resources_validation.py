"""Small shared validators."""

from __future__ import annotations

from app.core.errors import validation_error
from app.schemas.resources import HEADER_NAME_RE


def validate_response_headers(headers: dict[str, str] | None) -> dict[str, str]:
    headers = headers or {}
    if len(headers) > 20:
        raise validation_error("body.response_headers", "at most 20 headers")
    for name, value in headers.items():
        if not HEADER_NAME_RE.match(name) or not isinstance(value, str) or len(value) > 1024 \
                or "\r" in value or "\n" in value:
            raise validation_error("body.response_headers", f"invalid header {name!r}")
    return dict(headers)
