"""Part 3 §1–§2: branding, SVG sanitiser, plans, promotions (+ business apps, slug check, auth rate-limit fix)."""

from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.models import Plan, Promotion
from app.services import promotions
from app.services.branding import contrast_ratio
from app.services.svg_sanitizer import InvalidSVG, sanitize_svg
from tests.conftest import bearer
from tests.p2_helpers import add_member, register_business

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


async def _admin(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    return bearer(r.json()["access_token"])


# ══ Branding ═══════════════════════════════════════════════════════════════
async def test_branding_defaults_etag_and_fonts(client: AsyncClient) -> None:
    r = await client.get("/api/v1/meta/branding")
    b = r.json()
    assert r.status_code == 200 and r.headers["cache-control"] == "public, max-age=60" and r.headers["etag"]
    assert b["product_name"] == "NFC Platform" and b["logo_url"] is None
    assert b["theme"] == {"accent_light": "#B91C1C", "accent_dark": "#E5484D", "default_mode": "dark"}
    assert b["fonts"] == {"heading": "Inter", "body": "Inter", "mono": "JetBrains Mono"}
    r2 = await client.get("/api/v1/meta/branding", headers={"If-None-Match": r.headers["etag"]})
    assert r2.status_code == 304
    fonts = (await client.get("/api/v1/meta/fonts")).json()
    families = {f["family"] for f in fonts}
    assert {"Inter", "Manrope", "Playfair Display", "JetBrains Mono", "Fira Code"} <= families
    assert all(f["google"] is True and f["category"] in ("sans", "serif", "mono", "display") for f in fonts)


async def test_branding_patch_validation_and_contrast(client: AsyncClient, user: dict) -> None:
    admin = await _admin(client)
    assert contrast_ratio("#B91C1C", "#FFFFFF") > 3 and contrast_ratio("#FFFF00", "#FFFFFF") < 3
    r = await client.patch("/api/v1/admin/branding", json={"product_name": "TapCloud", "tagline": "Tap anything",
                                                           "fonts": {"heading": "Sora", "mono": "Fira Code"},
                                                           "theme": {"accent_light": "#1d4ed8", "default_mode": "light"},
                                                           "support_email": "help@tapcloud.example.com",
                                                           "company_address": "1 Main St, Kigali",
                                                           "social_links": [{"platform": "X", "url": "https://x.com/tap"}]},
                           headers=admin)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["product_name"] == "TapCloud" and b["fonts"] == {"heading": "Sora", "body": "Inter", "mono": "Fira Code"}
    assert b["theme"]["accent_light"] == "#1D4ED8" and b["theme"]["default_mode"] == "light" and b["updated_at"]
    old_etag = (await client.get("/api/v1/meta/branding")).headers["etag"]
    assert (await client.get("/api/v1/meta/branding")).json()["product_name"] == "TapCloud"

    for theme, field in (({"accent_light": "#FFFF00"}, "body.theme.accent_light"),
                         ({"accent_dark": "#101010"}, "body.theme.accent_dark")):
        r = await client.patch("/api/v1/admin/branding", json={"theme": theme}, headers=admin)
        err = r.json()["error"]
        assert r.status_code == 422 and err["code"] == "branding_low_contrast" and err["ref"] == "NFC-8201"
        assert err["details"][0]["field"] == field and err["details"][0]["contrast"] < 3
    for body in ({"theme": {"accent_light": "red"}}, {"fonts": {"heading": "Comic Sans MS"}},
                 {"fonts": {"mono": "Inter"}}, {"theme": {"default_mode": "neon"}}, {"product_name": ""},
                 {"social_links": [{"platform": "x", "url": "javascript:alert(1)"}]}):
        r = await client.patch("/api/v1/admin/branding", json=body, headers=admin)
        assert r.status_code == 422, body
    assert (await client.get("/api/v1/meta/branding")).headers["etag"] == old_etag  # unchanged by rejected patches
    r = await client.patch("/api/v1/admin/branding", json={"product_name": "X"}, headers=user["headers"])
    assert r.status_code == 403


async def test_branding_assets(client: AsyncClient) -> None:
    admin = await _admin(client)
    r = await client.post("/api/v1/admin/branding/assets?variant=logo", headers=admin,
                          files={"file": ("logo.png", io.BytesIO(PNG), "image/png")})
    assert r.status_code == 200 and r.json()["logo_url"].endswith(".png")
    evil = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script>'
            b'<rect width="10" height="10" fill="#b91c1c"/><foreignObject><p>x</p></foreignObject></svg>')
    r = await client.post("/api/v1/admin/branding/assets?variant=logo_dark", headers=admin,
                          files={"file": ("logo.svg", io.BytesIO(evil), "image/svg+xml")})
    url = r.json()["logo_dark_url"]
    assert r.status_code == 200 and url.endswith(".svg")
    stored = (await client.get(url.replace("http://testserver", ""))).content
    assert b"<rect" in stored and b"script" not in stored and b"onload" not in stored and b"foreignObject" not in stored
    for name, content, ctype in (("x.jpg", b"\xff\xd8\xff" + b"0" * 32, "image/jpeg"),
                                 ("x.svg", b"<svg><unclosed></svg", "image/svg+xml"),
                                 ("big.png", PNG + b"0" * (1024 * 1024), "image/png")):
        r = await client.post("/api/v1/admin/branding/assets?variant=favicon", headers=admin,
                              files={"file": (name, io.BytesIO(content), ctype)})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_upload", name
    r = await client.delete("/api/v1/admin/branding/assets?variant=logo", headers=admin)
    assert r.json()["logo_url"] is None and r.json()["logo_dark_url"] == url


