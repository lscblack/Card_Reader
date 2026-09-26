"""Regression tests for the backend review pass (authorization, data correctness, security hardening)."""

from __future__ import annotations

import asyncio
import csv
import io
import threading
import uuid
import zoneinfo
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import respx
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select, update

from app.core.security import generate_reset_token, sha256_hex
from app.db.session import SessionLocal
from app.models import AppRelease, NfcEvent, PasswordResetToken, SandboxEndpoint
from app.services import app_builds, delivery, media
from app.services.actions import _vcard_escape
from app.services.media import media_root
from tests.conftest import bearer, create_app, register, register_device
from tests.p2_helpers import BROWSER_UA, add_member, create_card, register_business
from tests.test_part4 import phone_login, primary, register_personal


# ── Plan limits: a personal plan must not lift developer limits ──────────────
async def test_personal_plan_does_not_lift_developer_limits(client: AsyncClient) -> None:
    dev = await register(client)
    h = bearer(dev["access_token"])
    admin = (await client.post("/api/v1/auth/login", json={"email": "admin@example.com",
                                                           "password": "AdminPassword123"})).json()
    r = await client.patch(f"/api/v1/admin/accounts/{dev['user']['id']}", json={"plan_code": "personal_pro"},
                           headers=bearer(admin["access_token"]))
    assert r.status_code == 200, r.text  # personal_pro leaves max_applications/devices/events unset
    codes = [(await client.post("/api/v1/applications", json={"name": f"App {i}"}, headers=h)).status_code
             for i in range(4)]
    assert codes == [201, 201, 201, 402]  # still the free developer plan's 3 applications


# ── Account-type isolation ───────────────────────────────────────────────────
async def test_personal_accounts_cannot_use_developer_platform(client: AsyncClient) -> None:
    p = await register_personal(client)
    dev = await register(client)
    created = await create_app(client, bearer(dev["access_token"]))
    app_id = created["application"]["id"]
    for method, path in (("GET", "/api/v1/applications"), ("POST", "/api/v1/applications"),
                         ("GET", f"/api/v1/applications/{app_id}"), ("GET", "/api/v1/api-keys"),
                         ("GET", "/api/v1/devices"), ("GET", "/api/v1/events"), ("GET", "/api/v1/deliveries"),
                         ("GET", "/api/v1/sandbox/endpoints"), ("POST", "/api/v1/sandbox/endpoints"),
                         ("GET", "/api/v1/usage"), ("GET", "/api/v1/overview"),
                         ("GET", f"/api/v1/live/applications/{app_id}"), ("GET", f"/api/v1/pairing-codes/{app_id}")):
        r = await client.request(method, path, headers=p["headers"], json={"name": "x"} if method == "POST" else None)
        assert r.status_code == 403 and r.json()["error"]["code"] == "account_type_not_allowed", (path, r.text)
        assert r.json()["error"]["ref"] == "NFC-1021"
    # Their own features keep working.
    for path in ("/api/v1/personal/cards", "/api/v1/notifications", "/api/v1/auth/me", "/api/v1/billing/subscription",
                 "/api/v1/request-logs"):  # own, user-scoped request logs stay visible (Part 4 §9)
        assert (await client.get(path, headers=p["headers"])).status_code == 200, path


