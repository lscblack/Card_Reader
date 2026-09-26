"""Part 2 §A3 + §B: business registration, permissions, people, cards, actions, taps, profiles, team."""

from __future__ import annotations

import io
import json
import time
import uuid
from datetime import UTC, datetime

import httpx
import pytest
import respx
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import CardTap
from app.services import delivery as delivery_service
from app.services.permissions import ROLE_PERMISSIONS
from tests.conftest import bearer, create_app, register, register_device
from tests.p2_helpers import (
    ANDROID_UA,
    BOT_UA,
    BROWSER_UA,
    add_member,
    create_card,
    create_employee,
    pair_business_device,
    register_business,
    terminal_app_id,
    token_from_url,
)

WEB = "http://web.test"


# ── A3: registration, verification, categories, plans ─────────────────────
async def test_business_registration_creates_workspace(client: AsyncClient) -> None:
    owner = await register_business(client, verify=False)
    user = owner["user"]
    assert user["account_type"] == "business" and user["email_verified"] is False
    assert user["memberships"][0]["role"] == "owner" and user["memberships"][0]["business_name"] == "Acme Café"
    assert owner["dev_verification_url"].startswith(f"{WEB}/verify-email?token=")
    bid = owner["business_id"]

    r = await client.get(f"/api/v1/businesses/{bid}", headers=owner["headers"])
    b = r.json()
    assert b["slug"] == "acme-cafe" and b["verified"] is False and b["country"] == "RW" and b["status"] == "active"
    assert b["plan"]["code"] == "biz_starter" and b["plan"]["audience"] == "business"
    assert b["settings"] == {"devices_can_register_cards": True, "default_card_action": None, "timezone": "UTC"}

    apps = (await client.get(f"/api/v1/businesses/{bid}/applications", headers=owner["headers"])).json()
    assert [a["name"] for a in apps] == ["Business Terminal"] and apps[0]["delivery_mode"] == "relay"
    profiles = (await client.get(f"/api/v1/businesses/{bid}/profiles", headers=owner["headers"])).json()
    assert [p["type"] for p in profiles] == ["business"] and profiles[0]["published"] is True

    # Developer listings exclude business-owned rows
    assert (await client.get("/api/v1/applications", headers=owner["headers"])).json() == []

    # Verification: single use, verifies the workspace
    token = token_from_url(owner["dev_verification_url"])
    assert (await client.post("/api/v1/auth/verify-email", json={"token": token})).status_code == 204
    r = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_verification_token"
    assert r.json()["error"]["ref"] == "NFC-1015"
    me = (await client.get("/api/v1/auth/me", headers=owner["headers"])).json()
    assert me["email_verified"] is True and me["email_verified_at"]
    assert (await client.get(f"/api/v1/businesses/{bid}", headers=owner["headers"])).json()["verified"] is True


async def test_registration_validation_and_developer_default(client: AsyncClient) -> None:
    r = await client.post("/api/v1/auth/register", json={"email": "b@example.com", "password": "Sup3rSecretPass",
                                                         "full_name": "B", "account_type": "business"})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "body.business"
    r = await client.post("/api/v1/auth/register", json={
        "email": "b@example.com", "password": "Sup3rSecretPass", "full_name": "B", "account_type": "business",
        "business": {"name": "X Co", "email": "x@example.com", "phone": "+15551234", "country": "US", "category": "nope"}})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "body.business.category"

    dev = await register(client)
    assert dev["user"]["account_type"] == "developer" and dev["user"]["memberships"] == []
    assert dev["dev_verification_url"]
    r = await client.post("/api/v1/auth/resend-verification", headers=bearer(dev["access_token"]))
    assert r.status_code == 202 and r.json()["dev_verification_url"]


async def test_categories_and_public_plans(client: AsyncClient) -> None:
    cats = (await client.get("/api/v1/meta/business-categories")).json()
    codes = {c["code"] for c in cats}
    assert {"restaurant", "cafe", "retail", "other"} <= codes and all(c["label"] for c in cats)
    plans = {p["code"]: p for p in (await client.get("/api/v1/billing/plans")).json()}
    assert plans["free"]["audience"] == "developer"
    assert plans["biz_starter"]["audience"] == "business" and plans["biz_starter"]["price_monthly_cents"] == 0
    assert (plans["biz_starter"]["max_cards"], plans["biz_starter"]["max_devices"],
            plans["biz_starter"]["max_members"], plans["biz_starter"]["events_per_month"]) == (50, 3, 5, 10_000)
    assert (plans["biz_growth"]["price_monthly_cents"], plans["biz_growth"]["max_cards"]) == (4900, 1000)
    assert plans["biz_enterprise"]["max_cards"] is None and plans["biz_enterprise"]["max_devices"] is None
    only_biz = (await client.get("/api/v1/billing/plans?audience=business")).json()
    assert {p["audience"] for p in only_biz} == {"business"}


