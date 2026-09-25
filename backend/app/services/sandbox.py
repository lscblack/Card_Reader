"""Sandbox receiver (Part 2 §A4): capture requests, verify signatures, simulate responses."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import get_redis
from app.core.security import decrypt_secret, derive_device_signing_secret, random_urlsafe
from app.models import Application, Device, SandboxEndpoint, SandboxRequest

MAX_BODY_BYTES = 64 * 1024
KEEP_REQUESTS = 500
TOKEN_LENGTH = 24
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
CARD_RE = re.compile(r"^[0-9A-F]{4,64}$")
PAYLOAD_KEYS = ("event_id", "event", "card_id", "card", "security", "device_id", "application_id",
                "delivery_mode", "test", "timestamp")
NIL = "00000000-0000-0000-0000-000000000000"


def sandbox_url(token: str) -> str:
    return f"{settings.public_api_url}/sandbox/{token}"


def new_endpoint(owner_id: uuid.UUID, name: str, business_id: uuid.UUID | None = None,
                 application_id: uuid.UUID | None = None) -> SandboxEndpoint:
    return SandboxEndpoint(
        owner_id=owner_id, business_id=business_id, application_id=application_id, name=name,
        token=random_urlsafe(TOKEN_LENGTH), response_status=200, response_delay_ms=0,
        response_body='{"ok":true}', response_headers={}, request_count=0,
    )


def mask_headers(headers: dict[str, str]) -> dict[str, str]:
    out = {}
    for k, v in headers.items():
        if k.lower() in ("authorization", "proxy-authorization", "cookie"):
            out[k] = (v.split(" ", 1)[0] + " ****") if " " in v else "****"
        else:
            out[k] = v
    return out


def _check(name: str, passed: bool | None, detail: str) -> dict[str, Any]:
    return {"name": name, "passed": passed, "detail": detail}


async def analyse(
    session: AsyncSession, endpoint: SandboxEndpoint, headers: dict[str, str], raw: bytes,
    body_json: Any,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    h = {k.lower(): v for k, v in headers.items()}
    sig = h.get("x-nfc-signature")
    mode = h.get("x-nfc-delivery-mode") if h.get("x-nfc-delivery-mode") in ("relay", "direct") else None
    ts, nonce = h.get("x-nfc-timestamp"), h.get("x-nfc-nonce")
    checks: list[dict[str, Any]] = []

    # ── signature ──
    app = await session.get(Application, endpoint.application_id) if endpoint.application_id else None
    if not sig:
        signature = {"status": "missing", "mode": mode, "reason": "X-NFC-Signature header not present",
                     "error_ref": None}
    elif app is None or app.deleted_at is not None or not app.webhook_secret_encrypted:
        signature = {"status": "unverifiable", "mode": mode,
                     "reason": "Link this sandbox endpoint to an application to verify signatures",
                     "error_ref": "NFC-8001"}
    elif not ts or not nonce:
        signature = {"status": "invalid", "mode": mode, "reason": "X-NFC-Timestamp or X-NFC-Nonce missing",
                     "error_ref": "NFC-5005"}
    else:
        secret = decrypt_secret(app.webhook_secret_encrypted)
        key = secret
        if (mode or "relay") == "direct":
            key = derive_device_signing_secret(secret, h.get("x-nfc-device-id", ""))
        expected = "v1=" + hmac.new(key.encode(), f"{ts}.{nonce}.".encode() + raw, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, sig):
            signature = {"status": "valid", "mode": mode or "relay", "reason": None, "error_ref": None}
        else:
            reason = ("Signature mismatch: sign '{timestamp}.{nonce}.' + raw body with "
                      + ("the device signing secret" if mode == "direct" else "the application's webhook secret"))
            signature = {"status": "invalid", "mode": mode or "relay", "reason": reason, "error_ref": "NFC-5005"}

    # ── checks ──
    if ts and ts.isdigit():
        skew = abs(time.time() - int(ts))
        checks.append(_check("timestamp_skew", skew <= 300, f"{int(skew)}s from server time (max 300s)"))
    else:
        checks.append(_check("timestamp_skew", False, "X-NFC-Timestamp missing or not unix seconds"))
    if nonce:
        try:
            fresh = await get_redis().set(f"nfc:sbx:nonce:{endpoint.id}:{nonce}", "1", nx=True, ex=600)
            checks.append(_check("nonce_unused", bool(fresh), "first use" if fresh else "nonce was already used (replay)"))
        except Exception:
            checks.append(_check("nonce_unused", None, "could not check (Redis unavailable)"))
    else:
        checks.append(_check("nonce_unused", False, "X-NFC-Nonce missing"))
    event_id = h.get("x-nfc-event-id") or (body_json.get("event_id") if isinstance(body_json, dict) else None)
    body_event = body_json.get("event_id") if isinstance(body_json, dict) else None
    ok_event = bool(event_id and UUID_RE.match(str(event_id)) and (body_event in (None, event_id)))
    checks.append(_check("event_id_format", ok_event,
                         "UUID and matches X-NFC-Event-Id" if ok_event else "event_id missing/not a UUID/mismatch"))
    if isinstance(body_json, dict):
        missing = [k for k in PAYLOAD_KEYS if k not in body_json]
        checks.append(_check("payload_schema", not missing, "all fields present" if not missing
                             else "missing: " + ", ".join(missing)))
        security = body_json.get("security") or {}
        checks.append(_check("uid_not_authenticated", security.get("authenticated") is False,
                             "security.authenticated is false (a UID is not proof of identity)"))
    else:
        checks.append(_check("payload_schema", False, "body is not a JSON object"))
    device_id = h.get("x-nfc-device-id") or (body_json.get("device_id") if isinstance(body_json, dict) else None)
    if device_id and device_id != NIL and UUID_RE.match(str(device_id)):
        dev = await session.get(Device, uuid.UUID(str(device_id)))
        known = dev is not None and (app is None or dev.application_id == app.id)
        checks.append(_check("device_known", known, "device registered to the linked application" if known
                             else "unknown device (or registered to another application)"))
    elif device_id == NIL:
        checks.append(_check("device_known", True, "test delivery (no device)"))
    else:
        checks.append(_check("device_known", False, "X-NFC-Device-Id missing"))
    if isinstance(body_json, dict) and "card_id" in body_json:
        card_id = str(body_json.get("card_id"))
        ok = bool(CARD_RE.match(card_id)) or (body_json.get("test") is True and card_id == "TEST0000")
        checks.append(_check("card_id_format", ok, "uppercase hex UID" if ok else "card_id is not uppercase hex"))
    ctype = h.get("content-type", "")
    checks.append(_check("content_type", ctype.startswith("application/json"), ctype or "missing"))
    return signature, checks


async def store(
    session: AsyncSession, endpoint: SandboxEndpoint, *, method: str, path: str, query: str | None,
    headers: dict[str, str], raw: bytes | None, size: int, ip_hash: str | None, response_status: int,
    too_large: bool,
) -> SandboxRequest:
    text, body_json = None, None
    if raw is not None:
        text = raw.decode("utf-8", errors="replace")
        try:
            body_json = json.loads(text) if text.strip() else None
        except ValueError:
            body_json = None
    if too_large:
        signature = {"status": "unverifiable", "mode": None, "reason": "body larger than 64 KB",
                     "error_ref": "NFC-2005"}
        checks = [_check("body_size", False, f"{size} bytes > {MAX_BODY_BYTES}")]
    else:
        signature, checks = await analyse(session, endpoint, headers, raw or b"", body_json)
    req = SandboxRequest(
        endpoint_id=endpoint.id,
        received_at=datetime.now(UTC),
        method=method,
        path=path[:500],
        query=(query or None) and query[:2048],
        headers=mask_headers(headers),
        body=text,
        body_json=body_json if isinstance(body_json, (dict, list)) else None,
        size_bytes=size,
        source_ip_hash=ip_hash,
        signature=signature,
        checks=checks,
        response_status=response_status,
        response_delay_ms=0 if too_large else endpoint.response_delay_ms,
        event_id=headers.get("x-nfc-event-id") or (body_json.get("event_id") if isinstance(body_json, dict) else None),
        device_id=headers.get("x-nfc-device-id") or (body_json.get("device_id") if isinstance(body_json, dict) else None),
    )
    if req.event_id is not None:
        req.event_id = str(req.event_id)[:64]
    if req.device_id is not None:
        req.device_id = str(req.device_id)[:64]
    session.add(req)
    endpoint.request_count = (endpoint.request_count or 0) + 1
    endpoint.last_request_at = req.received_at
    await session.flush()
    # keep the newest KEEP_REQUESTS
    old_ids = select(SandboxRequest.id).where(SandboxRequest.endpoint_id == endpoint.id).order_by(
        SandboxRequest.received_at.desc(), SandboxRequest.id.desc()).offset(KEEP_REQUESTS)
    await session.execute(delete(SandboxRequest).where(SandboxRequest.id.in_(old_ids)))
    return req


def token_ok(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{8,32}", token or ""))