async def test_business_accounts_use_workspace_apps_not_developer_apps(client: AsyncClient) -> None:
    owner = await register_business(client)
    h, bid = owner["headers"], owner["business_id"]
    r = await client.post("/api/v1/applications", json={"name": "Side project"}, headers=h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_type_not_allowed"
    r = await client.post("/api/v1/sandbox/endpoints", json={"name": "Mine"}, headers=h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_type_not_allowed"
    r = await client.post(f"/api/v1/sandbox/endpoints?business_id={bid}", json={"name": "Shop"}, headers=h)
    assert r.status_code == 201, r.text
    r = await client.post(f"/api/v1/businesses/{bid}/applications", json={"name": "POS"}, headers=h)
    assert r.status_code == 201, r.text
    app_id = r.json()["application"]["id"]
    for path in (f"/api/v1/applications/{app_id}", f"/api/v1/api-keys?application_id={app_id}",
                 f"/api/v1/devices?application_id={app_id}", f"/api/v1/events?application_id={app_id}",
                 f"/api/v1/deliveries?application_id={app_id}", f"/api/v1/request-logs?business_id={bid}",
                 f"/api/v1/sandbox/endpoints?business_id={bid}"):
        assert (await client.get(path, headers=h)).status_code == 200, path
    r = await client.post(f"/api/v1/applications/{app_id}/pairing-codes", json={}, headers=h)
    assert r.status_code == 201, r.text


# ── Digital-card invitations need a verified email ───────────────────────────
async def test_card_invite_cannot_be_taken_over_with_an_unverified_email(client: AsyncClient) -> None:
    from app.models import DigitalCardInvite
    from tests.p2_helpers import create_employee, token_from_url

    owner = await register_business(client)
    emp = await create_employee(client, owner, "Vic", "Tim")
    r = await client.post(f"/api/v1/businesses/{owner['business_id']}/employees/{emp['id']}/digital-card",
                          json={"email": "victim@example.com"}, headers=owner["headers"])
    assert r.status_code == 201, r.text
    squatter = await register_personal(client, "Mallory", email="victim@example.com")  # never verified
    assert (await client.get("/api/v1/personal/business-invites", headers=squatter["headers"])).json() == []
    async with SessionLocal() as s:
        invite_id = (await s.execute(select(DigitalCardInvite.id))).scalar_one()
    for action in ("accept", "decline"):
        r = await client.post(f"/api/v1/personal/business-invites/{invite_id}/{action}", headers=squatter["headers"])
        assert r.status_code == 403 and r.json()["error"]["code"] == "email_not_verified", r.text
    r = await client.post("/api/v1/auth/verify-email", json={"token": token_from_url(squatter["dev_verification_url"])})
    assert r.status_code == 204
    r = await client.post(f"/api/v1/personal/business-invites/{invite_id}/accept", headers=squatter["headers"])
    assert r.status_code == 200, r.text  # a verified owner of the address may accept


# ── Rate limiting ─────────────────────────────────────────────────────────────
def test_client_ip_uses_the_trusted_right_most_forwarded_hop(monkeypatch: Any) -> None:
    from starlette.requests import Request

    from app.core import rate_limit
    from app.core.config import settings

    def req(xff: str) -> Request:
        return Request({"type": "http", "headers": [(b"x-forwarded-for", xff.encode())], "client": ("10.0.0.9", 1)})

    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
    assert rate_limit.client_ip(req("6.6.6.6, 203.0.113.7")) == "203.0.113.7"  # left entry is client-supplied
    assert rate_limit.client_ip(req("203.0.113.7")) == "203.0.113.7"
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 2)
    assert rate_limit.client_ip(req("6.6.6.6, 203.0.113.7, 10.0.0.2")) == "203.0.113.7"
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", False)
    assert rate_limit.client_ip(req("6.6.6.6")) == "10.0.0.9"


async def test_random_bearer_tokens_still_hit_the_per_ip_ceiling(client: AsyncClient, monkeypatch: Any) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "RATE_LIMIT_REQUESTS", 3)
    monkeypatch.setattr(settings, "RATE_LIMIT_IP_MULTIPLIER", 2)
    codes = [(await client.get("/api/v1/device/config", headers=bearer(f"nfcd_{uuid.uuid4().hex}"))).status_code
             for _ in range(7)]
    assert codes == [401] * 6 + [429]
    codes = [(await client.get(f"/sandbox/{uuid.uuid4().hex[:24]}")).status_code for _ in range(2)]
    assert codes == [429, 429]


async def test_failed_logins_are_limited_per_email(client: AsyncClient, monkeypatch: Any) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "LOGIN_FAILURES_PER_EMAIL", 3)
    victim = await register_personal(client)
    other = await register(client, password="Sup3rSecretPass")
    for _ in range(3):
        r = await client.post("/api/v1/auth/login", json={"email": victim["email"], "password": "wrong-password"})
        assert r.status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": victim["email"], "password": "Sup3rSecretPass"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited" and "retry-after" in r.headers
    r = await client.post("/api/v1/personal/sessions", json={"email": victim["email"], "password": "Sup3rSecretPass"})
    assert r.status_code == 429  # the phone sign-in shares the per-email budget
    r = await client.post("/api/v1/auth/login", json={"email": other["user"]["email"], "password": "Sup3rSecretPass"})
    assert r.status_code == 200  # other accounts unaffected


