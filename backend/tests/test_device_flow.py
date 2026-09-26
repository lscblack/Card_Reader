from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import respx
from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import derive_device_signing_secret
from app.db.session import SessionLocal
from app.models import Delivery, NfcEvent
from app.services import delivery as delivery_service
from examples.receiver_fastapi import verify_signature
from tests.conftest import bearer, create_app, register_device

HOOK = "https://receiver.example.com/api/nfc/card"


def _event(**overrides: Any) -> dict[str, Any]:
    body = {
        "event_id": str(uuid.uuid4()),
        "card_id": "04:a1:b2:c3:d4:e5",
        "card_technologies": ["android.nfc.tech.NfcA", "MifareUltralight"],
        "card_type": "MIFARE_ULTRALIGHT",
        "detected_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "direct_delivery": None,
    }
    body.update(overrides)
    return body


async def _setup(client: AsyncClient, user: dict, mode: str = "relay") -> dict[str, Any]:
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    r = await client.put(f"/api/v1/applications/{app_id}/endpoint",
                         json={"url": HOOK, "enabled": True, "timeout_seconds": 5,
                               "custom_headers": {"X-Tenant": "acme"}, "delivery_mode": mode},
                         headers=user["headers"])
    assert r.status_code == 200
    dev = await register_device(client, created["api_key_plaintext"])
    return {
        "app_id": app_id,
        "secret": created["webhook_secret_plaintext"],
        "api_key": created["api_key_plaintext"],
        "token": dev["device_token"],
        "device": dev["device"],
        "config": dev["config"],
    }


async def test_register_returns_token_and_config(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user)
    assert ctx["token"].startswith("nfcd_") and len(ctx["token"]) == 5 + 48
    cfg = ctx["config"]
    assert cfg["device_id"] == ctx["device"]["id"]
    assert cfg["application"] == {"id": ctx["app_id"], "name": "Front desk"}
    assert cfg["delivery_mode"] == "relay" and cfg["endpoint_url"] == HOOK and cfg["endpoint_enabled"] is True
    assert cfg["timeout_seconds"] == 5 and cfg["max_retries"] == 3
    assert cfg["signing_secret"] is None and cfg["custom_headers"] == {}  # relay: server-side only
    assert ctx["device"]["status"] == "active" and ctx["device"]["application_name"] == "Front desk"

    r = await client.post("/api/v1/device/heartbeat", headers=bearer(ctx["token"]))
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["server_time"].endswith("Z")


