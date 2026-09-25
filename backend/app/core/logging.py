"""Structured logging with secret redaction and request-id correlation."""

from __future__ import annotations

import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)

REDACTED = "[REDACTED]"

_SENSITIVE_KEYS = re.compile(
    r"(authorization|password|passwd|secret|token|api[_-]?key|cookie|signature)",
    re.IGNORECASE,
)


def _build_patterns(api_key_prefix: str = "nfc_") -> list[tuple[re.Pattern[str], str]]:
    prefixes = {re.escape(api_key_prefix), "nfc_", "nfcd_", "nfcp_", "whsec_"}
    token_alt = "|".join(sorted(prefixes, key=len, reverse=True))
    return [
        # Authorization / Bearer values
        (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+"), r"\1" + REDACTED),
        (re.compile(r"(?i)(authorization['\"]?\s*[:=]\s*['\"]?)[^'\",\s}]+(\s+[^'\",\s}]+)?"),
         r"\1" + REDACTED),
        # Platform credentials (API keys, device tokens, webhook secrets)
        (re.compile(rf"(?:{token_alt})[A-Za-z0-9_-]{{16,}}"), REDACTED),
        # password=..., "password": "...", new_password etc.
        (re.compile(r"(?i)([\"']?\w*password\w*[\"']?\s*[:=]\s*)([\"'])(?:\\.|(?!\2).)*\2"),
         r"\1\2" + REDACTED + r"\2"),
        (re.compile(r"(?i)(\w*password\w*=)[^&\s,;]+"), r"\1" + REDACTED),
        # URL credentials: scheme://user:pass@host
        (re.compile(r"(://[^:/\s@]+:)[^@\s/]+@"), r"\1" + REDACTED + "@"),
        # 64-hex signatures / derived secrets following a v1= marker
        (re.compile(r"(v1=)[0-9a-fA-F]{16,}"), r"\1" + REDACTED),
    ]


_PATTERNS = _build_patterns()


def configure_redaction_prefix(api_key_prefix: str) -> None:
    global _PATTERNS
    _PATTERNS = _build_patterns(api_key_prefix)


def redact(text: str) -> str:
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text


def redact_value(value: Any, key: str | None = None) -> Any:
    if key is not None and _SENSITIVE_KEYS.search(key):
        return REDACTED
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {k: redact_value(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return type(value)(redact_value(v) for v in value)
    return value


_STD_ATTRS = set(
    logging.LogRecord("x", 0, "x", 0, "x", None, None).__dict__.keys()
) | {"message", "asctime", "request_id"}


class RedactionFilter(logging.Filter):
    """Scrubs secrets from the message, args and `extra` fields of every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - malformed record
            message = str(record.msg)
        record.msg = redact(message)
        record.args = None
        for key in list(record.__dict__.keys()):
            if key not in _STD_ATTRS:
                record.__dict__[key] = redact_value(record.__dict__[key], key)
        if record.exc_info and not record.exc_text:
            record.exc_text = redact(logging.Formatter().formatException(record.exc_info))
        elif record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get() or "-"
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat().replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for key, value in record.__dict__.items():
            if key not in _STD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_text:
            payload["exc"] = record.exc_text
        elif record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__(
            "%(asctime)s %(levelname)-7s [%(request_id)s] %(name)s: %(message)s"
        )


def setup_logging(level: str = "INFO", json_output: bool = False, api_key_prefix: str = "nfc_") -> None:
    configure_redaction_prefix(api_key_prefix)
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RequestIdFilter())
    handler.addFilter(RedactionFilter())
    handler.setFormatter(JsonFormatter() if json_output else TextFormatter())

    root = logging.getLogger()
    for h in list(root.handlers):
        if getattr(h, "_nfc_handler", False):
            root.removeHandler(h)
    handler._nfc_handler = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Route uvicorn logs through our handler (redaction applies to them too).
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
    # Our own access log (app.access) carries the request id; silence the duplicate.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    # httpx logs full URLs at INFO; keep them quiet.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
