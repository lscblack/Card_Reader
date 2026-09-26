"""Minimal webhook receiver that verifies nexTap signatures (relay + direct modes).

    pip install fastapi uvicorn
    NFC_WEBHOOK_SECRET=whsec_... uvicorn receiver_fastapi:app --port 9000

Point your application's endpoint at http://<host>:9000/api/nfc/card
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time

from fastapi import FastAPI, HTTPException, Request

WEBHOOK_SECRET = os.environ.get("NFC_WEBHOOK_SECRET", "")
TOLERANCE_SECONDS = 300

app = FastAPI()
_seen_nonces: dict[str, float] = {}  # use Redis (SET NX EX 300) in production
_seen_events: set[str] = set()  # use your database in production


def device_signing_secret(webhook_secret: str, device_id: str) -> str:
    """Direct mode: hex(HMAC_SHA256(key=webhook_secret, msg="device:" + device_id))."""
    return hmac.new(webhook_secret.encode(), f"device:{device_id}".encode(), hashlib.sha256).hexdigest()


def verify_signature(webhook_secret: str, headers: dict[str, str], raw_body: bytes, now: float | None = None) -> bool:
    """Returns True when the X-NFC-Signature header is valid and fresh.

    `headers` must be case-insensitive or use the canonical X-NFC-* names.
    """
    try:
        timestamp = headers["X-NFC-Timestamp"]
        nonce = headers["X-NFC-Nonce"]
        signature = headers["X-NFC-Signature"]
        mode = headers.get("X-NFC-Delivery-Mode", "relay")
    except KeyError:
        return False
    now = time.time() if now is None else now
    try:
        if abs(now - int(timestamp)) > TOLERANCE_SECONDS:
            return False
    except ValueError:
        return False
    key = webhook_secret
    if mode == "direct":
        key = device_signing_secret(webhook_secret, headers.get("X-NFC-Device-Id", ""))
    expected = hmac.new(key.encode(), f"{timestamp}.{nonce}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"v1={expected}", signature)


@app.post("/api/nfc/card")
async def receive(request: Request) -> dict[str, object]:
    raw = await request.body()  # verify the RAW bytes, before JSON parsing
    headers = {k: v for k, v in request.headers.items()}
    canonical = {
        "X-NFC-Timestamp": headers.get("x-nfc-timestamp", ""),
        "X-NFC-Nonce": headers.get("x-nfc-nonce", ""),
        "X-NFC-Signature": headers.get("x-nfc-signature", ""),
        "X-NFC-Delivery-Mode": headers.get("x-nfc-delivery-mode", "relay"),
        "X-NFC-Device-Id": headers.get("x-nfc-device-id", ""),
    }
    if not verify_signature(WEBHOOK_SECRET, canonical, raw):
        raise HTTPException(401, "invalid signature")

    now = time.time()
    for n, ts in list(_seen_nonces.items()):
        if now - ts > TOLERANCE_SECONDS:
            del _seen_nonces[n]
    nonce = canonical["X-NFC-Nonce"]
    if nonce in _seen_nonces:
        raise HTTPException(409, "replayed nonce")
    _seen_nonces[nonce] = now

    event_id = headers.get("x-nfc-event-id", "")
    if event_id in _seen_events:
        return {"ok": True, "duplicate": True}  # 2xx so the platform stops retrying
    _seen_events.add(event_id)

    payload = await request.json()
    # A UID is an identifier, not proof of identity (security.authenticated is false).
    print(f"card {payload['card_id']} on device {payload['device_id']} (test={payload['test']})")
    return {"ok": True}