async def test_relay_event_delivered_with_valid_signature(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user)
    received: list[httpx.Request] = []

    def receiver(request: httpx.Request) -> httpx.Response:
        received.append(request)
        headers = {k: request.headers[k] for k in
                   ("X-NFC-Timestamp", "X-NFC-Nonce", "X-NFC-Signature", "X-NFC-Delivery-Mode", "X-NFC-Device-Id")}
        ok = verify_signature(ctx["secret"], headers, request.content)
        return httpx.Response(200 if ok else 401, text="ok" if ok else "bad signature")

    body = _event()
    with respx.mock(assert_all_called=True) as mock:
        mock.post(HOOK).mock(side_effect=receiver)
        r = await client.post("/api/v1/device/events", json=body,
                              headers={**bearer(ctx["token"]), "Idempotency-Key": body["event_id"]})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["event_id"] == body["event_id"] and res["status"] == "delivered"
    assert res["status_code"] == 200 and res["error"] is None and res["latency_ms"] is not None

    req = received[0]
    assert req.headers["User-Agent"] == "nexTap-Webhook/1.0"
    assert req.headers["X-NFC-Event-Id"] == body["event_id"]
    assert req.headers["X-NFC-Delivery-Mode"] == "relay"
    assert req.headers["X-NFC-Device-Id"] == ctx["device"]["id"]
    assert len(req.headers["X-NFC-Nonce"]) == 32
    assert abs(int(req.headers["X-NFC-Timestamp"]) - time.time()) < 10
    assert req.headers["X-Tenant"] == "acme"
    # Manual recomputation of the contract formula
    msg = f"{req.headers['X-NFC-Timestamp']}.{req.headers['X-NFC-Nonce']}.".encode() + req.content
    assert req.headers["X-NFC-Signature"] == "v1=" + hmac.new(ctx["secret"].encode(), msg, hashlib.sha256).hexdigest()

    payload = json.loads(req.content)
    assert payload == {
        "event_id": body["event_id"],
        "event": "card.detected",
        "card_id": "04A1B2C3D4E5",
        "card": {"uid": "04A1B2C3D4E5", "uid_length": 6, "technologies": ["NfcA", "MifareUltralight"],
                 "type": "mifare_ultralight"},
        "security": {"authenticated": False, "level": "uid_only"},
        "device_id": ctx["device"]["id"],
        "application_id": ctx["app_id"],
        "delivery_mode": "relay",
        "test": False,
        "timestamp": body["detected_at"],
    }

    # Idempotent repeat: no second HTTP call, same state
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(HOOK).mock(return_value=httpx.Response(200))
        r2 = await client.post("/api/v1/device/events", json=body, headers=bearer(ctx["token"]))
        assert not route.called
    assert r2.status_code == 200 and r2.json()["status"] == "delivered"

    # Dashboard views
    r = await client.get(f"/api/v1/events/{body['event_id']}", headers=user["headers"])
    ev = r.json()
    assert ev["status"] == "delivered" and ev["attempts"] == 1 and ev["authenticated"] is False
    assert ev["card_id"] == "04A1B2C3D4E5" and ev["device_name"] == "Front desk Pixel"
    assert len(ev["deliveries"]) == 1 and ev["deliveries"][0]["success"] is True
    assert ev["deliveries"][0]["response_excerpt"] == "ok"

    r = await client.get("/api/v1/events?card_id=04:A1:B2:C3:D4:E5", headers=user["headers"])
    assert r.json()["total"] == 1
    r = await client.get("/api/v1/devices", headers=user["headers"])
    assert r.json()[0]["events_count"] == 1

    r = await client.get("/api/v1/overview", headers=user["headers"])
    ov = r.json()
    assert ov["applications"] == 1 and ov["active_devices"] == 1 and ov["active_api_keys"] == 1
    assert ov["events_today"] == 1 and ov["events_this_month"] == 1 and ov["delivery_success_rate"] == 1.0
    assert len(ov["recent_events"]) == 1

    r = await client.get("/api/v1/usage?days=7", headers=user["headers"])
    us = r.json()
    assert us["totals"]["events"] == 1 and us["totals"]["delivered"] == 1 and us["totals"]["failed"] == 0
    assert len(us["daily"]) == 7 and us["daily"][-1]["events"] == 1
    assert us["limits"] == {"events_per_month": 10000, "applications": 3, "devices": 5}


async def test_relay_failure_retries_then_fails(client: AsyncClient, user: dict, redis) -> None:
    ctx = await _setup(client, user)
    body = _event()
    with respx.mock() as mock:
        route = mock.post(HOOK).mock(return_value=httpx.Response(503, text="x" * 2000))
        r = await client.post("/api/v1/device/events", json=body, headers=bearer(ctx["token"]))
        res = r.json()
        assert res["status"] == "retrying" and res["status_code"] == 503 and res["error"] == "HTTP 503"

        # Queued ~10s in the future
        score = await redis.zscore(delivery_service.QUEUE_KEY, body["event_id"])
        assert 8 <= score - time.time() <= 11
        assert await delivery_service.process_due(SessionLocal) == 0  # not due yet

        # Attempts 2, 3, 4 (WEBHOOK_MAX_RETRIES=3) with backoff 10s, 60s, 300s
        expected_delays = [60, 300]
        for i in range(3):
            processed = await delivery_service.process_due(SessionLocal, now=time.time() + 400)
            assert processed == 1
            if i < 2:
                score = await redis.zscore(delivery_service.QUEUE_KEY, body["event_id"])
                assert abs((score - time.time()) - expected_delays[i]) < 3
        assert route.call_count == 4
        assert await delivery_service.process_due(SessionLocal, now=time.time() + 4000) == 0

    async with SessionLocal() as s:
        event = await s.get(NfcEvent, uuid.UUID(body["event_id"]))
        assert event.status == "failed" and event.attempts == 4 and event.next_attempt_at is None
        deliveries = (await s.execute(select(Delivery).order_by(Delivery.attempt))).scalars().all()
        assert [d.attempt for d in deliveries] == [1, 2, 3, 4]
        assert all(len(d.response_excerpt or "") <= 500 for d in deliveries)

    # Redeliver succeeds → delivered, usage counters move from failed to delivered
    with respx.mock() as mock:
        mock.post(HOOK).mock(return_value=httpx.Response(204))
        r = await client.post(f"/api/v1/events/{body['event_id']}/redeliver", headers=user["headers"])
    assert r.status_code == 200 and r.json()["success"] is True and r.json()["attempt"] == 5
    r = await client.get("/api/v1/usage", headers=user["headers"])
    assert r.json()["totals"] == {"events": 1, "delivered": 1, "failed": 0, "applications": 1, "devices": 1}
    r = await client.get("/api/v1/deliveries?success=false", headers=user["headers"])
    assert r.json()["total"] == 4