# ── Webhook delivery connects to the vetted IP (no DNS rebinding) ────────────
async def test_delivery_pins_the_validated_ip(monkeypatch: Any) -> None:
    from app.core.config import settings
    from app.services import url_validation

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    answers = iter([["93.184.216.34"], ["10.0.0.5"]])  # a rebinding resolver: public first, private afterwards

    async def fake_resolve(host: str, port: int) -> list[str]:
        return next(answers)

    monkeypatch.setattr(url_validation, "_resolve", fake_resolve)
    with respx.mock(assert_all_called=True) as mock:
        route = mock.post("https://93.184.216.34/hook").mock(return_value=httpx.Response(200, text="ok"))
        result = await delivery.send_signed(url="https://hooks.example.com/hook", secret="whsec_x",
                                            payload=delivery.build_test_payload(uuid.uuid4()), timeout_seconds=5)
    assert result.success
    sent = route.calls[0].request
    assert sent.headers["host"] == "hooks.example.com" and sent.extensions["sni_hostname"] == "hooks.example.com"


def test_build_notification_links_to_the_admin_releases_page() -> None:
    import inspect

    assert 'link="/admin/releases"' in inspect.getsource(app_builds._notify_finished)


# ── Password change / reset signs phones out ─────────────────────────────────
async def test_password_change_revokes_personal_sessions(client: AsyncClient) -> None:
    p = await register_personal(client)
    phone = await phone_login(client, p)
    assert (await client.get("/api/v1/personal/cards", headers=phone["headers"])).status_code == 200
    r = await client.post("/api/v1/auth/change-password", headers=p["headers"],
                          json={"current_password": "Sup3rSecretPass", "new_password": "AnotherPass12345"})
    assert r.status_code == 204, r.text
    r = await client.get("/api/v1/personal/cards", headers=phone["headers"])
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_session_token"


async def test_password_reset_revokes_personal_sessions(client: AsyncClient) -> None:
    p = await register_personal(client)
    phone = await phone_login(client, p)
    token = generate_reset_token()
    async with SessionLocal() as s:
        s.add(PasswordResetToken(user_id=uuid.UUID(p["user"]["id"]), token_hash=sha256_hex(token),
                                 expires_at=datetime.now(UTC) + timedelta(minutes=30)))
        await s.commit()
    r = await client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "AnotherPass12345"})
    assert r.status_code == 204, r.text
    r = await client.get("/api/v1/personal/cards", headers=phone["headers"])
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_session_token"


# ── Team: no escalation through a granted team.manage ────────────────────────
async def _member_id(client: AsyncClient, owner: dict[str, Any], user_id: str) -> str:
    members = (await client.get(f"/api/v1/businesses/{owner['business_id']}/members", headers=owner["headers"])).json()
    return next(m["id"] for m in members if m["user_id"] == user_id)