@pytest.mark.parametrize("payload,forbidden", [
    (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', [b"script", b"alert"]),
    (b'<svg xmlns="http://www.w3.org/2000/svg"><rect onmouseover="steal()" width="1" height="1"/></svg>', [b"onmouseover"]),
    (b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="x"/></foreignObject></svg>',
     [b"foreignObject", b"iframe"]),
    (b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
     b'<use xlink:href="https://evil.example/s.svg#a"/></svg>', [b"evil"]),
    (b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.example/p.png"/></svg>', [b"tracker"]),
    (b'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>', [b"javascript"]),
    (b'<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil/x.css);</style></svg>', [b"@import"]),
    (b'<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil/x)" fill="url(http://e/x#a)"/></svg>',
     [b"evil", b"http://e"]),
])
def test_svg_sanitiser_strips_malicious_content(payload: bytes, forbidden: list[bytes]) -> None:
    out = sanitize_svg(payload)
    assert out.startswith(b"<?xml") and b"<svg" in out
    for bad in forbidden:
        assert bad not in out, bad


@pytest.mark.parametrize("payload", [
    b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
    b'<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><svg>&lol2;</svg>',
    b"<html><script/></html>",
    b"not xml at all",
])
def test_svg_sanitiser_rejects_dangerous_documents(payload: bytes) -> None:
    with pytest.raises(InvalidSVG):
        sanitize_svg(payload)


def test_svg_sanitiser_keeps_safe_content() -> None:
    svg = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g">'
           b'<stop offset="0" stop-color="#b91c1c"/></linearGradient></defs>'
           b'<path d="M0 0h24v24H0z" fill="url(#g)" transform="rotate(45)"/><use href="#g"/></svg>')
    out = sanitize_svg(svg)
    for keep in (b'viewBox="0 0 24 24"', b"<linearGradient", b'fill="url(#g)"', b'href="#g"', b'stop-color="#b91c1c"'):
        assert keep in out, keep


# ══ Plans ══════════════════════════════════════════════════════════════════
async def test_admin_plans_crud(client: AsyncClient, user: dict) -> None:
    admin = await _admin(client)
    plans = {p["code"]: p for p in (await client.get("/api/v1/admin/plans", headers=admin)).json()}
    assert plans["pro"]["badge"] == "Most popular" and plans["pro"]["is_featured"] is True
    assert plans["pro"]["price_yearly_cents"] == 29000 and plans["free"]["subscribers"] >= 2  # admin + user

    r = await client.post("/api/v1/admin/plans", json={"code": "team", "name": "Team", "price_monthly_cents": 9900,
                                                       "price_yearly_cents": 99000, "max_devices": 40, "badge": "New",
                                                       "features": ["40 devices"], "sort_order": 3}, headers=admin)
    assert r.status_code == 201 and r.json()["code"] == "team" and r.json()["subscribers"] == 0
    r = await client.post("/api/v1/admin/plans", json={"code": "team", "name": "T", "price_monthly_cents": 1}, headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_exists"
    r = await client.post("/api/v1/admin/plans", json={"code": "Bad Code", "name": "T", "price_monthly_cents": 1},
                          headers=admin)
    assert r.status_code == 422
    r = await client.patch("/api/v1/admin/plans/team", json={"code": "renamed"}, headers=admin)
    assert r.status_code == 422
    r = await client.patch("/api/v1/admin/plans/team", json={"price_monthly_cents": 7900, "badge": None}, headers=admin)
    assert r.json()["price_monthly_cents"] == 7900 and r.json()["badge"] is None

    public = {p["code"] for p in (await client.get("/api/v1/billing/plans")).json()}
    assert "team" in public
    r = await client.post("/api/v1/admin/plans/team/deactivate", headers=admin)
    assert r.json()["is_active"] is False
    assert "team" not in {p["code"] for p in (await client.get("/api/v1/billing/plans")).json()}
    assert any(p["code"] == "team" for p in (await client.get("/api/v1/admin/plans", headers=admin)).json())
    await client.post("/api/v1/admin/plans/team/activate", headers=admin)

    for code in ("free", "pro"):  # default plan / plan with a subscriber
        if code == "pro":
            await client.patch(f"/api/v1/admin/accounts/{user['user']['id']}", json={"plan_code": "pro"}, headers=admin)
        r = await client.delete(f"/api/v1/admin/plans/{code}", headers=admin)
        assert r.status_code == 409 and r.json()["error"]["code"] == "plan_in_use" and r.json()["error"]["ref"] == "NFC-7003"
    assert (await client.delete("/api/v1/admin/plans/team", headers=admin)).status_code == 204
    assert (await client.get("/api/v1/admin/plans", headers=user["headers"])).status_code == 403


# ══ Promotions ═════════════════════════════════════════════════════════════
def _promo(**kw) -> Promotion:  # type: ignore[no-untyped-def]
    base = {"name": "P", "discount_type": "percent", "discount_value": 20, "audience": "all", "plan_codes": [],
            "is_active": True, "redemptions": 0, "currency": None, "starts_at": None, "ends_at": None,
            "max_redemptions": None}
    base.update(kw)
    return Promotion(**base)


def test_promotion_status_math_and_best_selection() -> None:
    now = datetime.now(UTC)
    assert _promo().status_at(now) == "active"
    assert _promo(is_active=False).status_at(now) == "inactive"
    assert _promo(starts_at=now + timedelta(days=1)).status_at(now) == "scheduled"
    assert _promo(ends_at=now - timedelta(seconds=1)).status_at(now) == "expired"
    assert _promo(max_redemptions=5, redemptions=5).status_at(now) == "exhausted"
    assert _promo(is_active=False, ends_at=now - timedelta(days=1)).status_at(now) == "inactive"

    pro = Plan(code="pro", name="Pro", price_monthly_cents=2900, currency="USD", audience="developer")
    growth = Plan(code="biz_growth", name="Growth", price_monthly_cents=4900, currency="USD", audience="business")
    free = Plan(code="free", name="Free", price_monthly_cents=0, currency="USD", audience="developer")
    twenty = _promo(name="20%", discount_value=20)                                   # 2900 → 2320
    amount = _promo(name="$10", discount_type="amount", discount_value=1000, currency="USD")  # 2900 → 1900
    biz_only = _promo(name="biz 50%", discount_value=50, audience="business")
    eur = _promo(name="€5", discount_type="amount", discount_value=500, currency="EUR")
    growth_only = _promo(name="growth", discount_value=90, plan_codes=["biz_growth"])
    later = _promo(name="later", discount_value=99, starts_at=now + timedelta(days=2))
    promos = [twenty, amount, biz_only, eur, growth_only, later]
    assert promotions.best_for(pro, promos, now) is amount
    assert promotions.discounted_price(amount, 2900) == 1900 and promotions.discounted_price(twenty, 2900) == 2320
    assert promotions.best_for(growth, promos, now) is growth_only  # 90% beats business 50%
    assert promotions.best_for(free, promos, now) is None
    assert not promotions.applies_to(eur, pro) and not promotions.applies_to(biz_only, pro)
    assert promotions.discounted_price(_promo(discount_type="amount", discount_value=99999, currency="USD"), 2900) == 0


async def test_promotions_admin_and_public(client: AsyncClient, user: dict) -> None:
    admin = await _admin(client)
    now = datetime.now(UTC)
    r = await client.post("/api/v1/admin/promotions", json={
        "name": "Launch", "code": "launch20", "discount_type": "percent", "discount_value": 20,
        "audience": "developer", "plan_codes": ["pro"], "show_on_landing": True, "banner_text": "20% off Pro",
        "ends_at": (now + timedelta(days=10)).isoformat()}, headers=admin)
    assert r.status_code == 201, r.text
    launch = r.json()
    assert launch["code"] == "LAUNCH20" and launch["status"] == "active" and launch["redemptions"] == 0
    r = await client.post("/api/v1/admin/promotions", json={"name": "Dup", "code": "LAUNCH20", "discount_type": "percent",
                                                            "discount_value": 5}, headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "promotion_code_exists"
    for bad in ({"discount_type": "percent", "discount_value": 150}, {"discount_type": "amount", "discount_value": 100},
                {"discount_type": "percent", "discount_value": 5, "plan_codes": ["nope"]},
                {"discount_type": "percent", "discount_value": 5, "starts_at": now.isoformat(),
                 "ends_at": (now - timedelta(days=1)).isoformat()}):
        r = await client.post("/api/v1/admin/promotions", json={"name": "Bad", **bad}, headers=admin)
        assert r.status_code == 422, bad
    r = await client.post("/api/v1/admin/promotions", json={
        "name": "Soon", "discount_type": "amount", "discount_value": 2000, "currency": "usd",
        "starts_at": (now + timedelta(days=3)).isoformat(), "show_on_landing": True}, headers=admin)
    soon = r.json()
    assert soon["status"] == "scheduled" and soon["currency"] == "USD"
    r = await client.post("/api/v1/admin/promotions", json={"name": "Biz", "discount_type": "percent",
                                                            "discount_value": 30, "audience": "business"}, headers=admin)
    biz = r.json()

    plans = {p["code"]: p for p in (await client.get("/api/v1/billing/plans")).json()}
    assert plans["pro"]["promotion"]["id"] == launch["id"]
    assert plans["pro"]["promotion"]["discounted_price_monthly_cents"] == 2320 and plans["pro"]["promotion"]["code"] == "LAUNCH20"
    assert plans["business"]["promotion"] is None and plans["free"]["promotion"] is None  # plan_codes / free
    assert plans["biz_growth"]["promotion"]["id"] == biz["id"]
    active = (await client.get("/api/v1/billing/promotions/active")).json()
    assert [p["id"] for p in active] == [launch["id"]]  # scheduled + not-on-landing excluded

    r = await client.post("/api/v1/billing/promotions/validate", json={"code": "launch20", "plan_code": "pro"},
                          headers=user["headers"])
    assert r.json()["valid"] is True and r.json()["discounted_price_monthly_cents"] == 2320
    r = await client.post("/api/v1/billing/promotions/validate", json={"code": "LAUNCH20", "plan_code": "business"},
                          headers=user["headers"])
    assert r.json() == {"valid": False, "promotion": None, "discounted_price_monthly_cents": None,
                        "reason": "not_applicable"}
    r = await client.post("/api/v1/billing/promotions/validate", json={"code": "NOPE", "plan_code": "pro"},
                          headers=user["headers"])
    assert r.json()["reason"] == "unknown_code"
    assert (await client.post("/api/v1/billing/promotions/validate", json={"code": "X", "plan_code": "pro"})).status_code == 401

    r = await client.post(f"/api/v1/admin/promotions/{launch['id']}/deactivate", headers=admin)
    assert r.json()["status"] == "inactive"
    assert {p["code"]: p for p in (await client.get("/api/v1/billing/plans")).json()}["pro"]["promotion"] is None
    r = await client.post("/api/v1/billing/promotions/validate", json={"code": "LAUNCH20", "plan_code": "pro"},
                          headers=user["headers"])
    assert r.json()["reason"] == "promotion_inactive"
    r = await client.patch(f"/api/v1/admin/promotions/{launch['id']}", json={"max_redemptions": 1, "is_active": True},
                           headers=admin)
    assert r.json()["status"] == "active"
    listed = (await client.get("/api/v1/admin/promotions?status=scheduled", headers=admin)).json()
    assert [p["id"] for p in listed] == [soon["id"]]
    assert (await client.delete(f"/api/v1/admin/promotions/{soon['id']}", headers=admin)).status_code == 204
    assert (await client.get("/api/v1/admin/promotions", headers=user["headers"])).status_code == 403


# ══ Coordinator fixes: auth rate limit, business apps, slug availability ═══
async def test_strict_auth_bucket_only_for_credential_endpoints(client: AsyncClient, user: dict,
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AUTH_RATE_LIMIT_REQUESTS", 3)
    for _ in range(12):  # page reloads must not hit the 10/min credential bucket
        r = await client.get("/api/v1/auth/me", headers=user["headers"])
        assert r.status_code == 200 and r.headers["X-RateLimit-Limit"] == str(settings.RATE_LIMIT_REQUESTS)
    await client.patch("/api/v1/auth/me", json={"full_name": "Still ok"}, headers=user["headers"])
    codes = [(await client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "x"})).status_code
             for _ in range(4)]
    assert codes == [401, 401, 429, 429]  # the fixture's register already used one of the 3 slots
    r = await client.post("/api/v1/auth/resend-verification", headers=user["headers"])
    assert r.status_code == 429  # same strict per-IP credential bucket
    r = await client.post(f"/api/v1/invitations/{'x' * 20}/accept", headers=user["headers"])
    assert r.status_code == 429


async def test_business_owned_applications_and_slug_check(client: AsyncClient) -> None:
    owner = await register_business(client)
    manager = await add_member(client, owner, "manager")
    bid = owner["business_id"]
    r = await client.post(f"/api/v1/businesses/{bid}/applications", json={"name": "POS integration",
                                                                           "delivery_mode": "relay"},
                          headers=owner["headers"])
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["api_key_plaintext"].startswith("nfc_") and created["webhook_secret_plaintext"].startswith("whsec_")
    apps = (await client.get(f"/api/v1/businesses/{bid}/applications", headers=owner["headers"])).json()
    assert {a["name"] for a in apps} == {"Business Terminal", "POS integration"}
    assert (await client.get("/api/v1/applications", headers=owner["headers"])).json() == []  # developer listing
    r = await client.post(f"/api/v1/businesses/{bid}/applications", json={"name": "X"}, headers=manager["headers"])
    assert r.status_code == 403 and r.json()["error"]["details"] == {"required": "api.manage"}

    h = owner["headers"]
    assert (await client.get("/api/v1/businesses/slug-available?slug=fresh-name", headers=h)).json() == \
        {"available": True, "reason": None}
    assert (await client.get(f"/api/v1/businesses/slug-available?slug={owner['slug']}", headers=h)).json() == \
        {"available": False, "reason": "taken"}
    assert (await client.get(f"/api/v1/businesses/slug-available?slug={owner['slug']}&business_id={bid}",
                             headers=h)).json() == {"available": True, "reason": "current"}
    assert (await client.get("/api/v1/businesses/slug-available?slug=No!", headers=h)).json()["reason"] == "invalid_format"
    assert (await client.get("/api/v1/businesses/slug-available?slug=abc")).status_code == 401
