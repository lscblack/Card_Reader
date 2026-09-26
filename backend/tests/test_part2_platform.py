"""Part 2 §A: error catalog, request logs, sandbox, admin console."""

from __future__ import annotations

import hashlib
import hmac
import re
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core import error_catalog
from app.core.config import settings
from app.core.security import derive_device_signing_secret
from app.db.session import SessionLocal
from app.main import app
from app.models import RequestLog
from app.services import request_logs
from app.services import sandbox as sandbox_service
from tests.conftest import bearer, create_app, register, register_device
from tests.p2_helpers import BROWSER_UA, add_member, create_card, register_business

APP_DIR = Path(__file__).resolve().parents[1] / "app"
LIVE = "http://127.0.0.1:8000"


async def _admin(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    return bearer(r.json()["access_token"])


async def _flush() -> None:
    await request_logs.flush(SessionLocal)


def _event(card: str = "04A1B2C3D4E5") -> dict:  # type: ignore[type-arg]
    return {"event_id": str(uuid.uuid4()), "card_id": card, "detected_at": datetime.now(UTC).isoformat()}


# ═══ A1: error catalog ═══════════════════════════════════════════════════
def _codes_used_in_source() -> set[str]:
    patterns = [
        r'AppError\(\s*\d{3},\s*"([a-z_]+)"',
        r'_unauthorized\(\s*"([a-z_]+)"',
        r'error_response\(\s*\d{3},\s*"([a-z_]+)"',
        r'AttemptResult\(\s*False,\s*error="([a-z_]+)"',
        r'return "(delivery_[a-z_]+)"',
    ]
    found: set[str] = set()
    for path in APP_DIR.rglob("*.py"):
        text = path.read_text()
        for p in patterns:
            found |= set(re.findall(p, text, re.S))
    from app.core.errors import _STATUS_CODES

    return found | set(_STATUS_CODES.values())


def test_every_error_code_in_codebase_is_in_catalog() -> None:
    used = _codes_used_in_source()
    assert len(used) > 40, used  # the scan really found the codes
    missing = sorted(c for c in used if c not in error_catalog.CATALOG)
    assert not missing, f"codes missing from the error catalog: {missing}"
    for code in ("delivery_timeout", "delivery_connection_refused", "delivery_dns_failure", "delivery_tls_error",
                 "delivery_http_4xx", "delivery_http_5xx", "delivery_redirect_blocked", "domain_not_allowed",
                 "delivery_ssrf_blocked", "endpoint_disabled", "endpoint_not_configured", "delivery_response_too_large"):
        assert code in error_catalog.CATALOG, code
    assert error_catalog.CATALOG["invalid_api_key"].ref == "NFC-1003"
    assert error_catalog.CATALOG["delivery_timeout"].ref == "NFC-5001"
    assert error_catalog.CATALOG["internal_error"].ref == "NFC-9000"


async def test_public_error_catalog_includes_mobile_entries(client: AsyncClient) -> None:
    r = await client.get("/api/v1/errors")
    items = r.json()
    assert r.status_code == 200 and len({i["ref"] for i in items}) == len(items)
    assert all(set(i) == {"code", "ref", "http_status", "source", "title", "description", "fix"} for i in items)
    mobile = {i["ref"]: i for i in items if i["source"] == "mobile"}
    md = (Path(__file__).resolve().parents[2] / "mobile" / "ERROR_CODES.md")
    if md.exists():
        expected = dict(re.findall(r"\| (MOB-\d{4}) \| `([a-z_]+)` \|", md.read_text()))
        assert {ref: mobile[ref]["code"] for ref in expected} == expected
    assert {i["source"] for i in items} == {"api", "delivery", "mobile"}
    by_status = {i["http_status"] for i in items}
    assert {401, 403, 404, 405, 409, 413, 422, 429, 500, 503} <= by_status


async def test_error_refs_on_every_error_path(client: AsyncClient, user: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    responses = [
        await client.get("/api/v1/nope"),
        await client.delete("/api/v1/auth/me", headers=user["headers"]),
        await client.post("/api/v1/auth/login", json={}),
        await client.get("/api/v1/auth/me"),
        await client.get("/api/v1/device/config", headers=bearer("nfcd_" + "x" * 48)),
        await client.post("/api/v1/device/register", headers=bearer("nfc_" + "x" * 48), json={}),
    ]
    monkeypatch.setattr(settings, "RATE_LIMIT_REQUESTS", 1)
    await client.get("/api/v1/overview", headers=user["headers"])
    responses.append(await client.get("/api/v1/overview", headers=user["headers"]))
    for r in responses:
        err = r.json()["error"]
        assert err["ref"] == error_catalog.CATALOG[err["code"]].ref, err
        assert err["docs_url"] == f"http://web.test/docs/errors#{err['ref']}"
        assert err["request_id"] == r.headers["X-Request-ID"]
    assert responses[-1].status_code == 429 and responses[-1].json()["error"]["ref"] == "NFC-2004"


@pytest.mark.parametrize(
    "side_effect,code,ref",
    [
        (httpx.ReadTimeout("slow"), "delivery_timeout", "NFC-5001"),
        (httpx.ConnectError("[Errno 111] Connection refused"), "delivery_connection_refused", "NFC-5002"),
        (httpx.ConnectError("[Errno -2] Name or service not known"), "delivery_dns_failure", "NFC-5003"),
        (httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"), "delivery_tls_error", "NFC-5004"),
        (httpx.Response(401), "delivery_http_4xx", "NFC-5005"),
        (httpx.Response(502), "delivery_http_5xx", "NFC-5006"),
        (httpx.Response(301, headers={"Location": "https://x.example.com"}), "delivery_redirect_blocked", "NFC-5007"),
        (httpx.Response(200, headers={"Content-Length": str(10 * 1024 * 1024)}), "delivery_response_too_large", "NFC-5009"),
    ],
)
async def test_delivery_error_codes(client: AsyncClient, user: dict, side_effect, code: str, ref: str) -> None:  # type: ignore[no-untyped-def]
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": "https://hooks.example.com/x",
                                                                       "enabled": True}, headers=user["headers"])
    dev = await register_device(client, created["api_key_plaintext"])
    body = _event()
    with respx.mock() as mock:
        route = mock.post("https://hooks.example.com/x")
        if isinstance(side_effect, Exception):
            route.mock(side_effect=side_effect)
        else:
            route.mock(return_value=side_effect)
        r = await client.post("/api/v1/device/events", json=body, headers=bearer(dev["device_token"]))
    res = r.json()
    assert res["error_code"] == code and res["error_ref"] == ref, res
    ev = (await client.get(f"/api/v1/events/{body['event_id']}", headers=user["headers"])).json()
    assert ev["error_code"] == code and ev["error_ref"] == ref
    assert ev["deliveries"][0]["error_code"] == code and ev["deliveries"][0]["error_ref"] == ref
    r = await client.post(f"/api/v1/applications/{app_id}/endpoint/test", headers=user["headers"])
    assert "error_code" in r.json()


# ═══ A2: request logs ════════════════════════════════════════════════════
async def test_request_logs_success_failure_and_scoping(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    dev = await register_device(client, created["api_key_plaintext"])
    await client.get("/api/v1/auth/me", headers={**user["headers"], "User-Agent": "Dashboard/1.0",
                                                  "X-Request-ID": "req-success-1"})
    await client.get(f"/api/v1/applications/{uuid.uuid4()}", headers={**user["headers"], "X-Request-ID": "req-fail-1"})
    await client.post("/api/v1/device/heartbeat", headers=bearer(dev["device_token"]))
    await client.get("/api/v1/health")  # excluded
    await _flush()

    r = await client.get("/api/v1/request-logs?request_id=req-success-1", headers=user["headers"])
    log = r.json()["items"][0]
    assert log["outcome"] == "success" and log["status_code"] == 200 and log["route"] == "/api/v1/auth/me"
    assert log["actor_type"] == "user" and log["user_id"] == user["user"]["id"] and log["user_agent"] == "Dashboard/1.0"
    assert log["ip_hash"] and len(log["ip_hash"]) == 32 and log["country"] is None
    r = await client.get("/api/v1/request-logs?outcome=client_error", headers=user["headers"])
    fail = next(x for x in r.json()["items"] if x["request_id"] == "req-fail-1")
    assert fail["status_code"] == 404 and fail["error_code"] == "not_found" and fail["error_ref"] == "NFC-2002"
    assert fail["route"] == "/api/v1/applications/{application_id}"
    r = await client.get(f"/api/v1/request-logs?device_id={dev['device']['id']}", headers=user["headers"])
    hb = r.json()["items"][0]
    assert hb["actor_type"] == "device" and hb["application_id"] == created["application"]["id"]
    async with SessionLocal() as s:
        routes = set((await s.execute(select(RequestLog.route))).scalars())
        ips = set((await s.execute(select(RequestLog.ip_hash))).scalars())
    assert "/api/v1/health" not in routes and "127.0.0.1" not in ips

    # Another developer sees none of it
    other = await register(client)
    oh = bearer(other["access_token"])
    r = await client.get(f"/api/v1/request-logs/{log['id']}", headers=oh)
    assert r.status_code == 404
    items = (await client.get("/api/v1/request-logs", headers=oh)).json()["items"]
    assert all(i["user_id"] == other["user"]["id"] for i in items)
    assert (await client.get(f"/api/v1/request-logs/{log['id']}", headers=user["headers"])).status_code == 200


async def test_request_log_for_server_error_and_business_scope(client: AsyncClient) -> None:
    async def boom() -> None:
        raise RuntimeError("kaboom")

    if not any(getattr(r, "path", "") == "/api/v1/_boom2" for r in app.router.routes):
        app.add_api_route("/api/v1/_boom2", boom, methods=["GET"])
    await client.get("/api/v1/_boom2", headers={"X-Request-ID": "req-boom"})

    owner = await register_business(client)
    staff = await add_member(client, owner, "staff")
    card = await create_card(client, owner, name="C")
    await client.get(f"/t/{card['public_code']}", headers={"User-Agent": BROWSER_UA, "X-Request-ID": "req-tap"})
    await _flush()

    admin = await _admin(client)
    r = await client.get("/api/v1/admin/request-logs?request_id=req-boom", headers=admin)
    boom_log = r.json()["items"][0]
    assert boom_log["status_code"] == 500 and boom_log["outcome"] == "server_error"
    assert boom_log["error_code"] == "internal_error" and boom_log["error_ref"] == "NFC-9000"
    r = await client.get(f"/api/v1/request-logs?business_id={owner['business_id']}&route=/t/{{public_code}}",
                         headers=owner["headers"])
    tap_log = r.json()["items"][0]
    assert tap_log["request_id"] == "req-tap" and tap_log["actor_type"] == "public" and tap_log["status_code"] == 302
    assert tap_log["business_id"] == owner["business_id"]
    r = await client.get(f"/api/v1/request-logs?business_id={owner['business_id']}", headers=staff["headers"])
    assert r.status_code == 403 and r.json()["error"]["details"] == {"required": "api.view"}
    r = await client.get("/api/v1/admin/request-logs?actor_type=public&min_latency_ms=0", headers=admin)
    assert r.json()["total"] >= 1


async def test_request_logs_redis_fallback_and_retention(client: AsyncClient, user: dict,
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    class Broken:
        async def rpush(self, *a, **k):  # noqa: ANN002, ANN003
            raise ConnectionError("down")

        async def lpop(self, *a, **k):  # noqa: ANN002, ANN003
            raise ConnectionError("down")

        async def llen(self, *a, **k):  # noqa: ANN002, ANN003
            raise ConnectionError("down")

    monkeypatch.setattr(request_logs, "get_redis", lambda: Broken())
    monkeypatch.setattr(request_logs, "_redis_down_until", 0.0)
    r = await client.get("/api/v1/auth/me", headers={**user["headers"], "X-Request-ID": "req-fallback"})
    assert r.status_code == 200  # the request itself is unaffected
    await request_logs.wait_pending()
    assert any(e["request_id"] == "req-fallback" for e in request_logs._local)
    assert await request_logs.flush(SessionLocal) >= 1
    async with SessionLocal() as s:
        assert (await s.execute(select(RequestLog).where(RequestLog.request_id == "req-fallback"))).first()
        s.add(RequestLog(request_id="old", method="GET", route="/x", path="/x", status_code=200, outcome="success",
                         latency_ms=1, actor_type="anonymous", created_at=datetime.now(UTC) - timedelta(days=91)))
        await s.commit()
    removed = await request_logs.purge(SessionLocal, force=True)
    assert removed == 1


# ═══ A4: sandbox ═════════════════════════════════════════════════════════
@pytest.fixture
def live_url(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(settings, "PUBLIC_API_URL", LIVE)
    return LIVE


def _bridge(mock: respx.MockRouter) -> respx.Route:
    """Routes outbound deliveries to the sandbox URL back into this ASGI app."""

    async def forward(request: httpx.Request) -> httpx.Response:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as inner:
            resp = await inner.request(request.method, request.url.raw_path.decode(), content=request.content,
                                       headers=request.headers)
            return httpx.Response(resp.status_code, content=resp.content, headers=resp.headers)

    return mock.route(host="127.0.0.1", port=8000).mock(side_effect=forward)


async def _requests(client: AsyncClient, headers: dict, endpoint_id: str) -> list[dict]:  # type: ignore[type-arg]
    return (await client.get(f"/api/v1/sandbox/endpoints/{endpoint_id}/requests", headers=headers)).json()["items"]


async def test_sandbox_default_endpoint_and_signature_verdicts(client: AsyncClient, live_url: str) -> None:
    dev = await register(client)
    h = bearer(dev["access_token"])
    eps = (await client.get("/api/v1/sandbox/endpoints", headers=h)).json()
    assert len(eps) == 1 and eps[0]["url"] == f"{LIVE}/sandbox/{eps[0]['token']}" and len(eps[0]["token"]) == 24
    ep = eps[0]

    # missing signature
    r = await client.post(f"/sandbox/{ep['token']}", json={"hello": "world"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    req = (await _requests(client, h, ep["id"]))[0]
    assert req["signature"]["status"] == "missing" and req["body_json"] == {"hello": "world"} and req["method"] == "POST"

    # link to an app and deliver a real relay event through the pipeline
    created = await create_app(client, h)
    app_id = created["application"]["id"]
    r = await client.post(f"/api/v1/sandbox/endpoints/{ep['id']}/use-for/{app_id}", headers=h)
    assert r.status_code == 200 and r.json()["endpoint"]["url"] == ep["url"] and r.json()["endpoint"]["enabled"]
    device = await register_device(client, created["api_key_plaintext"])
    with respx.mock(assert_all_called=True) as mock:
        _bridge(mock)
        r = await client.post("/api/v1/device/events", json=_event(), headers=bearer(device["device_token"]))
        assert r.json()["status"] == "delivered", r.text
        t = await client.post(f"/api/v1/sandbox/endpoints/{ep['id']}/send-test", headers=h)
        assert t.json()["success"] is True
    reqs = await _requests(client, h, ep["id"])
    test_req, relay_req = reqs[0], reqs[1]
    assert relay_req["signature"] == {"status": "valid", "mode": "relay", "reason": None, "error_ref": None}
    checks = {c["name"]: c["passed"] for c in relay_req["checks"]}
    assert checks == {"timestamp_skew": True, "nonce_unused": True, "event_id_format": True, "payload_schema": True,
                      "uid_not_authenticated": True, "device_known": True, "card_id_format": True, "content_type": True}
    assert relay_req["device_id"] == device["device"]["id"] and relay_req["headers"]["x-nfc-signature"].startswith("v1=")
    assert test_req["signature"]["status"] == "valid" and test_req["body_json"]["event"] == "endpoint.test"

    # replayed request → invalid? no: same signature valid but nonce reused
    raw = relay_req["body"].encode()
    hdrs = {k: v for k, v in relay_req["headers"].items() if k.startswith("x-nfc-") or k == "content-type"}
    await client.post(f"/sandbox/{ep['token']}", content=raw, headers=hdrs)
    replay = (await _requests(client, h, ep["id"]))[0]
    assert {c["name"]: c["passed"] for c in replay["checks"]}["nonce_unused"] is False

    # tampered body → invalid
    await client.post(f"/sandbox/{ep['token']}", content=raw.replace(b"04A1", b"04A2"),
                      headers={**hdrs, "x-nfc-nonce": "b" * 32})
    bad = (await _requests(client, h, ep["id"]))[0]
    assert bad["signature"]["status"] == "invalid" and bad["signature"]["error_ref"] == "NFC-5005"

    # direct-mode signature from the phone
    secret = created["webhook_secret_plaintext"]
    key = derive_device_signing_secret(secret, device["device"]["id"])
    ts, nonce = str(int(time.time())), "c" * 32
    sig = "v1=" + hmac.new(key.encode(), f"{ts}.{nonce}.".encode() + raw, hashlib.sha256).hexdigest()
    await client.post(f"/sandbox/{ep['token']}", content=raw, headers={
        "content-type": "application/json", "x-nfc-timestamp": ts, "x-nfc-nonce": nonce, "x-nfc-signature": sig,
        "x-nfc-delivery-mode": "direct", "x-nfc-device-id": device["device"]["id"],
        "authorization": "Bearer should-be-masked"})
    direct = (await _requests(client, h, ep["id"]))[0]
    assert direct["signature"]["status"] == "valid" and direct["signature"]["mode"] == "direct"
    assert direct["headers"]["authorization"] == "Bearer ****"
    one = await client.get(f"/api/v1/sandbox/requests/{direct['id']}", headers=h)
    assert one.status_code == 200

    # unlinked endpoint → unverifiable
    r = await client.post("/api/v1/sandbox/endpoints", json={"name": "Loose"}, headers=h)
    loose = r.json()
    await client.post(f"/sandbox/{loose['token']}", content=raw, headers=hdrs)
    assert (await _requests(client, h, loose["id"]))[0]["signature"]["status"] == "unverifiable"
    r = await client.post(f"/api/v1/sandbox/endpoints/{loose['id']}/send-test", headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "sandbox_no_application"

    # other users can't read it; unknown token → 404
    other = bearer((await register(client))["access_token"])
    assert (await client.get(f"/api/v1/sandbox/endpoints/{ep['id']}", headers=other)).status_code == 404
    assert (await client.post("/sandbox/unknowntoken12345678")).status_code == 404
    assert (await client.delete(f"/api/v1/sandbox/endpoints/{ep['id']}/requests", headers=h)).status_code == 204
    assert await _requests(client, h, ep["id"]) == []


async def test_sandbox_simulated_status_delay_and_limits(client: AsyncClient, live_url: str,
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    dev = await register(client)
    h = bearer(dev["access_token"])
    ep = (await client.get("/api/v1/sandbox/endpoints", headers=h)).json()[0]
    r = await client.patch(f"/api/v1/sandbox/endpoints/{ep['id']}", json={
        "response_status": 503, "response_body": "maintenance", "response_headers": {"X-Sim": "1"},
        "response_delay_ms": 50}, headers=h)
    assert r.status_code == 200 and r.json()["response_status"] == 503
    started = time.perf_counter()
    r = await client.post(f"/sandbox/{ep['token']}", json={"a": 1})
    assert r.status_code == 503 and r.text == "maintenance" and r.headers["x-sim"] == "1"
    assert time.perf_counter() - started >= 0.05
    stored = (await _requests(client, h, ep["id"]))[0]
    assert stored["response_status"] == 503 and stored["response_delay_ms"] == 50

    # Through the pipeline: 503 → retrying with delivery_http_5xx; delay beyond timeout → delivery_timeout
    created = await create_app(client, h)
    app_id = created["application"]["id"]
    await client.post(f"/api/v1/sandbox/endpoints/{ep['id']}/use-for/{app_id}", headers=h)
    await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": ep["url"], "enabled": True,
                                                                       "timeout_seconds": 1}, headers=h)
    device = await register_device(client, created["api_key_plaintext"])
    with respx.mock() as mock:
        _bridge(mock)
        r = await client.post("/api/v1/device/events", json=_event(), headers=bearer(device["device_token"]))
        assert r.json()["status"] == "retrying" and r.json()["error_code"] == "delivery_http_5xx"
        await client.patch(f"/api/v1/sandbox/endpoints/{ep['id']}", json={"response_status": 200,
                                                                          "response_delay_ms": 1500}, headers=h)
        r = await client.post("/api/v1/device/events", json=_event(), headers=bearer(device["device_token"]))
        assert r.json()["error_code"] == "delivery_timeout" and r.json()["error_ref"] == "NFC-5001"

    # > 64 KB → 413 stored
    await client.patch(f"/api/v1/sandbox/endpoints/{ep['id']}", json={"response_delay_ms": 0}, headers=h)
    r = await client.post(f"/sandbox/{ep['token']}", content=b"x" * (65 * 1024), headers={"content-type": "text/plain"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "payload_too_large"
    big = (await _requests(client, h, ep["id"]))[0]
    assert big["response_status"] == 413 and big["size_bytes"] == 65 * 1024 and big["body"] is None

    # keeps only the newest N requests
    monkeypatch.setattr(sandbox_service, "KEEP_REQUESTS", 3)
    for i in range(5):
        await client.post(f"/sandbox/{ep['token']}", json={"i": i})
    assert len(await _requests(client, h, ep["id"])) == 3
    ep_after = (await client.get(f"/api/v1/sandbox/endpoints/{ep['id']}", headers=h)).json()
    assert ep_after["request_count"] >= 5 and ep_after["last_request_at"]

    r = await client.patch(f"/api/v1/sandbox/endpoints/{ep['id']}", json={"response_delay_ms": 20000}, headers=h)
    assert r.status_code == 422


async def test_first_app_auto_attaches_sandbox(client: AsyncClient, live_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SANDBOX_AUTO_ATTACH", True)
    dev = await register(client)
    h = bearer(dev["access_token"])
    ep = (await client.get("/api/v1/sandbox/endpoints", headers=h)).json()[0]
    first = (await create_app(client, h))["application"]
    assert first["endpoint"]["url"] == ep["url"] and first["endpoint"]["enabled"] is True
    assert (await client.get(f"/api/v1/sandbox/endpoints/{ep['id']}", headers=h)).json()["application_id"] == first["id"]
    second = (await create_app(client, h, name="Second"))["application"]
    assert second["endpoint"]["url"] is None


async def test_business_sandbox_scope(client: AsyncClient, live_url: str) -> None:
    owner = await register_business(client)
    manager = await add_member(client, owner, "manager")
    bid = owner["business_id"]
    r = await client.post(f"/api/v1/sandbox/endpoints?business_id={bid}", json={"name": "Biz"}, headers=owner["headers"])
    assert r.status_code == 201 and r.json()["business_id"] == bid
    assert (await client.get("/api/v1/sandbox/endpoints", headers=owner["headers"])).json() == []
    r = await client.get(f"/api/v1/sandbox/endpoints/{r.json()['id']}", headers=manager["headers"])
    assert r.status_code == 403 and r.json()["error"]["details"] == {"required": "api.manage"}


# ═══ A5: admin console ═══════════════════════════════════════════════════
ADMIN_GETS = ["/api/v1/admin/overview", "/api/v1/admin/request-logs", "/api/v1/admin/accounts",
              "/api/v1/admin/businesses", "/api/v1/admin/devices", "/api/v1/admin/deliveries", "/api/v1/admin/system",
              "/api/v1/admin/settings"]


async def test_admin_endpoints_forbidden_for_non_admin(client: AsyncClient, user: dict) -> None:
    owner = await register_business(client)
    for headers in (user["headers"], owner["headers"]):
        for path in ADMIN_GETS:
            r = await client.get(path, headers=headers)
            assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", path
        for method, path in (("PATCH", "/api/v1/admin/settings"), ("PATCH", f"/api/v1/admin/accounts/{uuid.uuid4()}"),
                             ("PATCH", f"/api/v1/admin/businesses/{uuid.uuid4()}"),
                             ("POST", f"/api/v1/admin/devices/{uuid.uuid4()}/revoke"),
                             ("POST", f"/api/v1/admin/api-keys/{uuid.uuid4()}/revoke")):
            r = await client.request(method, path, json={}, headers=headers)
            assert r.status_code == 403, path
    assert (await client.get("/api/v1/admin/overview")).status_code == 401


async def test_admin_console(client: AsyncClient, user: dict) -> None:
    admin = await _admin(client)
    created = await create_app(client, user["headers"])
    device = await register_device(client, created["api_key_plaintext"])
    owner = await register_business(client)
    await client.get(f"/api/v1/applications/{uuid.uuid4()}", headers=user["headers"])
    await _flush()

    ov = (await client.get("/api/v1/admin/overview?range=24h", headers=admin)).json()
    assert ov["users"]["total"] == 3 and ov["users"]["developers"] == 2 and ov["users"]["businesses"] == 1
    assert ov["businesses"] == 1 and ov["applications"] == 2 and ov["devices"]["total"] == 1
    assert ov["devices"]["online"] == 1 and ov["requests"]["total"] > 5 and ov["requests"]["client_error"] >= 1
    assert {"p50_ms", "p95_ms", "p99_ms", "rpm_now", "error_rate"} <= set(ov["requests"])
    assert any(e["error_code"] == "not_found" and e["error_ref"] == "NFC-2002" for e in ov["top_errors"])
    assert ov["top_routes"] and ov["timeline"] and "queue_depth" in ov["deliveries"]

    sysinfo = (await client.get("/api/v1/admin/system", headers=admin)).json()
    assert sysinfo["database"] == "ok" and sysinfo["redis"] == "ok" and sysinfo["environment"] == "development"

    accounts = (await client.get("/api/v1/admin/accounts?type=business", headers=admin)).json()
    acc = accounts["items"][0]
    assert accounts["total"] == 1 and acc["business"]["id"] == owner["business_id"] and acc["plan"] == "biz_starter"
    assert set(acc["stats"]) == {"requests_24h", "error_rate_24h", "events_30d", "devices", "applications", "last_active_at"}
    detail = (await client.get(f"/api/v1/admin/accounts/{user['user']['id']}", headers=admin)).json()
    assert detail["stats"]["requests_24h"] >= 1 and detail["applications"] and detail["devices"]
    assert detail["recent_request_logs"] and detail["audit_logs"]

    r = await client.patch(f"/api/v1/admin/accounts/{user['user']['id']}", json={"plan_code": "pro",
                                                                                  "email_verified": True}, headers=admin)
    assert r.json()["plan"] == "pro" and r.json()["email_verified"] is True
    r = await client.patch(f"/api/v1/admin/accounts/{user['user']['id']}", json={"plan_code": "gold"}, headers=admin)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_plan"
    me = (await client.get("/api/v1/auth/me", headers=admin)).json()
    r = await client.patch(f"/api/v1/admin/accounts/{me['id']}", json={"is_active": False}, headers=admin)
    assert r.status_code == 400 and r.json()["error"]["code"] == "cannot_deactivate_self"

    biz = (await client.get("/api/v1/admin/businesses?q=acme", headers=admin)).json()
    assert biz["total"] == 1 and biz["items"][0]["stats"]["members"] == 1
    devs = (await client.get("/api/v1/admin/devices?online=true", headers=admin)).json()
    assert devs["total"] == 1 and devs["items"][0]["owner"]["id"] == user["user"]["id"]
    r = await client.post(f"/api/v1/admin/devices/{device['device']['id']}/revoke", headers=admin)
    assert r.json()["status"] == "revoked"
    r = await client.get("/api/v1/device/config", headers=bearer(device["device_token"]))
    assert r.json()["error"]["code"] == "device_revoked"
    r = await client.post(f"/api/v1/admin/api-keys/{created['api_key']['id']}/revoke", headers=admin)
    assert r.json()["is_active"] is False
    assert (await client.get("/api/v1/admin/deliveries?success=false", headers=admin)).status_code == 200

    async with SessionLocal() as s:
        from app.models import AuditLog

        actions = set((await s.execute(select(AuditLog.action))).scalars())
    assert {"admin.account_update", "admin.device_revoke", "admin.api_key_revoke"} <= actions


async def test_admin_platform_settings(client: AsyncClient, user: dict, redis) -> None:  # type: ignore[no-untyped-def]
    admin = await _admin(client)
    s = (await client.get("/api/v1/admin/settings", headers=admin)).json()
    assert s == {"signups_enabled": {"developer": True, "business": True}, "request_log_retention_days": 90,
                 "default_rate_limit": {"requests": settings.RATE_LIMIT_REQUESTS,
                                        "window_seconds": settings.RATE_LIMIT_WINDOW_SECONDS},
                 "maintenance_message": None}
    r = await client.patch("/api/v1/admin/settings", json={"signups_enabled": {"developer": False},
                                                           "maintenance_message": "Upgrade tonight",
                                                           "request_log_retention_days": 30}, headers=admin)
    assert r.json()["signups_enabled"] == {"developer": False, "business": True}
    assert r.json()["request_log_retention_days"] == 30
    r = await client.post("/api/v1/auth/register", json={"email": "late@example.com", "password": "Sup3rSecretPass",
                                                         "full_name": "L"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "signups_disabled"
    assert (await client.get("/api/v1/meta/status")).json()["maintenance_message"] == "Upgrade tonight"
    await register_business(client)  # business sign-ups still enabled

    r = await client.patch("/api/v1/admin/settings", json={"default_rate_limit": {"requests": 2, "window_seconds": 60}},
                           headers=admin)
    assert r.json()["default_rate_limit"] == {"requests": 2, "window_seconds": 60}
    await redis.flushall()  # every request so far also counted against the shared per-IP ceiling (2 × 5)
    codes = [(await client.get("/api/v1/overview", headers=user["headers"])).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    await redis.flushall()  # the admin's own bucket is also at the lowered limit
    r = await client.patch("/api/v1/admin/settings", json={"default_rate_limit": None}, headers=admin)
    assert r.json()["default_rate_limit"]["requests"] == settings.RATE_LIMIT_REQUESTS
    r = await client.patch("/api/v1/admin/settings", json={"request_log_retention_days": 0}, headers=admin)
    assert r.status_code == 422


async def test_public_endpoints_rate_limited_per_ip(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_REQUESTS", 2)
    codes = [(await client.get("/api/v1/errors")).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    r = await client.get("/t/whatever")
    assert r.status_code == 429  # same per-IP public bucket