async def test_retry_then_success(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user)
    body = _event()
    with respx.mock() as mock:
        mock.post(HOOK).mock(side_effect=[httpx.ConnectError("refused"), httpx.Response(200)])
        r = await client.post("/api/v1/device/events", json=body, headers=bearer(ctx["token"]))
        assert r.json()["status"] == "retrying" and r.json()["error"].startswith("connection_error")
        assert await delivery_service.process_due(SessionLocal, now=time.time() + 11) == 1
    r = await client.get(f"/api/v1/events/{body['event_id']}", headers=user["headers"])
    assert r.json()["status"] == "delivered" and r.json()["attempts"] == 2


async def test_redirects_are_not_followed(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user)
    with respx.mock() as mock:
        mock.post(HOOK).mock(return_value=httpx.Response(302, headers={"Location": "http://169.254.169.254/"}))
        r = await client.post("/api/v1/device/events", json=_event(), headers=bearer(ctx["token"]))
    assert r.json()["status"] == "retrying" and "redirect" in r.json()["error"]


async def test_endpoint_test_delivery(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user)
    seen: list[dict] = []

    def receiver(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        headers = {k: request.headers[k] for k in
                   ("X-NFC-Timestamp", "X-NFC-Nonce", "X-NFC-Signature", "X-NFC-Delivery-Mode", "X-NFC-Device-Id")}
        return httpx.Response(200 if verify_signature(ctx["secret"], headers, request.content) else 401, text="pong")

    with respx.mock() as mock:
        mock.post(HOOK).mock(side_effect=receiver)
        r = await client.post(f"/api/v1/applications/{ctx['app_id']}/endpoint/test", headers=user["headers"])
    res = r.json()
    assert res["success"] is True and res["status_code"] == 200 and res["response_excerpt"] == "pong"
    assert seen[0]["event"] == "endpoint.test" and seen[0]["test"] is True and seen[0]["card_id"] == "TEST0000"
    r = await client.get(f"/api/v1/applications/{ctx['app_id']}", headers=user["headers"])
    assert r.json()["endpoint"]["last_test_success"] is True and r.json()["endpoint"]["last_tested_at"]


async def test_endpoint_not_configured_marks_failed(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    dev = await register_device(client, created["api_key_plaintext"])
    r = await client.post("/api/v1/device/events", json=_event(), headers=bearer(dev["device_token"]))
    assert r.status_code == 200 and r.json()["status"] == "failed" and r.json()["error"] == "endpoint_not_configured"


async def test_direct_mode_signing_secret_and_reporting(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user, mode="direct")
    cfg = ctx["config"]
    expected = hmac.new(ctx["secret"].encode(), f"device:{ctx['device']['id']}".encode(), hashlib.sha256).hexdigest()
    assert cfg["delivery_mode"] == "direct" and cfg["signing_secret"] == expected and len(expected) == 64
    assert derive_device_signing_secret(ctx["secret"], ctx["device"]["id"]) == expected
    assert cfg["custom_headers"] == {"X-Tenant": "acme"}

    r = await client.get("/api/v1/device/config", headers=bearer(ctx["token"]))
    assert r.json()["signing_secret"] == expected

    # A phone-signed request verifies with the receiver example (derives key from the device id header)
    raw = b'{"event_id":"x"}'
    ts, nonce = str(int(time.time())), "a" * 32
    sig = "v1=" + hmac.new(expected.encode(), f"{ts}.{nonce}.".encode() + raw, hashlib.sha256).hexdigest()
    assert verify_signature(ctx["secret"], {"X-NFC-Timestamp": ts, "X-NFC-Nonce": nonce, "X-NFC-Signature": sig,
                                            "X-NFC-Delivery-Mode": "direct", "X-NFC-Device-Id": ctx["device"]["id"]}, raw)

    body = _event(direct_delivery={"success": False, "status_code": 500, "latency_ms": 80, "error": None, "attempt": 1})
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(HOOK).mock(return_value=httpx.Response(200))
        r = await client.post("/api/v1/device/events", json=body, headers=bearer(ctx["token"]))
        assert r.json()["status"] == "failed"
        body["direct_delivery"] = {"success": True, "status_code": 200, "latency_ms": 42, "error": None, "attempt": 2}
        r = await client.post("/api/v1/device/events", json=body, headers=bearer(ctx["token"]))
        assert not route.called  # server never calls the endpoint in direct mode
    assert r.json() == {"event_id": body["event_id"], "status": "delivered", "status_code": 200,
                        "latency_ms": 42, "error": None}
    r = await client.get(f"/api/v1/events/{body['event_id']}", headers=user["headers"])
    ev = r.json()
    assert ev["delivery_mode"] == "direct" and ev["attempts"] == 2
    assert [d["mode"] for d in ev["deliveries"]] == ["direct", "direct"]
    r = await client.get("/api/v1/usage", headers=user["headers"])
    assert r.json()["totals"]["delivered"] == 1 and r.json()["totals"]["failed"] == 0


async def test_revoked_device_gets_device_revoked(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user)
    r = await client.post(f"/api/v1/devices/{ctx['device']['id']}/revoke", headers=user["headers"])
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    for method, path in (("GET", "/api/v1/device/config"), ("POST", "/api/v1/device/heartbeat")):
        r = await client.request(method, path, headers=bearer(ctx["token"]))
        assert r.status_code == 401 and r.json()["error"]["code"] == "device_revoked"
    r = await client.post("/api/v1/device/events", json=_event(), headers=bearer(ctx["token"]))
    assert r.status_code == 401 and r.json()["error"]["code"] == "device_revoked"


async def test_reregistration_rotates_token(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    first = await register_device(client, created["api_key_plaintext"], installation_id="install-abc-123")
    second = await register_device(client, created["api_key_plaintext"], installation_id="install-abc-123")
    assert first["device"]["id"] == second["device"]["id"]
    r = await client.get("/api/v1/device/config", headers=bearer(first["device_token"]))
    assert r.status_code == 401
    r = await client.get("/api/v1/device/config", headers=bearer(second["device_token"]))
    assert r.status_code == 200

    r = await client.patch(f"/api/v1/devices/{second['device']['id']}", json={"name": "Lobby"}, headers=user["headers"])
    assert r.json()["name"] == "Lobby"
    r = await client.delete(f"/api/v1/devices/{second['device']['id']}", headers=user["headers"])
    assert r.status_code == 204
    r = await client.get("/api/v1/device/config", headers=bearer(second["device_token"]))
    assert r.json()["error"]["code"] == "device_revoked"


async def test_event_validation(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user)
    h = bearer(ctx["token"])
    old = (datetime.now(UTC) - timedelta(days=8)).isoformat()
    future = (datetime.now(UTC) + timedelta(minutes=10)).isoformat()
    for bad in ({"card_id": "XYZ123"}, {"card_id": "04A"}, {"detected_at": old}, {"detected_at": future},
                {"event_id": "not-a-uuid"}):
        r = await client.post("/api/v1/device/events", json=_event(**bad), headers=h)
        assert r.status_code == 422, bad
        assert r.json()["error"]["code"] == "validation_error"


async def test_event_id_used_by_other_device_conflicts(client: AsyncClient, user: dict) -> None:
    ctx = await _setup(client, user)
    other = await register_device(client, ctx["api_key"])
    body = _event()
    with respx.mock() as mock:
        mock.post(HOOK).mock(return_value=httpx.Response(200))
        await client.post("/api/v1/device/events", json=body, headers=bearer(ctx["token"]))
    r = await client.post("/api/v1/device/events", json=body, headers=bearer(other["device_token"]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "event_id_conflict"