# ── B1: permission matrix ─────────────────────────────────────────────────
async def test_permissions_matrix_per_role(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid = owner["business_id"]
    members = {"owner": owner}
    for role in ("admin", "manager", "staff"):
        members[role] = await add_member(client, owner, role)

    for role, data in members.items():
        r = await client.get(f"/api/v1/businesses/{bid}/me", headers=data["headers"])
        assert r.json()["role"] == role
        expected = set(ROLE_PERMISSIONS[role]) | ({"api.view"} if "api.manage" in ROLE_PERMISSIONS[role] else set())
        assert set(r.json()["permissions"]) == expected

    base = f"/api/v1/businesses/{bid}"
    checks = [  # (method, path, body, permission, allowed roles)
        ("GET", f"{base}/cards", None, "business.view", {"owner", "admin", "manager", "staff"}),
        ("GET", f"{base}/employees", None, "business.view", {"owner", "admin", "manager", "staff"}),
        ("POST", f"{base}/cards", {"name": "C"}, "cards.manage", {"owner", "admin", "manager"}),
        ("POST", f"{base}/employees", {"first_name": "E"}, "people.manage", {"owner", "admin", "manager"}),
        ("POST", f"{base}/customers", {"full_name": "C"}, "people.manage", {"owner", "admin", "manager"}),
        ("POST", f"{base}/profiles", {"title": "Page"}, "profiles.manage", {"owner", "admin", "manager"}),
        ("GET", f"{base}/analytics", None, "analytics.view", {"owner", "admin", "manager"}),
        ("GET", f"{base}/applications", None, "api.view", {"owner", "admin"}),
        ("GET", f"{base}/api-usage", None, "api.view", {"owner", "admin"}),
        ("GET", f"/api/v1/request-logs?business_id={bid}", None, "api.view", {"owner", "admin"}),
        ("GET", f"/api/v1/sandbox/endpoints?business_id={bid}", None, "api.manage", {"owner", "admin"}),
        ("GET", f"{base}/invitations", None, "team.manage", {"owner", "admin"}),
        ("PATCH", base, {"description": "x"}, "settings.manage", {"owner", "admin"}),
    ]
    for method, path, body, perm, allowed in checks:
        for role, data in members.items():
            r = await client.request(method, path, json=body, headers=data["headers"])
            if role in allowed:
                assert r.status_code < 400, (role, path, r.text)
            else:
                assert r.status_code == 403, (role, path, r.status_code)
                err = r.json()["error"]
                assert err["code"] == "insufficient_permissions" and err["ref"] == "NFC-6003"
                assert err["details"] == {"required": perm}

    # Business apps: generalised authorisation on Part 1 endpoints
    app_id = await terminal_app_id(client, owner)
    for role, code in (("admin", 200), ("manager", 403), ("staff", 403)):
        r = await client.get(f"/api/v1/applications/{app_id}", headers=members[role]["headers"])
        assert r.status_code == code, role
    r = await client.post(f"/api/v1/applications/{app_id}/pairing-codes", json={}, headers=members["manager"]["headers"])
    assert r.status_code == 201  # devices.manage
    r = await client.post(f"/api/v1/applications/{app_id}/webhook-secret/rotate", headers=members["manager"]["headers"])
    assert r.status_code == 403  # api.manage

    # Owner-only: billing/delete; admin can't delete
    r = await client.delete(base, headers=members["admin"]["headers"])
    assert r.status_code == 403 and r.json()["error"]["details"] == {"required": "business.delete"}

    # Extra permissions: grant analytics.view to staff
    staff_member = next(m for m in (await client.get(f"{base}/members", headers=owner["headers"])).json()
                        if m["role"] == "staff")
    r = await client.patch(f"{base}/members/{staff_member['id']}", json={"extra_permissions": ["analytics.view"]},
                           headers=owner["headers"])
    assert r.status_code == 200 and "analytics.view" in r.json()["permissions"]
    assert (await client.get(f"{base}/analytics", headers=members["staff"]["headers"])).status_code == 200
    r = await client.patch(f"{base}/members/{staff_member['id']}", json={"extra_permissions": ["billing.manage"]},
                           headers=owner["headers"])
    assert r.status_code == 422

    # Non-members
    outsider = await register(client)
    r = await client.get(f"{base}/cards", headers=bearer(outsider["access_token"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_a_member"


# ── B3: employee deactivation ─────────────────────────────────────────────
async def test_employee_deactivation_disables_cards_and_profile(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid = owner["business_id"]
    emp = await create_employee(client, owner, "John", "Doe")
    assert emp["slug"] == "john-doe" and emp["profile_published"] is True
    card = await create_card(client, owner, name="John card", assignee_type="employee", assignee_id=emp["id"],
                             uid="04:aa:bb:cc")
    assert card["effective_status"] == "active" and card["assignee"]["name"] == "John Doe"
    assert card["uid"] == "04AABBCC" and card["uid_masked"].endswith("BBCC")
    assert (await client.get(f"/api/v1/public/b/{owner['slug']}/john-doe")).status_code == 200

    r = await client.post(f"/api/v1/businesses/{bid}/employees/{emp['id']}/deactivate", headers=owner["headers"])
    assert r.json()["status"] == "inactive" and r.json()["profile_published"] is False
    assert r.json()["cards"][0]["effective_status"] == "inactive_owner"
    c = (await client.get(f"/api/v1/businesses/{bid}/cards/{card['id']}", headers=owner["headers"])).json()
    assert c["effective_status"] == "inactive_owner" and c["status"] == "active"
    r = await client.get(f"/t/{card['public_code']}", headers={"User-Agent": BROWSER_UA})
    assert r.status_code == 302 and r.headers["location"] == f"{WEB}/tap/unavailable?reason=inactive"
    r = await client.get(f"/api/v1/public/b/{owner['slug']}/john-doe")
    assert r.status_code == 404 and r.json()["error"]["code"] == "profile_unavailable"

    await client.post(f"/api/v1/businesses/{bid}/employees/{emp['id']}/activate", headers=owner["headers"])
    c = (await client.get(f"/api/v1/businesses/{bid}/cards/{card['id']}", headers=owner["headers"])).json()
    assert c["effective_status"] == "active"
    assert (await client.get(f"/api/v1/public/b/{owner['slug']}/john-doe")).status_code == 200


async def test_people_crud_and_search(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    await create_employee(client, owner, "Alice", "Uwase", department="Ops")
    await create_employee(client, owner, "Bob", "Smith", department="Sales")
    r = await client.get(f"{base}/employees?q=alice", headers=owner["headers"])
    assert r.json()["total"] == 1 and r.json()["items"][0]["full_name"] == "Alice Uwase"
    r = await client.get(f"{base}/employees?department=Sales", headers=owner["headers"])
    assert [e["first_name"] for e in r.json()["items"]] == ["Bob"]
    dup = await create_employee(client, owner, "Alice", "Uwase")
    assert dup["slug"] == "alice-uwase-2"

    r = await client.post(f"{base}/customers", json={"full_name": "Eric N", "tags": ["vip", " "]}, headers=owner["headers"])
    cust = r.json()
    assert r.status_code == 201 and cust["tags"] == ["vip"]
    r = await client.patch(f"{base}/customers/{cust['id']}", json={"status": "inactive"}, headers=owner["headers"])
    assert r.json()["status"] == "inactive"
    assert (await client.delete(f"{base}/customers/{cust['id']}", headers=owner["headers"])).status_code == 204

    # Photo upload (PNG) and rejection of non-images
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    r = await client.post(f"{base}/employees/{dup['id']}/photo", files={"file": ("a.png", io.BytesIO(png), "image/png")},
                          headers=owner["headers"])
    assert r.status_code == 200 and r.json()["photo_url"].startswith("http://testserver/media/businesses/")
    served = await client.get(r.json()["photo_url"].replace("http://testserver", ""))
    assert served.status_code == 200 and served.content == png
    r = await client.post(f"{base}/logo", files={"file": ("a.txt", io.BytesIO(b"hello"), "text/plain")},
                          headers=owner["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_upload"
    r = await client.post(f"{base}/logo", files={"file": ("l.webp", io.BytesIO(b"RIFF0000WEBPVP8 " + b"0" * 20),
                                                          "image/webp")}, headers=owner["headers"])
    assert r.status_code == 200 and r.json()["logo_url"].endswith(".webp")


# ── B4/B5: cards, actions, tap resolution for every action type ──────────
async def test_card_rules(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    card = await create_card(client, owner, name="A", uid="04AABBCCDD")
    assert len(card["public_code"]) == 10 and card["tap_url"] == f"http://testserver/t/{card['public_code']}"
    assert card["effective_status"] == "unassigned" and card["programmed"] is False
    r = await client.post(f"{base}/cards", json={"name": "B", "uid": "04 aa bb cc dd"}, headers=owner["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_exists" and r.json()["error"]["ref"] == "NFC-6004"
    r = await client.post(f"{base}/cards", json={"name": "B", "uid": "XYZ"}, headers=owner["headers"])
    assert r.status_code == 422
    r = await client.post(f"{base}/cards", json={"name": "B", "action": {"type": "website", "config": {"url": "ftp://x"}}},
                          headers=owner["headers"])
    err = r.json()["error"]
    assert r.status_code == 422 and err["code"] == "invalid_action_config" and err["ref"] == "NFC-6010"
    assert err["details"][0]["field"] == "body.action.config.url"
    r = await client.post(f"{base}/cards", json={"name": "B", "action": {"type": "teleport"}}, headers=owner["headers"])
    assert r.json()["error"]["details"][0]["field"] == "body.action.type"

    emp = await create_employee(client, owner)
    r = await client.post(f"{base}/cards/{card['id']}/assign", json={"assignee_type": "employee", "assignee_id": emp["id"]},
                          headers=owner["headers"])
    assert r.json()["effective_status"] == "active"
    r = await client.post(f"{base}/cards/{card['id']}/deactivate", headers=owner["headers"])
    assert r.json()["effective_status"] == "inactive"
    await client.post(f"{base}/cards/{card['id']}/activate", headers=owner["headers"])
    await client.post(f"{base}/cards/{card['id']}/unassign", headers=owner["headers"])
    hist = (await client.get(f"{base}/cards/{card['id']}/history", headers=owner["headers"])).json()
    assert [h["type"] for h in reversed(hist)] == ["created", "assigned", "deactivated", "activated", "unassigned"]
    assert hist[0]["actor"]["name"] == "Owner One"

    r = await client.post(f"{base}/cards/bulk", json={"count": 3, "kind": "tag", "name_prefix": "Table"},
                          headers=owner["headers"])
    assert r.status_code == 201 and [c["name"] for c in r.json()["items"]] == ["Table 1", "Table 2", "Table 3"]
    r = await client.get(f"{base}/cards?kind=tag&programmed=false", headers=owner["headers"])
    assert r.json()["total"] == 3
    r = await client.post(f"{base}/cards/bulk", json={"count": 47, "kind": "card"}, headers=owner["headers"])
    assert r.status_code == 402 and r.json()["error"]["details"]["limit"] == "cards"
    assert r.json()["error"]["ref"] == "NFC-7001"


async def _card_with_action(client: AsyncClient, owner: dict, action: dict, **extra) -> dict:  # type: ignore[type-arg]
    return await create_card(client, owner, name=f"{action['type']} card", action=action, **extra)


async def _tap(client: AsyncClient, card: dict, ua: str = BROWSER_UA, ip: str | None = None) -> httpx.Response:  # type: ignore[type-arg]
    headers = {"User-Agent": ua}
    if ip:
        headers["X-Forwarded-For"] = ip
    return await client.get(f"/t/{card['public_code']}", headers=headers)


async def test_tap_resolution_every_action_type(client: AsyncClient, redis) -> None:  # type: ignore[no-untyped-def]
    owner = await register_business(client)
    bid, slug = owner["business_id"], owner["slug"]
    base = f"/api/v1/businesses/{bid}"
    emp = await create_employee(client, owner, "John", "Doe", phone="+250788000222", email="john@example.com")
    r = await client.post(f"{base}/profiles", json={"type": "menu", "title": "Lunch Menu", "published": True,
                                                    "sections": [{"type": "menu", "categories": []}]},
                          headers=owner["headers"])
    menu = r.json()
    assert menu["slug"] == "lunch-menu" and menu["public_url"] == f"{WEB}/b/{slug}/lunch-menu"

    cases = [
        ({"type": "website", "config": {"url": "https://acme.example.com/menu"}}, 302, "https://acme.example.com/menu"),
        ({"type": "custom_url", "config": {"url": "https://book.example.com"}}, 302, "https://book.example.com"),
        ({"type": "business_profile", "config": {}}, 302, f"{WEB}/b/{slug}"),
        ({"type": "employee_profile", "config": {"employee_id": emp["id"]}}, 302, f"{WEB}/b/{slug}/john-doe"),
        ({"type": "profile", "config": {"profile_id": menu["id"]}}, 302, f"{WEB}/b/{slug}/lunch-menu"),
        ({"type": "whatsapp", "config": {"phone": "+250788000111", "message": "Hi there"}}, 302,
         "https://wa.me/250788000111?text=Hi+there"),
        ({"type": "maps", "config": {"query": "KN 4 Ave"}}, 302,
         "https://www.google.com/maps/search/?api=1&query=KN+4+Ave"),
        ({"type": "maps", "config": {"lat": -1.95, "lng": 30.06}}, 302,
         "https://www.google.com/maps/search/?api=1&query=-1.95%2C30.06"),
        ({"type": "social", "config": {"platform": "instagram", "url": "https://instagram.com/acme"}}, 302,
         "https://instagram.com/acme"),
        ({"type": "digital_menu", "config": {"profile_id": menu["id"]}}, 302, f"{WEB}/b/{slug}/lunch-menu"),
        ({"type": "product_info", "config": {"url": "https://shop.example.com/p/1"}}, 302, "https://shop.example.com/p/1"),
    ]
    for action, status, location in cases:
        card = await _card_with_action(client, owner, action)
        r = await _tap(client, card)
        assert r.status_code == status, action
        assert r.headers["location"] == location, (action, r.headers.get("location"))

    # share_contact → vCard (assignee)
    card = await _card_with_action(client, owner, {"type": "share_contact", "config": {}},
                                   assignee_type="employee", assignee_id=emp["id"])
    r = await _tap(client, card)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/vcard")
    assert "FN:John Doe" in r.text and "TEL;TYPE=CELL:+250788000222" in r.text
    # phone_call → page with tel: button
    card = await _card_with_action(client, owner, {"type": "phone_call", "config": {"phone": "+250 788 000 111"}})
    r = await _tap(client, card)
    assert r.status_code == 200 and "text/html" in r.headers["content-type"] and "tel:+250788000111" in r.text
    # email → page that opens the mail app
    card = await _card_with_action(client, owner, {"type": "email", "config": {"to": "hi@acme.example.com",
                                                                               "subject": "Hello"}})
    r = await _tap(client, card)
    assert r.status_code == 200 and 'mailto:hi@acme.example.com?subject=Hello' in r.text
    # wifi → web page + public data endpoint
    card = await _card_with_action(client, owner, {"type": "wifi", "config": {"ssid": "Acme-Guest", "password": "coffee123",
                                                                              "security": "WPA"}})
    r = await _tap(client, card)
    assert r.headers["location"] == f"{WEB}/w/{card['public_code']}"
    w = (await client.get(f"/api/v1/public/w/{card['public_code']}")).json()
    assert w["ssid"] == "Acme-Guest" and w["password"] == "coffee123" and w["wifi_qr"] == "WIFI:T:WPA;S:Acme-Guest;P:coffee123;;"
    # no action → business default action (settings) → business profile
    plain = await create_card(client, owner, name="Plain")
    assert (await _tap(client, plain)).headers["location"] == f"{WEB}/b/{slug}"
    r = await client.patch(f"/api/v1/businesses/{bid}", json={"settings": {"default_card_action": {
        "type": "website", "config": {"url": "https://acme.example.com"}}}}, headers=owner["headers"])
    assert r.status_code == 200, r.text
    assert (await _tap(client, plain)).headers["location"] == "https://acme.example.com"

    # developer_webhook → signed card.tapped through the existing pipeline, then the `then` action
    app_id = await terminal_app_id(client, owner)
    await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": "https://hooks.example.com/nfc", "enabled": True},
                     headers=owner["headers"])
    card = await _card_with_action(client, owner, {"type": "developer_webhook", "config": {
        "application_id": app_id, "then": {"type": "website", "config": {"url": "https://acme.example.com/thanks"}}}},
        assignee_type="employee", assignee_id=emp["id"])
    r = await _tap(client, card)
    assert r.status_code == 302 and r.headers["location"] == "https://acme.example.com/thanks"
    with respx.mock() as mock:
        route = mock.post("https://hooks.example.com/nfc").mock(return_value=httpx.Response(200))
        assert await delivery_service.process_due(SessionLocal, now=time.time() + 1) == 1
    payload = json.loads(route.calls[0].request.content)
    assert payload["event"] == "card.tapped" and payload["device_id"] is None
    assert payload["tap"]["card"]["id"] == card["id"] and payload["tap"]["assignee"]["name"] == "John Doe"
    assert payload["security"] == {"authenticated": False, "level": "uid_only"}
    assert route.calls[0].request.headers["X-NFC-Signature"].startswith("v1=")
    # a bot (link preview) must not fire the webhook
    await _tap(client, card, ua=BOT_UA)
    assert await redis.zcard(delivery_service.QUEUE_KEY) == 0

    # preview endpoint
    r = await client.post(f"{base}/actions/preview", json={"action": {"type": "whatsapp", "config": {"phone": "+15551234567"}}},
                          headers=owner["headers"])
    assert r.json() == {"resolved_url": "https://wa.me/15551234567", "kind": "redirect"}
    types = {t["type"] for t in (await client.get("/api/v1/actions/types")).json()}
    assert {"website", "wifi", "developer_webhook", "share_contact", "phone_call"} <= types

    # unknown code → neutral page
    r = await client.get("/t/doesnotexist", headers={"User-Agent": BROWSER_UA})
    assert r.headers["location"] == f"{WEB}/tap/unavailable?reason=unknown"


async def test_unique_visitors_and_bot_exclusion(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    card = await create_card(client, owner, name="Counter")
    for ua, ip in ((BROWSER_UA, "203.0.113.5"), (BROWSER_UA, "203.0.113.5"), (ANDROID_UA, "203.0.113.5"),
                   (BROWSER_UA, "198.51.100.7"), (BOT_UA, "66.249.66.1")):
        await _tap(client, card, ua, ip)
    c = (await client.get(f"{base}/cards/{card['id']}", headers=owner["headers"])).json()
    assert c["total_taps"] == 4 and c["unique_visitors"] == 3  # bot excluded; repeat visitor counted once
    taps = (await client.get(f"{base}/taps?card_id={card['id']}", headers=owner["headers"])).json()
    assert taps["total"] == 5 and sum(t["is_bot"] for t in taps["items"]) == 1
    assert all(t["visitor_hash"] is None for t in taps["items"] if t["is_bot"])
    assert {t["device_type"] for t in taps["items"] if not t["is_bot"]} == {"ios", "android"}
    async with SessionLocal() as s:  # no raw IPs stored anywhere on taps
        rows = (await s.execute(select(CardTap))).scalars().all()
        assert all("203.0.113" not in json.dumps({k: str(v) for k, v in r.__dict__.items()}) for r in rows)

    a = (await client.get(f"{base}/analytics?range=7d", headers=owner["headers"])).json()
    assert a["totals"]["taps"] == 4 and a["totals"]["unique_visitors"] == 3 and a["totals"]["web_taps"] == 4
    assert a["by_card"] == [{"card_id": card["id"], "name": "Counter", "taps": 4}]
    assert sum(d["taps"] for d in a["timeline"]) == 4 and len(a["timeline"]) == 7 and len(a["by_hour"]) == 24
    assert a["previous_period_totals"]["taps"] == 0 and a["last_activity"]["card_id"] == card["id"]
    s = (await client.get(f"{base}/cards/{card['id']}/stats?range=7d", headers=owner["headers"])).json()
    assert s["total_taps"] == 4 and s["unique_visitors"] == 3
    ov = (await client.get(f"{base}/overview", headers=owner["headers"])).json()
    assert ov["taps_today"] == 4 and ov["checklist"]["first_card"] is True


# ── B6: public profile availability ───────────────────────────────────────
async def test_public_profile_availability_rules(client: AsyncClient) -> None:
    owner = await register_business(client, verify=False)
    slug, bid = owner["slug"], owner["business_id"]
    r = await client.get(f"/api/v1/public/b/{slug}")
    assert r.status_code == 404 and r.json()["error"]["details"] == {"reason": "unverified"}
    card = await create_card(client, owner, name="Card")
    assert (await _tap(client, card)).headers["location"] == f"{WEB}/tap/unavailable?reason=unverified"

    await client.post("/api/v1/auth/verify-email", json={"token": token_from_url(owner["dev_verification_url"])})
    r = await client.get(f"/api/v1/public/b/{slug}")
    assert r.status_code == 200 and r.headers["cache-control"] == "public, max-age=60"
    body = r.json()
    assert body["business"]["name"] == "Acme Café" and body["business"]["verified"] is True
    assert body["profile"]["type"] == "business" and body["vcard_url"].endswith(f"/public/b/{slug}/vcard")
    v = await client.get(f"/api/v1/public/b/{slug}/vcard")
    assert v.headers["content-type"].startswith("text/vcard") and "ORG:Acme Café" in v.text

    profile_id = body["profile"]["id"]
    await client.post(f"/api/v1/businesses/{bid}/profiles/{profile_id}/unpublish", headers=owner["headers"])
    r = await client.get(f"/api/v1/public/b/{slug}")
    assert r.status_code == 404 and r.json()["error"]["details"]["reason"] == "unpublished"
    await client.post(f"/api/v1/businesses/{bid}/profiles/{profile_id}/publish", headers=owner["headers"])

    # Slug change keeps the old slug working
    r = await client.patch(f"/api/v1/businesses/{bid}", json={"slug": "acme-coffee"}, headers=owner["headers"])
    assert r.json()["slug"] == "acme-coffee"
    r = await client.get(f"/api/v1/public/b/{slug}")
    assert r.status_code == 200 and r.json()["business"]["slug"] == "acme-coffee"
    other = await register_business(client, name="Other Biz")
    r = await client.patch(f"/api/v1/businesses/{other['business_id']}", json={"slug": slug}, headers=other["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "slug_taken"

    # Suspension (admin) → neutral pages
    admin = (await client.post("/api/v1/auth/login", json={"email": "admin@example.com",
                                                           "password": "AdminPassword123"})).json()
    r = await client.patch(f"/api/v1/admin/businesses/{bid}", json={"status": "suspended"},
                           headers=bearer(admin["access_token"]))
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    assert (await client.get("/api/v1/public/b/acme-coffee")).json()["error"]["details"]["reason"] == "suspended"
    assert (await _tap(client, card)).headers["location"].endswith("reason=suspended")
    c = (await client.get(f"/api/v1/businesses/{bid}/cards/{card['id']}", headers=owner["headers"])).json()
    assert c["effective_status"] == "business_suspended"


# ── B9: team & invitations ─────────────────────────────────────────────────
async def test_invitation_flow_and_last_owner(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    r = await client.post(f"{base}/invitations", json={"email": "Mgr@Example.com", "role": "manager"}, headers=owner["headers"])
    inv = r.json()
    assert r.status_code == 201 and inv["status"] == "pending" and inv["dev_invite_url"].startswith(f"{WEB}/invite/")
    token = token_from_url(inv["dev_invite_url"])
    r = await client.post(f"{base}/invitations", json={"email": "mgr@example.com", "role": "staff"}, headers=owner["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "invitation_exists"
    pub = (await client.get(f"/api/v1/invitations/{token}")).json()
    assert pub == {"business_name": "Acme Café", "role": "manager", "email": "mgr@example.com",
                   "expires_at": pub["expires_at"], "status": "pending"}

    wrong = await register(client, email="someone@example.com")
    r = await client.post(f"/api/v1/invitations/{token}/accept", headers=bearer(wrong["access_token"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "invitation_email_mismatch"
    mgr = await register(client, email="mgr@example.com")
    r = await client.post(f"/api/v1/invitations/{token}/accept", headers=bearer(mgr["access_token"]))
    assert r.status_code == 200 and r.json()["role"] == "manager"
    assert r.json()["business_id"] == owner["business_id"]  # the web redirects to the joined business
    r = await client.post(f"/api/v1/invitations/{token}/accept", headers=bearer(mgr["access_token"]))
    assert r.status_code == 410 and r.json()["error"]["code"] == "invitation_unavailable"
    assert (await client.get(f"/api/v1/invitations/{token}")).json()["status"] == "accepted"

    # revoke
    r = await client.post(f"{base}/invitations", json={"email": "gone@example.com", "role": "staff"}, headers=owner["headers"])
    gone_token = token_from_url(r.json()["dev_invite_url"])
    await client.post(f"{base}/invitations/{r.json()['id']}/revoke", headers=owner["headers"])
    assert (await client.get(f"/api/v1/invitations/{gone_token}")).json()["status"] == "revoked"
    r = await client.post("/api/v1/auth/register", json={"email": "gone@example.com", "password": "Sup3rSecretPass",
                                                         "full_name": "G", "invite_token": gone_token})
    assert r.status_code == 410

    members = (await client.get(f"{base}/members", headers=owner["headers"])).json()
    me = next(m for m in members if m["role"] == "owner")
    r = await client.patch(f"{base}/members/{me['id']}", json={"role": "admin"}, headers=owner["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "cannot_edit_own_role"
    r = await client.delete(f"{base}/members/{me['id']}", headers=owner["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "last_owner" and r.json()["error"]["ref"] == "NFC-6005"

    admin = await add_member(client, owner, "admin")
    r = await client.post(f"{base}/invitations", json={"email": "own2@example.com", "role": "owner"}, headers=admin["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "owner_required"
    r = await client.patch(f"{base}/members/{me['id']}", json={"status": "suspended"}, headers=admin["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "owner_required"

    # second owner → first owner may leave; the remaining sole owner may not be demoted
    owner2 = await add_member(client, owner, "owner")
    members = (await client.get(f"{base}/members", headers=owner["headers"])).json()
    o2 = next(m for m in members if m["user_id"] == owner2["user"]["id"])
    assert (await client.delete(f"{base}/members/{me['id']}", headers=owner["headers"])).status_code == 204
    r = await client.patch(f"{base}/members/{o2['id']}", json={"role": "admin"}, headers=owner2["headers"])
    assert r.status_code == 403  # own role
    r = await client.get(f"{base}/cards", headers=owner["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_a_member"


# ── C1–C3: business devices ────────────────────────────────────────────────
async def test_business_device_config_and_event_block(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    emp = await create_employee(client, owner, "John", "Doe")
    dev = await pair_business_device(client, owner)
    cfg = dev["config"]
    assert cfg["account_type"] == "business" and cfg["business"]["slug"] == owner["slug"]
    assert cfg["capabilities"] == ["cards.register", "cards.program"] and cfg["assigned_employee"] is None
    assert dev["device"]["name"] == "Counter"

    r = await client.patch(f"{base}/devices/{dev['device']['id']}", json={"assigned_employee_id": emp["id"]},
                           headers=owner["headers"])
    assert r.json()["assigned_employee"]["name"] == "John Doe" and r.json()["online"] is True
    cfg = (await client.get("/api/v1/device/config", headers=dev["headers"])).json()
    assert cfg["assigned_employee"] == {"id": emp["id"], "name": "John Doe"}

    card = await create_card(client, owner, name="John card", uid="04A1B2C3D4E5", assignee_type="employee",
                             assignee_id=emp["id"], action={"type": "website", "config": {"url": "https://acme.example.com"}})

    def ev(uid: str) -> dict:  # type: ignore[type-arg]
        return {"event_id": str(uuid.uuid4()), "card_id": uid, "detected_at": datetime.now(UTC).isoformat()}

    body = ev("04:a1:b2:c3:d4:e5")
    r = await client.post("/api/v1/device/events", json=body, headers=dev["headers"])
    res = r.json()
    assert r.status_code == 200 and res["status"] == "logged"  # no endpoint configured: not an error
    b = res["business"]
    assert b["result"] == "recognized" and b["card"]["id"] == card["id"] and b["card"]["effective_status"] == "active"
    assert b["assignee"]["name"] == "John Doe" and b["assignee"]["position"] == "Sales Manager"
    assert b["action"] == {"type": "website", "label": None, "url": "https://acme.example.com"}
    assert b["message"] == "John Doe · Sales Manager"
    replay = (await client.post("/api/v1/device/events", json=body, headers=dev["headers"])).json()
    assert replay["business"]["result"] == "recognized" and replay["status"] == "logged"

    unknown = (await client.post("/api/v1/device/events", json=ev("04FFEEDDCC"), headers=dev["headers"])).json()
    assert unknown["business"] == {"result": "unknown_card", "card": None, "assignee": None, "action": None,
                                   "message": "Unknown card"}
    await client.post(f"{base}/employees/{emp['id']}/deactivate", headers=owner["headers"])
    inactive = (await client.post("/api/v1/device/events", json=ev("04A1B2C3D4E5"), headers=dev["headers"])).json()
    assert inactive["business"]["result"] == "inactive" and inactive["business"]["card"]["effective_status"] == "inactive_owner"

    taps = (await client.get(f"{base}/taps?source=reader", headers=owner["headers"])).json()
    assert taps["total"] == 3 and {t["result"] for t in taps["items"]} == {"redirected", "unknown_card", "inactive"}
    assert all(t["device_name"] == "Counter" for t in taps["items"])
    devices = (await client.get(f"{base}/devices", headers=owner["headers"])).json()
    assert devices[0]["last_scan_at"] is not None
    act = (await client.get(f"{base}/devices/{dev['device']['id']}/activity", headers=owner["headers"])).json()
    assert len(act["taps"]) == 3

    # With an endpoint the business event is relayed like any other
    await client.put(f"/api/v1/applications/{dev['app_id']}/endpoint", json={"url": "https://hooks.example.com/t",
                                                                              "enabled": True}, headers=owner["headers"])
    with respx.mock() as mock:
        mock.post("https://hooks.example.com/t").mock(return_value=httpx.Response(500))
        res = (await client.post("/api/v1/device/events", json=ev("04A1B2C3D4E5"), headers=dev["headers"])).json()
    assert res["status"] == "retrying" and res["error_code"] == "delivery_http_5xx" and res["error_ref"] == "NFC-5006"
    assert "business" in res

    # Developer listings never show business rows; developer device responses have no `business` key
    assert (await client.get("/api/v1/devices", headers=owner["headers"])).json() == []
    assert (await client.get("/api/v1/events", headers=owner["headers"])).json()["total"] == 0
    dev_user = await register(client)
    h = bearer(dev_user["access_token"])
    dev_app = await create_app(client, h)
    dd = await register_device(client, dev_app["api_key_plaintext"])
    assert dd["config"]["account_type"] == "developer" and dd["config"]["business"] is None
    assert dd["config"]["capabilities"] == []
    res = (await client.post("/api/v1/device/events", json=ev("04AABB"), headers=bearer(dd["device_token"]))).json()
    assert "business" not in res
    r = await client.get("/api/v1/device/business/cards", headers=bearer(dd["device_token"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "device_not_business"


async def test_device_card_register_and_programming_conflicts(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    dev = await pair_business_device(client, owner)
    blank_a = await create_card(client, owner, name="Blank A")
    blank_b = await create_card(client, owner, name="Blank B")
    bound = await create_card(client, owner, name="Bound", uid="04CCCCCCCC")

    r = await client.get("/api/v1/device/business/cards?programmed=false", headers=dev["headers"])
    page = r.json()
    assert set(page) == {"items", "total", "page", "page_size"} and page["total"] == 3
    assert page["items"][0]["tap_url"].startswith("http://testserver/t/")

    r = await client.post(f"/api/v1/device/business/cards/{blank_a['id']}/programmed", json={"uid": "04:AA:AA:AA"},
                          headers=dev["headers"])
    assert r.status_code == 200 and r.json()["programmed"] is True and r.json()["uid"] == "04AAAAAA"
    r = await client.post(f"/api/v1/device/business/cards/{blank_b['id']}/programmed", json={"uid": "04AAAAAA"},
                          headers=dev["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_exists"
    r = await client.post(f"/api/v1/device/business/cards/{bound['id']}/programmed", json={"uid": "04DDDDDDDD"},
                          headers=dev["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_mismatch"
    r = await client.post(f"/api/v1/device/business/cards/{bound['id']}/programmed", json={"uid": "04CCCCCCCC"},
                          headers=dev["headers"])
    assert r.status_code == 200
    hist = (await client.get(f"{base}/cards/{blank_a['id']}/history", headers=owner["headers"])).json()
    assert hist[0]["type"] == "programmed" and hist[0]["actor"]["type"] == "device"

    # unknown card → register it from the device
    r = await client.post("/api/v1/device/business/cards", json={"uid": "04EEEEEEEE", "name": "New", "kind": "tag"},
                          headers=dev["headers"])
    assert r.status_code == 201 and r.json()["kind"] == "tag"
    r = await client.post("/api/v1/device/business/cards", json={"uid": "04EEEEEEEE"}, headers=dev["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_exists"

    # capability switched off
    await client.patch(base, json={"settings": {"devices_can_register_cards": False}}, headers=owner["headers"])
    cfg = (await client.get("/api/v1/device/config", headers=dev["headers"])).json()
    assert cfg["capabilities"] == []
    r = await client.post("/api/v1/device/business/cards", json={"uid": "04ABABABAB"}, headers=dev["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "device_capability_missing"
    assert r.json()["error"]["ref"] == "NFC-4001"


async def test_business_billing_limits_and_suspended_devices(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    devices = [await pair_business_device(client, owner) for _ in range(3)]
    app_id = await terminal_app_id(client, owner)
    r = await client.post(f"/api/v1/applications/{app_id}/pairing-codes", json={}, headers=owner["headers"])
    r = await client.post("/api/v1/device/register", headers=bearer(r.json()["code"]),
                          json={"device_name": "4th", "installation_id": str(uuid.uuid4())})
    assert r.status_code == 402 and r.json()["error"]["details"]["limit"] == "devices"
    bill = (await client.get(f"{base}/billing", headers=owner["headers"])).json()
    assert bill["usage"]["devices"] == 3 and bill["limits"]["devices"] == 3 and bill["plan"]["code"] == "biz_starter"
    assert bill["usage"]["members"] == 1 and bill["status"] == "active"

    admin = (await client.post("/api/v1/auth/login", json={"email": "admin@example.com",
                                                           "password": "AdminPassword123"})).json()
    await client.patch(f"/api/v1/admin/businesses/{owner['business_id']}", json={"status": "suspended"},
                       headers=bearer(admin["access_token"]))
    r = await client.get("/api/v1/device/config", headers=devices[0]["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "business_suspended"
    assert r.json()["error"]["ref"] == "NFC-6002"
    await client.patch(f"/api/v1/admin/businesses/{owner['business_id']}", json={"status": "active",
                                                                                 "plan_code": "biz_growth"},
                       headers=bearer(admin["access_token"]))
    assert (await client.get("/api/v1/device/config", headers=devices[0]["headers"])).status_code == 200
    bill = (await client.get(f"{base}/billing", headers=owner["headers"])).json()
    assert bill["plan"]["code"] == "biz_growth" and bill["limits"]["devices"] == 25

    # business owner deletes the workspace → devices revoked
    assert (await client.delete(base, headers=owner["headers"])).status_code == 204
    r = await client.get("/api/v1/device/config", headers=devices[1]["headers"])
    assert r.status_code == 401 and r.json()["error"]["code"] == "device_revoked"
