"""Plan limits, rate limiting, error envelope, SSRF, config hardening, logging redaction."""

from __future__ import annotations

import io
import logging
import uuid
from datetime import UTC, datetime

import httpx
import pytest
import respx
from httpx import AsyncClient
from sqlalchemy import update

from app.core import rate_limit
from app.core.config import Settings, settings
from app.core.logging import RedactionFilter, RequestIdFilter, TextFormatter, redact
from app.core.security import sign_payload
from app.db.session import SessionLocal
from app.main import app
from app.models import Plan
from app.services import url_validation
from app.services.url_validation import InvalidEndpointURL, validate_endpoint_url
from tests.conftest import bearer, create_app, register_device


# ── Plan limits ──────────────────────────────────────────────────────────
async def test_application_limit_402(client: AsyncClient, user: dict) -> None:
    for i in range(3):
        await create_app(client, user["headers"], name=f"App {i}")
    r = await client.post("/api/v1/applications", json={"name": "One too many"}, headers=user["headers"])
    assert r.status_code == 402 and r.json()["error"]["code"] == "plan_limit_reached"


async def test_device_limit_402(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    for _ in range(5):
        await register_device(client, created["api_key_plaintext"])
    r = await client.post("/api/v1/device/register", headers=bearer(created["api_key_plaintext"]),
                          json={"device_name": "6th", "installation_id": str(uuid.uuid4())})
    assert r.status_code == 402 and r.json()["error"]["code"] == "plan_limit_reached"


async def test_monthly_event_limit_402(client: AsyncClient, user: dict) -> None:
    async with SessionLocal() as s:
        await s.execute(update(Plan).where(Plan.code == "free").values(events_per_month=1))
        await s.commit()
    created = await create_app(client, user["headers"])
    dev = await register_device(client, created["api_key_plaintext"])
    now = datetime.now(UTC).isoformat()
    first = {"event_id": str(uuid.uuid4()), "card_id": "04A1B2C3", "detected_at": now}
    r = await client.post("/api/v1/device/events", json=first, headers=bearer(dev["device_token"]))
    assert r.status_code == 200
    r = await client.post("/api/v1/device/events", json={**first, "event_id": str(uuid.uuid4())},
                          headers=bearer(dev["device_token"]))
    assert r.status_code == 402 and r.json()["error"]["code"] == "plan_limit_reached"
    # Replays of an already stored event still work
    r = await client.post("/api/v1/device/events", json=first, headers=bearer(dev["device_token"]))
    assert r.status_code == 200


# ── Rate limiting ────────────────────────────────────────────────────────
async def test_rate_limit_429_with_headers(client: AsyncClient, user: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_REQUESTS", 3)
    statuses = []
    for _ in range(4):
        r = await client.get("/api/v1/auth/me", headers=user["headers"])
        statuses.append(r.status_code)
        if r.status_code == 200:
            assert r.headers["X-RateLimit-Limit"] == "3"
    assert statuses == [200, 200, 200, 429]
    assert r.json()["error"]["code"] == "rate_limited"
    assert int(r.headers["Retry-After"]) >= 1
    assert r.headers["X-RateLimit-Remaining"] == "0" and int(r.headers["X-RateLimit-Reset"]) > 0

    # A different identity has its own bucket
    other = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    r = await client.get("/api/v1/auth/me", headers=bearer(other.json()["access_token"]))
    assert r.status_code == 200


async def test_auth_endpoints_stricter_per_ip(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AUTH_RATE_LIMIT_REQUESTS", 2)
    codes = []
    for _ in range(3):
        r = await client.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "nope-nope"})
        codes.append(r.status_code)
    assert codes == [401, 401, 429]


async def test_rate_limit_fails_open_when_redis_down(client: AsyncClient, user: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    class Broken:
        def pipeline(self, *a, **k):
            raise ConnectionError("redis down")

        async def ping(self):
            raise ConnectionError("redis down")

    monkeypatch.setattr(rate_limit, "get_redis", lambda: Broken())
    monkeypatch.setattr(settings, "RATE_LIMIT_REQUESTS", 1)
    for _ in range(3):
        r = await client.get("/api/v1/auth/me", headers=user["headers"])
        assert r.status_code == 200 and "X-RateLimit-Limit" not in r.headers

    import app.core.redis as redis_mod
    monkeypatch.setattr(redis_mod, "_client", Broken())
    r = await client.get("/api/v1/health")
    assert r.status_code == 200 and r.json() == {"status": "degraded", "database": "ok", "redis": "error",
                                                 "version": "1.0.0"}


# ── Error envelope ───────────────────────────────────────────────────────
async def test_error_envelope_shapes(client: AsyncClient, user: dict) -> None:
    async def boom() -> None:
        raise RuntimeError("secret internals nfc_" + "x" * 48)

    if not any(getattr(r, "path", "") == "/api/v1/_boom" for r in app.router.routes):
        app.add_api_route("/api/v1/_boom", boom, methods=["GET"])

    cases = [
        (await client.get("/api/v1/does-not-exist"), 404, "not_found"),
        (await client.delete("/api/v1/auth/me", headers=user["headers"]), 405, "method_not_allowed"),
        (await client.post("/api/v1/auth/login", json={}), 422, "validation_error"),
        (await client.post("/api/v1/auth/login", content=b"{bad json", headers={"content-type": "application/json"}),
         422, "validation_error"),
        (await client.get(f"/api/v1/applications/{uuid.uuid4()}", headers=user["headers"]), 404, "not_found"),
        (await client.get("/api/v1/applications/not-a-uuid", headers=user["headers"]), 422, "validation_error"),
        (await client.get("/api/v1/overview"), 401, "unauthorized"),
        (await client.get("/api/v1/_boom"), 500, "internal_error"),
    ]
    for response, status, code in cases:
        assert response.status_code == status, (response.request.url, response.text)
        body = response.json()
        assert set(body) == {"error"}
        assert set(body["error"]) == {"code", "message", "details", "ref", "request_id", "docs_url"}  # Part 2 §A1
        assert body["error"]["ref"].startswith("NFC-") and body["error"]["request_id"]
        assert body["error"]["code"] == code
        assert "nfc_" not in response.text


async def test_request_id_and_security_headers(client: AsyncClient) -> None:
    r = await client.get("/api/v1/health", headers={"X-Request-ID": "abc-123"})
    assert r.headers["X-Request-ID"] == "abc-123"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    r = await client.get("/api/v1/health", headers={"X-Request-ID": "bad id with spaces\n"})
    assert r.headers["X-Request-ID"] != "bad id with spaces\n" and len(r.headers["X-Request-ID"]) == 32


async def test_cors_preflight(client: AsyncClient) -> None:
    r = await client.options("/api/v1/auth/login", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    r = await client.options("/api/v1/auth/login", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in r.headers


async def test_https_enforcement(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENFORCE_HTTPS", True)
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    r = await client.get("/api/v1/billing/plans", headers={"X-Forwarded-Proto": "http"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "https_required"
    r = await client.get("/api/v1/billing/plans", headers={"X-Forwarded-Proto": "https"})
    assert r.status_code == 200 and "max-age" in r.headers["Strict-Transport-Security"]
    r = await client.get("/api/v1/health")  # probes over plain http are allowed
    assert r.status_code == 200


# ── SSRF / endpoint validation outside development ─────────────────────
@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/hook",  # https required
        "https://169.254.169.254/latest/meta-data",
        "https://10.0.0.5/hook",
        "https://127.0.0.1/hook",
        "https://[::1]/hook",
        "https://[::ffff:192.168.0.1]/hook",
        "https://localhost/hook",
        "https://224.0.0.1/hook",
        "https://100.64.1.1/hook",
    ],
)
async def test_ssrf_blocked_in_production(url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    with pytest.raises(InvalidEndpointURL):
        await validate_endpoint_url(url)


async def test_dns_resolution_to_private_ip_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    async def fake_resolve(host: str, port: int) -> list[str]:
        return {"internal.attacker.com": ["10.1.2.3"], "ok.example.com": ["93.184.216.34"],
                "meta.attacker.com": ["169.254.169.254"]}[host]

    monkeypatch.setattr(url_validation, "_resolve", fake_resolve)
    with pytest.raises(InvalidEndpointURL):
        await validate_endpoint_url("https://internal.attacker.com/hook")
    with pytest.raises(InvalidEndpointURL):
        await validate_endpoint_url("https://meta.attacker.com/hook")
    assert await validate_endpoint_url("https://ok.example.com/hook") == "https://ok.example.com/hook"


async def test_delivery_revalidates_url_at_send_time(client: AsyncClient, user: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    created = await create_app(client, user["headers"])
    r = await client.put(f"/api/v1/applications/{created['application']['id']}/endpoint",
                         json={"url": "http://127.0.0.1:9/hook", "enabled": True}, headers=user["headers"])
    assert r.status_code == 200
    dev = await register_device(client, created["api_key_plaintext"])
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ENFORCE_HTTPS", False)  # test client speaks plain http
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post("http://127.0.0.1:9/hook").mock(return_value=httpx.Response(200))
        r = await client.post("/api/v1/device/events", headers=bearer(dev["device_token"]),
                              json={"event_id": str(uuid.uuid4()), "card_id": "04A1B2C3",
                                    "detected_at": datetime.now(UTC).isoformat()})
        assert not route.called
    assert r.json()["status"] == "failed" and r.json()["error"].startswith("invalid_endpoint_url")


# ── Config hardening ─────────────────────────────────────────────────────
def test_production_refuses_placeholder_secrets() -> None:
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(ENVIRONMENT="production", DEBUG=False, _env_file=None)
    with pytest.raises(ValueError, match="at least 32"):
        Settings(ENVIRONMENT="production", DEBUG=False, JWT_SECRET="short",
                 WEBHOOK_SIGNING_SECRET="x" * 40, _env_file=None)
    ok = Settings(ENVIRONMENT="production", DEBUG=False, JWT_SECRET="j" * 40, WEBHOOK_SIGNING_SECRET="w" * 40,
                  _env_file=None)
    assert ok.enforce_https is True
    dev = Settings(_env_file=None, CORS_ORIGINS="http://a.test, http://b.test")
    assert dev.CORS_ORIGINS == ["http://a.test", "http://b.test"] and dev.enforce_https is False


def test_signature_known_vector() -> None:
    # Independently computed: printf '1700000000.00112233445566778899aabbccddeeff.{"a":1}' |
    #   openssl dgst -sha256 -hmac whsec_test
    import hashlib
    import hmac

    body = b'{"a":1}'
    expected = hmac.new(b"whsec_test", b'1700000000.00112233445566778899aabbccddeeff.{"a":1}', hashlib.sha256).hexdigest()
    assert sign_payload("whsec_test", "1700000000", "00112233445566778899aabbccddeeff", body) == f"v1={expected}"


def test_express_example_verifier_matches() -> None:
    import json
    import shutil
    import subprocess
    import time
    from pathlib import Path

    if shutil.which("node") is None:
        pytest.skip("node not installed")
    secret = "whsec_" + "k" * 43
    body = b'{"event_id":"e1","card_id":"04A1"}'
    ts, nonce = str(int(time.time())), "ab" * 16
    device_id = str(uuid.uuid4())
    from app.core.security import derive_device_signing_secret

    relay_sig = sign_payload(secret, ts, nonce, body)
    direct_sig = sign_payload(derive_device_signing_secret(secret, device_id), ts, nonce, body)
    example = Path(__file__).resolve().parents[1] / "examples" / "receiver_express.js"
    script = f"""
    const m = require({json.dumps(str(example))});
    const body = Buffer.from({json.dumps(body.decode())});
    const base = {{"x-nfc-timestamp": "{ts}", "x-nfc-nonce": "{nonce}", "x-nfc-device-id": "{device_id}"}};
    const relay = m.verifySignature("{secret}", {{...base, "x-nfc-signature": "{relay_sig}", "x-nfc-delivery-mode": "relay"}}, body);
    const direct = m.verifySignature("{secret}", {{...base, "x-nfc-signature": "{direct_sig}", "x-nfc-delivery-mode": "direct"}}, body);
    const forged = m.verifySignature("{secret}", {{...base, "x-nfc-signature": "v1=00", "x-nfc-delivery-mode": "relay"}}, body);
    console.log(JSON.stringify([relay, direct, forged]));
    """
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout.strip()
    assert json.loads(out) == [True, True, False]


# ── Logging redaction ────────────────────────────────────────────────────
def test_log_redaction() -> None:
    api_key = "nfc_" + "A1b2" * 12
    device_token = "nfcd_" + "Z9y8" * 12
    secret = "whsec_" + "q" * 43
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(RequestIdFilter())
    handler.addFilter(RedactionFilter())
    handler.setFormatter(TextFormatter())
    logger = logging.getLogger("test.redaction")
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        logger.info("got key %s and token %s", api_key, device_token)
        logger.info("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")
        logger.info('payload {"email": "a@b.c", "password": "hunter2hunter2"} secret=%s', secret)
        logger.info("login", extra={"password": "p4ss", "headers": {"Authorization": "Bearer abc"}})
        logger.info("db postgresql://postgres:YourStrongPassword@127.0.0.1/db")
        logger.info("database nfc_platform_test stays readable")
    finally:
        logger.removeHandler(handler)
    out = stream.getvalue()
    for leaked in (api_key, device_token, secret, "hunter2hunter2", "eyJhbGciOiJIUzI1NiJ9", "YourStrongPassword"):
        assert leaked not in out, leaked
    assert "[REDACTED]" in out and "nfc_platform_test" in out
    assert redact("Bearer nfcd_" + "x" * 48) == "Bearer [REDACTED]"


async def test_openapi_docs_available(client: AsyncClient) -> None:
    # Part 3 §6: no public Swagger/ReDoc/OpenAPI; the schema is still generated in-process.
    for path in ("/openapi.json", "/docs", "/redoc"):
        assert (await client.get(path)).status_code == 404
    spec = app.openapi()
    assert "X-NFC-Signature" in spec["info"]["description"]
    assert {"DashboardJWT", "ApiKeyOrPairingCode", "DeviceToken"} <= set(spec["components"]["securitySchemes"])


async def test_meta_exposes_device_server_url(client: AsyncClient) -> None:
    r = await client.get("/api/v1/meta")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"device_server_url", "environment", "version"}
    assert body["device_server_url"].startswith("http") and not body["device_server_url"].endswith("/")