async def test_team_manage_grant_cannot_escalate_above_own_role(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid = owner["business_id"]
    manager = await add_member(client, owner, "manager")
    staff = await add_member(client, owner, "staff")
    mid = await _member_id(client, owner, manager["user"]["id"])
    r = await client.patch(f"/api/v1/businesses/{bid}/members/{mid}", json={"extra_permissions": ["team.manage"]},
                           headers=owner["headers"])
    assert r.status_code == 200, r.text

    r = await client.post(f"/api/v1/businesses/{bid}/invitations", json={"email": "boss@example.com", "role": "admin"},
                          headers=manager["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "insufficient_permissions"
    r = await client.post(f"/api/v1/businesses/{bid}/invitations", json={"email": "help@example.com", "role": "staff"},
                          headers=manager["headers"])
    assert r.status_code == 201, r.text

    sid = await _member_id(client, owner, staff["user"]["id"])
    r = await client.patch(f"/api/v1/businesses/{bid}/members/{sid}", json={"role": "admin"}, headers=manager["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "insufficient_permissions"
    r = await client.patch(f"/api/v1/businesses/{bid}/members/{sid}", json={"extra_permissions": ["api.manage"]},
                           headers=manager["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "insufficient_permissions"
    r = await client.patch(f"/api/v1/businesses/{bid}/members/{sid}", json={"extra_permissions": ["cards.manage"]},
                           headers=manager["headers"])
    assert r.status_code == 200 and r.json()["extra_permissions"] == ["cards.manage"]
    # Admins still manage admins; owners manage everything.
    admin = await add_member(client, owner, "admin")
    r = await client.patch(f"/api/v1/businesses/{bid}/members/{sid}", json={"role": "admin"}, headers=admin["headers"])
    assert r.status_code == 200 and r.json()["role"] == "admin"


async def test_reactivating_a_member_respects_the_member_limit(client: AsyncClient) -> None:
    owner = await register_business(client)  # biz_starter: 5 members
    bid = owner["business_id"]
    first = await add_member(client, owner, "staff")
    for _ in range(3):
        await add_member(client, owner, "staff")
    fid = await _member_id(client, owner, first["user"]["id"])
    r = await client.patch(f"/api/v1/businesses/{bid}/members/{fid}", json={"status": "suspended"},
                           headers=owner["headers"])
    assert r.status_code == 200, r.text
    await add_member(client, owner, "staff")  # back to 5 active
    r = await client.patch(f"/api/v1/businesses/{bid}/members/{fid}", json={"status": "active"},
                           headers=owner["headers"])
    assert r.status_code == 402 and r.json()["error"]["code"] == "plan_limit_reached"


# ── Sandbox receiver can't serve HTML / set cookies on the API origin ───────
async def test_sandbox_response_headers_cannot_inject_content_type_or_cookies(client: AsyncClient) -> None:
    dev = await register(client)
    h = bearer(dev["access_token"])
    ep = (await client.get("/api/v1/sandbox/endpoints", headers=h)).json()[0]
    for bad in ({"Content-Type": "text/html"}, {"Set-Cookie": "sid=1"}, {"Access-Control-Allow-Origin": "*"},
                {"Location": "https://evil.example"}):
        r = await client.patch(f"/api/v1/sandbox/endpoints/{ep['id']}", json={"response_headers": bad}, headers=h)
        assert r.status_code == 422, (bad, r.text)
    r = await client.patch(f"/api/v1/sandbox/endpoints/{ep['id']}",
                           json={"response_headers": {"X-Sim": "1"}, "response_body": "<script>alert(1)</script>"},
                           headers=h)
    assert r.status_code == 200, r.text
    async with SessionLocal() as s:  # rows saved before the validation existed are filtered at serve time
        await s.execute(update(SandboxEndpoint).where(SandboxEndpoint.id == uuid.UUID(ep["id"])).values(
            response_headers={"Content-Type": "text/html", "Set-Cookie": "sid=1", "X-Sim": "1",
                              "X-Frame-Options": "ALLOWALL"}))
        await s.commit()
    r = await client.get(f"/sandbox/{ep['token']}")
    assert r.headers["content-type"].startswith("text/plain")
    assert "set-cookie" not in r.headers and r.headers["x-sim"] == "1" and r.headers["x-frame-options"] == "DENY"
    assert "sandbox" in r.headers["content-security-policy"] and r.headers["x-content-type-options"] == "nosniff"


# ── Analytics timeline uses the business's local "today" ─────────────────────
async def test_analytics_timeline_ends_on_the_business_local_day(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid = owner["business_id"]
    card = await create_card(client, owner)
    await client.get(f"/t/{card['public_code']}", headers={"User-Agent": BROWSER_UA})
    for tz in ("Pacific/Kiritimati", "Etc/GMT+12"):  # UTC+14 and UTC-12: one of them is always on another date
        r = await client.patch(f"/api/v1/businesses/{bid}", json={"settings": {"timezone": tz}},
                               headers=owner["headers"])
        assert r.status_code == 200, r.text
        data = (await client.get(f"/api/v1/businesses/{bid}/analytics?range=7d", headers=owner["headers"])).json()
        assert data["timeline"][-1]["date"] == datetime.now(zoneinfo.ZoneInfo(tz)).date().isoformat(), tz
        assert sum(d["taps"] for d in data["timeline"]) == data["totals"]["taps"] == 1, tz
        stats = (await client.get(f"/api/v1/businesses/{bid}/cards/{card['id']}/stats?range=7d",
                                  headers=owner["headers"])).json()
        assert sum(d["taps"] for d in stats["timeline"]) == stats["total_taps"] == 1, tz


# ── Digital-card counters are atomic ─────────────────────────────────────────
async def test_concurrent_leads_are_all_counted(client: AsyncClient) -> None:
    p = await register_personal(client)
    card = await primary(client, p["headers"])
    results = await asyncio.gather(*[
        client.post(f"/api/v1/public/p/{card['slug']}/leads", json={"full_name": f"Lead {i}", "email": f"l{i}@x.io"})
        for i in range(5)])
    assert [r.status_code for r in results] == [201] * 5
    assert (await primary(client, p["headers"]))["stats"]["leads"] == 5


# ── Relay events interrupted before their first attempt get delivered ────────
async def test_stuck_pending_relay_event_is_recovered(client: AsyncClient, user: dict, redis: Any) -> None:
    created = await create_app(client, user["headers"], endpoint_url="http://127.0.0.1:9/hook")
    app_id = created["application"]["id"]
    device = await register_device(client, created["api_key_plaintext"])
    event_id = uuid.uuid4()
    old = datetime.now(UTC) - timedelta(minutes=10)
    async with SessionLocal() as s:
        s.add(NfcEvent(id=event_id, application_id=uuid.UUID(app_id), device_id=uuid.UUID(device["device"]["id"]),
                       owner_id=uuid.UUID(user["user"]["id"]), event_type="card.detected", card_id="04A1B2C3",
                       card_technologies=[], delivery_mode="relay", status="pending", attempts=0, detected_at=old,
                       received_at=old))
        await s.commit()
    assert await delivery.recover_orphans(SessionLocal) == 1
    with respx.mock(assert_all_called=True) as mock:
        mock.post("http://127.0.0.1:9/hook").mock(return_value=httpx.Response(200, text="ok"))
        assert await delivery.process_due(SessionLocal) == 1
    async with SessionLocal() as s:
        ev = (await s.execute(select(NfcEvent).where(NfcEvent.id == event_id))).scalar_one()
        assert ev.status == "delivered" and ev.attempts == 1
    # A fresh pending event (first attempt still in flight) is left alone.
    async with SessionLocal() as s:
        s.add(NfcEvent(id=uuid.uuid4(), application_id=uuid.UUID(app_id), device_id=uuid.UUID(device["device"]["id"]),
                       owner_id=uuid.UUID(user["user"]["id"]), event_type="card.detected", card_id="04A1B2C4",
                       card_technologies=[], delivery_mode="relay", status="pending", attempts=0,
                       detected_at=datetime.now(UTC), received_at=datetime.now(UTC)))
        await s.commit()
    assert await delivery.recover_orphans(SessionLocal) == 0


# ── Image processing runs off the event loop ─────────────────────────────────
async def test_image_resizing_runs_in_a_worker_thread(client: AsyncClient, monkeypatch: Any) -> None:
    p = await register_personal(client)
    card = await primary(client, p["headers"])
    seen: list[bool] = []
    original = media.save_resized

    def spy(*args: Any, **kwargs: Any) -> str:
        seen.append(threading.current_thread() is threading.main_thread())
        return original(*args, **kwargs)

    monkeypatch.setattr(media, "save_resized", spy)
    buf = io.BytesIO()
    Image.new("RGB", (600, 600), (200, 30, 30)).save(buf, format="PNG")
    r = await client.post(f"/api/v1/personal/cards/{card['id']}/images?kind=photo", headers=p["headers"],
                          files={"file": ("p.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200, r.text
    assert seen == [False]


# ── APKs live outside the public media tree ──────────────────────────────────
async def test_release_apks_are_private_and_legacy_ones_are_moved(client: AsyncClient) -> None:
    rel = "releases/nextap-9.9.9-99-debug.apk"
    (app_builds.releases_root() / "nextap-9.9.9-99-debug.apk").unlink(missing_ok=True)
    legacy = media_root() / rel  # where builds used to be written (publicly served by /media)
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_bytes(b"PK\x03\x04 fake apk")
    (media_root() / "public-check.txt").write_text("ok")
    for path in (f"/media/{rel}", "/media/releases/../releases/nextap-9.9.9-99-debug.apk"):
        assert (await client.get(path)).status_code == 404, path
    assert app_builds.migrate_legacy_artifacts() == 1
    assert not legacy.exists() and (app_builds.releases_root() / "nextap-9.9.9-99-debug.apk").exists()
    assert not str(app_builds.releases_root()).startswith(str(media_root()))
    async with SessionLocal() as s:
        r = AppRelease(version_name="9.9.9", build_number=99, build_type="debug", channel="stable",
                       api_base_url="http://x", status="succeeded", artifact_path=rel, is_published=False)
        s.add(r)
        await s.commit()
        release_id = r.id
    assert (await client.get(f"/downloads/android/{release_id}")).status_code == 404  # unpublished
    async with SessionLocal() as s:
        await s.execute(update(AppRelease).where(AppRelease.id == release_id).values(is_published=True))
        await s.commit()
    dl = await client.get(f"/downloads/android/{release_id}")
    assert dl.status_code == 200 and dl.content == b"PK\x03\x04 fake apk"
    assert (await client.get(f"/media/{rel}")).status_code == 404
    assert (await client.get("/media/public-check.txt")).text == "ok"  # other media still served


# ── Links rendered on public pages must be http(s) ───────────────────────────
async def test_javascript_links_are_rejected(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid, h = owner["business_id"], owner["headers"]
    r = await client.post(f"/api/v1/businesses/{bid}/employees", headers=h, json={
        "first_name": "Eve", "last_name": "X", "social_links": [{"platform": "x", "url": "javascript:alert(1)"}]})
    assert r.status_code == 422
    r = await client.post(f"/api/v1/businesses/{bid}/employees", headers=h, json={
        "first_name": "Eve", "last_name": "X", "social_links": [{"platform": "x", "url": "https://x.com/eve"}]})
    assert r.status_code == 201, r.text
    for sections, theme in (([{"type": "social", "links": [{"platform": "x", "url": " JaVa\tscript:alert(1)"}]}], {}),
                            ([{"type": "gallery", "images": ["data:text/html,<script>1</script>"]}], {}),
                            ([], {"cover_image_url": "javascript:alert(1)"})):
        r = await client.post(f"/api/v1/businesses/{bid}/profiles", headers=h,
                              json={"type": "custom", "title": "Links", "sections": sections, "theme": theme})
        assert r.status_code == 422, (sections, theme, r.text)
    r = await client.post(f"/api/v1/businesses/{bid}/profiles", headers=h, json={
        "type": "custom", "title": "Links", "theme": {"cover_image_url": "https://img.example/c.jpg"},
        "sections": [{"type": "social", "links": [{"platform": "x", "url": "https://x.com/acme"}]},
                     {"type": "contact", "website": "acme.example.com", "email": "a@b.co"}]})
    assert r.status_code == 201, r.text
    r = await client.patch(f"/api/v1/businesses/{bid}", json={"website": "javascript:alert(1)"}, headers=h)
    assert r.status_code == 422


# ── vCard / CSV output hardening ─────────────────────────────────────────────
def test_vcard_escape_neutralises_carriage_returns() -> None:
    out = _vcard_escape("Eve\rTEL:+1555\r\nEMAIL:x@y.z\nNOTE:a;b,c")
    assert "\r" not in out and "\n" not in out
    assert out == "Eve\\nTEL:+1555\\nEMAIL:x@y.z\\nNOTE:a\\;b\\,c"


async def test_contacts_csv_guards_tab_prefixed_formulas(client: AsyncClient) -> None:
    p = await register_personal(client)
    r = await client.post("/api/v1/personal/contacts", headers=p["headers"],
                          json={"fields": {"full_name": "Tab Person"}, "notes": "\t=HYPERLINK(\"http://x\")"})
    assert r.status_code == 201, r.text
    csv_text = (await client.get("/api/v1/personal/contacts/export.csv", headers=p["headers"])).text
    row = list(csv.reader(io.StringIO(csv_text)))[1]
    assert row[8].startswith("'\t=")


# ── Final web review: filters the dashboard relies on ────────────────────────
async def test_events_can_be_filtered_by_logged_status(client: AsyncClient) -> None:
    dev = await register(client)
    r = await client.get("/api/v1/events", params={"status": "logged"}, headers=bearer(dev["access_token"]))
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


async def test_admin_account_filters_role_verification_and_plan(client: AsyncClient) -> None:
    admin = (await client.post("/api/v1/auth/login", json={"email": "admin@example.com",
                                                           "password": "AdminPassword123"})).json()
    ah = bearer(admin["access_token"])
    dev = await register(client)
    await client.patch(f"/api/v1/admin/accounts/{dev['user']['id']}", json={"plan_code": "pro"}, headers=ah)

    def emails(r: httpx.Response) -> set[str]:
        assert r.status_code == 200, r.text
        return {row["email"] for row in r.json()["items"]}

    admins = emails(await client.get("/api/v1/admin/accounts", params={"role": "admin"}, headers=ah))
    assert "admin@example.com" in admins and dev["user"]["email"] not in admins
    unverified = emails(await client.get("/api/v1/admin/accounts", params={"email_verified": "false"}, headers=ah))
    assert dev["user"]["email"] in unverified
    pro = emails(await client.get("/api/v1/admin/accounts", params={"plan_code": "pro"}, headers=ah))
    assert pro == {dev["user"]["email"]}
