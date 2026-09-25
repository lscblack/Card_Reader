"""Contract section 7: endpoint domain allowlist, admin-managed CORS origins, QR pairing codes."""

from __future__ import annotations

import asyncio
import hashlib
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
import respx
from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import AllowedOrigin, Application, AuditLog, Delivery, PairingCode
from app.services import delivery as delivery_service
from app.services import origins
from app.services.url_validation import host_matches_allowlist, normalize_domain_entry, normalize_domain_list
from tests.conftest import bearer, create_app, register, register_device

HOOK = "https://api.example.com/nfc"


async def _actions() -> list[str]:
    async with SessionLocal() as s:
        return list((await s.execute(select(AuditLog.action))).scalars())


async def _admin_headers(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    return bearer(r.json()["access_token"])


def _event() -> dict[str, Any]:
    return {"event_id": str(uuid.uuid4()), "card_id": "04A1B2C3D4E5",
            "detected_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


# ═══ 7.1 Endpoint domain allowlist ═══════════════════════════════════════
@pytest.mark.parametrize(
    "entry,expected",
    [("API.Example.com", "api.example.com"), ("*.example.org", "*.example.org"),
     ("192.168.1.74", "192.168.1.74"), ("localhost", "localhost")],
)
def test_domain_entry_valid(entry: str, expected: str) -> None:
    assert normalize_domain_entry(entry) == expected


@pytest.mark.parametrize(
    "entry",
    ["https://api.example.com", "api.example.com:443", "api.example.com/path", "api.*.example.com",
     "*example.com", "*.com", "", "-bad.example.com", "exa mple.com", "*"],
)
def test_domain_entry_invalid(entry: str) -> None:
    with pytest.raises(ValueError):
        normalize_domain_entry(entry)


def test_domain_list_limits_and_dedupe() -> None:
    assert normalize_domain_list(["a.com", "A.com", "b.com"]) == ["a.com", "b.com"]
    with pytest.raises(ValueError, match="at most 20"):
        normalize_domain_list([f"h{i}.example.com" for i in range(21)])


def test_wildcard_matching() -> None:
    allowed = ["*.example.com", "api.other.com", "192.168.1.74"]
    assert host_matches_allowlist("a.example.com", allowed)
    assert host_matches_allowlist("a.b.example.com", allowed)
    assert host_matches_allowlist("A.Example.COM", allowed)
    assert not host_matches_allowlist("example.com", allowed)  # apex NOT matched by *.example.com
    assert not host_matches_allowlist("badexample.com", allowed)
    assert not host_matches_allowlist("example.com.evil.net", allowed)
    assert host_matches_allowlist("api.other.com", allowed)
    assert not host_matches_allowlist("x.api.other.com", allowed)  # exact entry: no sub-domains
    assert not host_matches_allowlist("other.com", allowed)
    assert host_matches_allowlist("192.168.1.74", allowed)
    assert not host_matches_allowlist("192.168.1.75", allowed)
    assert host_matches_allowlist("anything.net", [])  # empty = unrestricted


async def test_allowlist_endpoint_rules(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    assert created["application"]["allowed_domains"] == []
    h = user["headers"]

    r = await client.put(f"/api/v1/applications/{app_id}/allowed-domains", json={"domains": ["https://x.com"]}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"

    r = await client.put(f"/api/v1/applications/{app_id}/allowed-domains",
                         json={"domains": ["*.Example.com", "hooks.partner.io"]}, headers=h)
    assert r.status_code == 200 and r.json()["allowed_domains"] == ["*.example.com", "hooks.partner.io"]

    # Apex is not covered by the wildcard → 422 domain_not_allowed
    r = await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": "https://example.com/nfc", "enabled": True}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "domain_not_allowed"
    r = await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": "https://evil.net/nfc", "enabled": True}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "domain_not_allowed"
    r = await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": HOOK, "enabled": True}, headers=h)
    assert r.status_code == 200

    # Narrowing the list so the current endpoint no longer matches → 409
    r = await client.put(f"/api/v1/applications/{app_id}/allowed-domains", json={"domains": ["hooks.partner.io"]}, headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "endpoint_outside_allowlist"
    r = await client.get(f"/api/v1/applications/{app_id}", headers=h)
    assert r.json()["allowed_domains"] == ["*.example.com", "hooks.partner.io"]  # unchanged

    # DeviceConfig carries the allowlist
    dev = await register_device(client, created["api_key_plaintext"])
    assert dev["config"]["allowed_domains"] == ["*.example.com", "hooks.partner.io"]
    r = await client.get("/api/v1/device/config", headers=bearer(dev["device_token"]))
    assert r.json()["allowed_domains"] == ["*.example.com", "hooks.partner.io"]

    # Clearing removes the restriction
    r = await client.put(f"/api/v1/applications/{app_id}/allowed-domains", json={"domains": []}, headers=h)
    assert r.status_code == 200 and r.json()["allowed_domains"] == []
    assert "application.allowed_domains_update" in await _actions()


async def _app_with_endpoint_outside_allowlist(client: AsyncClient, user: dict) -> dict[str, Any]:
    """Endpoint configured, then the allowlist changed underneath it (e.g. direct DB edit / legacy data)."""
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    r = await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": HOOK, "enabled": True}, headers=user["headers"])
    assert r.status_code == 200
    dev = await register_device(client, created["api_key_plaintext"])
    return {"app_id": app_id, "token": dev["device_token"]}


async def _restrict(app_id: str, domains: list[str]) -> None:
    async with SessionLocal() as s:
        await s.execute(update(Application).where(Application.id == uuid.UUID(app_id)).values(allowed_domains=domains))
        await s.commit()


async def test_relay_attempt_blocked_with_domain_not_allowed(client: AsyncClient, user: dict) -> None:
    ctx = await _app_with_endpoint_outside_allowlist(client, user)
    await _restrict(ctx["app_id"], ["only.partner.io"])
    body = _event()
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(HOOK).mock(return_value=httpx.Response(200))
        r = await client.post("/api/v1/device/events", json=body, headers=bearer(ctx["token"]))
        assert r.status_code == 200
        assert r.json()["status"] == "failed" and r.json()["error"] == "domain_not_allowed"  # not retried

        # endpoint test and redeliver are blocked too
        r = await client.post(f"/api/v1/applications/{ctx['app_id']}/endpoint/test", headers=user["headers"])
        assert r.json()["success"] is False and r.json()["error"] == "domain_not_allowed"
        r = await client.post(f"/api/v1/events/{body['event_id']}/redeliver", headers=user["headers"])
        assert r.json()["success"] is False and r.json()["error"] == "domain_not_allowed"
        assert not route.called  # endpoint never contacted

    async with SessionLocal() as s:
        rows = (await s.execute(select(Delivery))).scalars().all()
    assert len(rows) == 2 and all(not d.success and d.error == "domain_not_allowed" for d in rows)


async def test_retry_blocked_when_allowlist_changes(client: AsyncClient, user: dict) -> None:
    ctx = await _app_with_endpoint_outside_allowlist(client, user)
    body = _event()
    with respx.mock() as mock:
        route = mock.post(HOOK).mock(return_value=httpx.Response(503))
        r = await client.post("/api/v1/device/events", json=body, headers=bearer(ctx["token"]))
        assert r.json()["status"] == "retrying"
        await _restrict(ctx["app_id"], ["only.partner.io"])
        assert await delivery_service.process_due(SessionLocal, now=time.time() + 20) == 1
        assert route.call_count == 1
    r = await client.get(f"/api/v1/events/{body['event_id']}", headers=user["headers"])
    ev = r.json()
    assert ev["status"] == "failed" and ev["last_error"] == "domain_not_allowed" and ev["attempts"] == 2


# ═══ 7.2 Admin-managed CORS origins ══════════════════════════════════════
def _preflight(origin: str) -> dict[str, str]:
    return {"Origin": origin, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type"}


async def test_cors_origin_add_and_delete(client: AsyncClient, user: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    admin = await _admin_headers(client)
    origin = "https://dash.customer.io"

    r = await client.options("/api/v1/auth/login", headers=_preflight(origin))
    assert "access-control-allow-origin" not in r.headers

    r = await client.post("/api/v1/admin/allowed-origins", json={"origin": "HTTPS://Dash.Customer.io/", "note": "customer"},
                          headers=admin)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["origin"] == origin and created["note"] == "customer" and created["created_by"] and created["created_by_email"]

    # Allowed immediately (in-process refresh)
    r = await client.options("/api/v1/auth/login", headers=_preflight(origin))
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == origin
    r = await client.get("/api/v1/billing/plans", headers={"Origin": origin})
    assert r.headers["access-control-allow-origin"] == origin

    # Error responses (429) keep CORS headers
    monkeypatch.setattr(settings, "RATE_LIMIT_REQUESTS", 1)
    await client.get("/api/v1/auth/me", headers={**user["headers"], "Origin": origin})
    r = await client.get("/api/v1/auth/me", headers={**user["headers"], "Origin": origin})
    assert r.status_code == 429 and r.headers["access-control-allow-origin"] == origin
    monkeypatch.setattr(settings, "RATE_LIMIT_REQUESTS", 1000)

    r = await client.get("/api/v1/admin/allowed-origins", headers=admin)
    listing = r.json()
    assert "http://localhost:5173" in listing["env"] and [i["origin"] for i in listing["items"]] == [origin]

    # Duplicates (DB or env) → 409; malformed → 422
    r = await client.post("/api/v1/admin/allowed-origins", json={"origin": origin}, headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "origin_exists"
    r = await client.post("/api/v1/admin/allowed-origins", json={"origin": "http://localhost:5173"}, headers=admin)
    assert r.status_code == 409
    for bad in ("https://x.io/path", "ftp://x.io", "https://*.x.io", "https://u:p@x.io", "x.io"):
        r = await client.post("/api/v1/admin/allowed-origins", json={"origin": bad}, headers=admin)
        assert r.status_code == 422, bad

    # Non-admins can't manage origins
    r = await client.post("/api/v1/admin/allowed-origins", json={"origin": "https://a.io"}, headers=user["headers"])
    assert r.status_code == 403

    r = await client.delete(f"/api/v1/admin/allowed-origins/{created['id']}", headers=admin)
    assert r.status_code == 204
    r = await client.options("/api/v1/auth/login", headers=_preflight(origin))
    assert "access-control-allow-origin" not in r.headers
    r = await client.delete(f"/api/v1/admin/allowed-origins/{created['id']}", headers=admin)
    assert r.status_code == 404

    actions = await _actions()
    assert "allowed_origin.create" in actions and "allowed_origin.delete" in actions


async def test_cors_cache_picks_up_other_process_changes_after_ttl(client: AsyncClient) -> None:
    origin = "https://other-process.io"
    r = await client.options("/api/v1/auth/login", headers=_preflight(origin))  # warms the cache
    assert "access-control-allow-origin" not in r.headers
    async with SessionLocal() as s:  # simulates another API process adding it
        s.add(AllowedOrigin(origin=origin))
        await s.commit()
    r = await client.options("/api/v1/auth/login", headers=_preflight(origin))
    assert "access-control-allow-origin" not in r.headers  # still cached (≤ 30 s)
    origins._loaded_at -= origins.CACHE_TTL_SECONDS + 1  # age the cache past the TTL
    r = await client.options("/api/v1/auth/login", headers=_preflight(origin))
    assert r.headers["access-control-allow-origin"] == origin


def test_origin_normalization(monkeypatch: pytest.MonkeyPatch) -> None:
    assert origins.normalize_origin("https://App.Example.com:443") == "https://app.example.com"
    assert origins.normalize_origin("http://192.168.1.74:5174/") == "http://192.168.1.74:5174"
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    with pytest.raises(ValueError, match="https"):
        origins.normalize_origin("http://dash.example.com")
    assert origins.normalize_origin("https://dash.example.com") == "https://dash.example.com"


# ═══ 7.3 QR pairing codes ════════════════════════════════════════════════
async def _pairing(client: AsyncClient, user: dict, app_id: str, name: str | None = None) -> dict[str, Any]:
    body = {"device_name": name} if name is not None else {}
    r = await client.post(f"/api/v1/applications/{app_id}/pairing-codes", json=body, headers=user["headers"])
    assert r.status_code == 201, r.text
    return r.json()


def _register_body(name: str = "Typed on phone", installation_id: str | None = None) -> dict[str, Any]:
    return {"device_name": name, "platform": "android", "model": "Pixel 8", "os_version": "Android 15",
            "app_version": "1.0.0", "installation_id": installation_id or str(uuid.uuid4())}


async def test_pairing_code_create_and_redeem(client: AsyncClient, user: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DEVICE_SERVER_URL", "http://192.168.1.74:8000")
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    pc = await _pairing(client, user, app_id, "Front desk")

    code = pc["code"]
    assert code.startswith("nfcp_") and len(code) == 5 + 32
    assert pc["server_url"] == "http://192.168.1.74:8000"
    assert pc["qr_payload"] == (
        f"nfcterminal://pair?v=1&server=http%3A%2F%2F192.168.1.74%3A8000&code={code}&name=Front%20desk"
    )
    expires = datetime.fromisoformat(pc["expires_at"].replace("Z", "+00:00"))
    assert timedelta(minutes=9) < expires - datetime.now(UTC) <= timedelta(minutes=10)
    async with SessionLocal() as s:
        row = (await s.execute(select(PairingCode))).scalar_one()
        assert row.code_hash == hashlib.sha256(code.encode()).hexdigest()  # hashed only

    r = await client.get(f"/api/v1/pairing-codes/{pc['id']}", headers=user["headers"])
    assert r.json()["status"] == "pending" and r.json()["device"] is None and r.json()["used_at"] is None

    r = await client.post("/api/v1/device/register", json=_register_body(), headers=bearer(code))
    assert r.status_code == 201, r.text
    reg = r.json()
    assert reg["device"]["name"] == "Front desk"  # preset name overrides the body
    assert reg["device_token"].startswith("nfcd_") and reg["config"]["application"]["id"] == app_id
    assert reg["config"]["allowed_domains"] == []

    r = await client.get(f"/api/v1/pairing-codes/{pc['id']}", headers=user["headers"])
    status = r.json()
    assert status["status"] == "used" and status["used_at"] and status["device"]["id"] == reg["device"]["id"]

    # Single use
    r = await client.post("/api/v1/device/register", json=_register_body(), headers=bearer(code))
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_pairing_code"

    async with SessionLocal() as s:
        logs = (await s.execute(select(AuditLog).where(AuditLog.action.in_(["pairing_code.create", "device.register"])))).scalars().all()
    reg_log = next(a for a in logs if a.action == "device.register")
    assert reg_log.meta["via"] == "pairing_code" and code not in str(reg_log.meta)
    assert any(a.action == "pairing_code.create" for a in logs)


async def test_pairing_without_name_uses_body_name(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    pc = await _pairing(client, user, created["application"]["id"])
    assert "&name=" not in pc["qr_payload"]
    r = await client.post("/api/v1/device/register", json=_register_body("Lobby phone"), headers=bearer(pc["code"]))
    assert r.status_code == 201 and r.json()["device"]["name"] == "Lobby phone"


async def test_pairing_expired_cancelled_unknown(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]

    expired = await _pairing(client, user, app_id)
    async with SessionLocal() as s:
        await s.execute(update(PairingCode).where(PairingCode.id == uuid.UUID(expired["id"]))
                        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await s.commit()
    r = await client.post("/api/v1/device/register", json=_register_body(), headers=bearer(expired["code"]))
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_pairing_code"
    r = await client.get(f"/api/v1/pairing-codes/{expired['id']}", headers=user["headers"])
    assert r.json()["status"] == "expired"

    cancelled = await _pairing(client, user, app_id)
    r = await client.post(f"/api/v1/pairing-codes/{cancelled['id']}/cancel", headers=user["headers"])
    assert r.status_code == 204
    r = await client.get(f"/api/v1/pairing-codes/{cancelled['id']}", headers=user["headers"])
    assert r.json()["status"] == "expired"
    r = await client.post("/api/v1/device/register", json=_register_body(), headers=bearer(cancelled["code"]))
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_pairing_code"

    r = await client.post("/api/v1/device/register", json=_register_body(), headers=bearer("nfcp_" + "x" * 32))
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_pairing_code"

    # Other users can't see or cancel it, or create codes on someone else's app
    other = await register(client)
    oh = bearer(other["access_token"])
    assert (await client.get(f"/api/v1/pairing-codes/{cancelled['id']}", headers=oh)).status_code == 404
    assert (await client.post(f"/api/v1/pairing-codes/{cancelled['id']}/cancel", headers=oh)).status_code == 404
    r = await client.post(f"/api/v1/applications/{app_id}/pairing-codes", json={}, headers=oh)
    assert r.status_code == 404


async def test_pairing_plan_limit_checked_at_redemption(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    pc = await _pairing(client, user, app_id)  # creation is not limited
    for _ in range(5):
        await register_device(client, created["api_key_plaintext"])
    r = await client.post("/api/v1/device/register", json=_register_body(), headers=bearer(pc["code"]))
    assert r.status_code == 402 and r.json()["error"]["code"] == "plan_limit_reached"
    # A failed redemption does not consume the code
    r = await client.get(f"/api/v1/pairing-codes/{pc['id']}", headers=user["headers"])
    assert r.json()["status"] == "pending"


async def test_pairing_concurrent_redemption_exactly_one_wins(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    pc = await _pairing(client, user, created["application"]["id"])
    responses = await asyncio.gather(*[
        client.post("/api/v1/device/register", json=_register_body(), headers=bearer(pc["code"]))
        for _ in range(2)
    ])
    codes = sorted(r.status_code for r in responses)
    assert codes == [201, 401], [r.text for r in responses]
    loser = next(r for r in responses if r.status_code == 401)
    assert loser.json()["error"]["code"] == "invalid_pairing_code"
    r = await client.get("/api/v1/devices", headers=user["headers"])
    assert len(r.json()) == 1


def test_pairing_code_redacted_in_logs() -> None:
    from app.core.logging import redact

    code = "nfcp_" + "Ab1-" * 8
    assert code not in redact(f"register with Bearer {code}") and code not in redact(f"code={code}")
