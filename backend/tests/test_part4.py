"""Part 4: personal accounts, sessions, digital cards, tokens, exchanges, contacts, terminals, business cards."""

from __future__ import annotations

import base64
import csv
import io
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
import respx
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import CardTap, Contact
from app.services import card_tokens, request_logs
from tests.conftest import bearer, create_app, register, register_device
from tests.p2_helpers import BROWSER_UA, BOT_UA, create_employee, pair_business_device, register_business, token_from_url

# Fixed vectors — also published in docs/PART4_CONTRACT.md §3 for the mobile generator.
VECTORS = [
    ("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", "00112233-4455-6677-8899-aabbccddeeff", 1, 1790000000,
     "AQARIjNEVWZ3iJmqu8zd7v8AAAABarE7gDqfF63howUbVssouoR5VwM"),
    ("qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo", "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f", 305419896, 1800000123,
     "AX8cLT5LWkxtjp8KGyw9Tl8SNFZ4a0nSe8Fk1b4SfbhyWc78tVbqa8M"),
    ("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU", "c0ffee00-0000-4000-8000-000000000001", 4294967295, 0,
     "AcD_7gAAAEAAgAAAAAAAAAH_____AAAAAOkYlkbhvHUFoqWI5pKkMEE"),
]


def _secret(b64: str) -> bytes:
    return base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4))


@pytest.mark.parametrize("secret,share_id,key_id,issued_at,expected", VECTORS)
def test_token_vectors(secret: str, share_id: str, key_id: int, issued_at: int, expected: str) -> None:
    token = card_tokens.encode(_secret(secret), uuid.UUID(share_id), key_id, issued_at)
    assert token == expected and len(token) == 55 and "=" not in token
    parsed = card_tokens.parse(token)
    assert (str(parsed.share_id), parsed.key_id, parsed.issued_at) == (share_id, key_id, issued_at)
    assert card_tokens.verify_mac(parsed, _secret(secret))
    raw = card_tokens.b64url_decode(token)
    assert len(raw) == 41 and raw[0] == 1
    apdu = card_tokens.hce_response(raw)
    assert apdu[:5] == b"NFCDC" and apdu[-2:] == b"\x90\x00" and len(apdu) == 48
    assert card_tokens.SELECT_APDU.hex().upper() == "00A4040007F04E464344430100"


def test_token_parse_errors() -> None:
    good = VECTORS[0][4]
    for bad in ("", "x" * 55, good[:-1], good + "A", good.replace("A", "+", 1), "A" + good[1:]):
        with pytest.raises(card_tokens.TokenError):
            parsed = card_tokens.parse(bad)
            assert card_tokens.verify_mac(parsed, _secret(VECTORS[0][0])), "tampered token must fail"
            raise card_tokens.TokenError("invalid_card_token", "mac")
    now = 1_790_000_000
    parsed = card_tokens.parse(good)
    card_tokens.check_time(parsed, now + 600)
    with pytest.raises(card_tokens.TokenError) as exc:
        card_tokens.check_time(parsed, now + 601)
    assert exc.value.code == "card_token_expired"
    card_tokens.check_time(parsed, now - 120)
    with pytest.raises(card_tokens.TokenError) as exc:
        card_tokens.check_time(parsed, now - 121)
    assert exc.value.code == "invalid_card_token"


# ── helpers ───────────────────────────────────────────────────────────────
async def register_personal(client: AsyncClient, name: str = "Amani Uwimana", email: str | None = None,
                            **extra: Any) -> dict[str, Any]:
    email = email or f"p-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": "Sup3rSecretPass",
                                                         "full_name": name, "account_type": "personal", **extra})
    assert r.status_code == 201, r.text
    data = r.json()
    data["headers"] = bearer(data["access_token"])
    data["email"] = email
    return data


async def phone_login(client: AsyncClient, person: dict[str, Any], installation: str | None = None) -> dict[str, Any]:
    r = await client.post("/api/v1/personal/sessions", json={
        "email": person["email"], "password": "Sup3rSecretPass", "device_name": "Pixel 8", "platform": "android",
        "model": "Pixel 8", "app_version": "2.0.0", "installation_id": installation or str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    data = r.json()
    data["headers"] = bearer(data["session_token"])
    return data


def mint(sess: dict[str, Any], card: dict[str, Any], issued_at: int | None = None) -> str:
    return card_tokens.encode(_secret(sess["share_key"]["secret"]), uuid.UUID(card["share_id"]),
                              sess["share_key"]["key_id"], issued_at if issued_at is not None else int(time.time()))


async def primary(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    cards = (await client.get("/api/v1/personal/cards", headers=headers)).json()
    return next(c for c in cards if c["is_primary"])


async def fill_card(client: AsyncClient, person: dict[str, Any], **patch: Any) -> dict[str, Any]:
    card = await primary(client, person["headers"])
    body = {"fields": {"headline": "Designer at Studio", "job_title": "Product Designer", "company": "Studio",
                       "phones": [{"label": "Mobile", "value": "+250788000111"}],
                       "address": "KN 4 Ave, Kigali"}}
    body.update(patch)
    r = await client.patch(f"/api/v1/personal/cards/{card['id']}", json=body, headers=person["headers"])
    assert r.status_code == 200, r.text
    return r.json()


# ── §1 personal accounts & sessions ──────────────────────────────────────
async def test_personal_registration_and_plans(client: AsyncClient) -> None:
    p = await register_personal(client, phone="+250788000999")
    assert p["user"]["account_type"] == "personal" and p["user"]["plan"] == "personal_free"
    cards = (await client.get("/api/v1/personal/cards", headers=p["headers"])).json()
    assert len(cards) == 1 and cards[0]["is_primary"] and cards[0]["template_id"] == "modern"
    c = cards[0]
    assert c["fields"]["full_name"] == "Amani Uwimana" and c["fields"]["emails"][0]["value"] == p["email"]
    assert c["fields"]["phones"][0]["value"] == "+250788000999"
    assert c["visibility"]["phones"] == "contacts" and c["visibility"]["address"] == "hidden"
    assert c["visibility"]["full_name"] == "public" and c["share_settings"]["auto_exchange"] is True
    assert c["public_url"] == f"http://web.test/p/{c['slug']}" and c["business_link"] is None
    plans = {x["code"]: x for x in (await client.get("/api/v1/billing/plans?audience=personal")).json()}
    assert plans["personal_free"]["max_cards"] == 3 and plans["personal_free"]["max_contacts"] == 1000
    assert plans["personal_pro"]["max_cards"] == 20 and plans["personal_pro"]["max_contacts"] is None
    dev = await register(client)
    r = await client.get("/api/v1/personal/cards", headers=bearer(dev["access_token"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "personal_account_required"
    templates = (await client.get("/api/v1/personal/templates")).json()
    ids = {t["id"] for t in templates}
    assert {"classic", "modern", "minimal", "gradient", "glass", "bold", "split", "photo_hero"} <= ids
    assert {t["layout"] for t in templates} == {"centered", "left", "split", "hero_photo", "banner", "compact"}


async def test_sessions_login_codes_and_revocation(client: AsyncClient) -> None:
    p = await register_personal(client)
    s1 = await phone_login(client, p, installation="install-aaaa-1111")
    assert s1["session_token"].startswith("nfcs_") and len(_secret(s1["share_key"]["secret"])) == 32
    assert s1["user"]["account_type"] == "personal" and len(s1["cards"]) == 1
    assert (await client.get("/api/v1/personal/cards", headers=s1["headers"])).status_code == 200
    hb = await client.post("/api/v1/personal/sessions/current/heartbeat", headers=s1["headers"])
    assert hb.json()["status"] == "active"
    s2 = await phone_login(client, p, installation="install-aaaa-1111")  # same installation → s1 revoked
    r = await client.get("/api/v1/personal/cards", headers=s1["headers"])
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_session_token"
    sessions = (await client.get("/api/v1/personal/sessions", headers=p["headers"])).json()
    assert len(sessions) == 2 and sum(1 for x in sessions if x["revoked_at"] is None) == 1

    # QR login from the web
    code = (await client.post("/api/v1/personal/login-codes", headers=p["headers"])).json()
    assert code["code"].startswith("nfcl_") and code["qr_payload"].startswith("nfcterminal://login?v=1&server=")
    assert (await client.get(f"/api/v1/personal/login-codes/{code['id']}", headers=p["headers"])).json()["status"] == "pending"
    r = await client.post("/api/v1/personal/sessions", json={"login_code": code["code"], "device_name": "Galaxy"})
    assert r.status_code == 201 and r.json()["session"]["device_name"] == "Galaxy"
    st = (await client.get(f"/api/v1/personal/login-codes/{code['id']}", headers=p["headers"])).json()
    assert st["status"] == "used" and st["session"]["device_name"] == "Galaxy"
    r = await client.post("/api/v1/personal/sessions", json={"login_code": code["code"], "device_name": "Again"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_login_code"

    r = await client.delete(f"/api/v1/personal/sessions/{s2['session']['id']}", headers=p["headers"])
    assert r.status_code == 204
    assert (await client.get("/api/v1/personal/cards", headers=s2["headers"])).status_code == 401
    dev = await register(client, email="devperson@example.com")
    r = await client.post("/api/v1/personal/sessions", json={"email": "devperson@example.com",
                                                             "password": "Sup3rSecretPass"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "personal_account_required"
    r = await client.post("/api/v1/personal/sessions", json={"email": p["email"], "password": "nope-nope-nope"})
    assert r.status_code == 401
    assert dev


# ── §2 cards ──────────────────────────────────────────────────────────────
async def test_card_crud_limits_primary_rotate_images(client: AsyncClient) -> None:
    p = await register_personal(client)
    h = p["headers"]
    first = await primary(client, h)
    r = await client.post("/api/v1/personal/cards", json={"label": "Work", "template_id": "split",
                                                          "design": {"primary": "#123456", "corner_radius": 30},
                                                          "fields": {"full_name": "Amani", "company": "Studio"}},
                          headers=h)
    work = r.json()
    assert r.status_code == 201 and work["is_primary"] is False and work["design"]["primary"] == "#123456"
    assert work["design"]["background_style"] == "solid"  # from the template defaults
    dup = (await client.post(f"/api/v1/personal/cards/{work['id']}/duplicate", headers=h)).json()
    assert dup["label"] == "Work copy" and dup["slug"] != work["slug"]
    r = await client.post("/api/v1/personal/cards", json={"label": "Fourth"}, headers=h)
    assert r.status_code == 402 and r.json()["error"]["details"]["limit"] == "cards"

    await client.post(f"/api/v1/personal/cards/{work['id']}/primary", headers=h)
    cards = (await client.get("/api/v1/personal/cards", headers=h)).json()
    assert [c["id"] for c in cards if c["is_primary"]] == [work["id"]]
    old_share = work["share_id"]
    rotated = (await client.post(f"/api/v1/personal/cards/{work['id']}/rotate-share-id", headers=h)).json()
    assert rotated["share_id"] != old_share

    for body, field in (({"design": {"primary": "red"}}, "body.design.primary"),
                        ({"design": {"corner_radius": 33}}, "body.design.corner_radius"),
                        ({"fields": {"websites": [{"label": "x", "url": "javascript:alert(1)"}]}}, "body.fields.websites.0.url"),
                        ({"visibility": {"phones": "friends"}}, "body.visibility.phones"),
                        ({"fields": {"nickname": "x"}}, "body.fields.nickname"),
                        ({"template_id": "nope"}, "body.template_id")):
        r = await client.patch(f"/api/v1/personal/cards/{first['id']}", json=body, headers=h)
        assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == field, body

    buf = io.BytesIO()
    Image.new("RGB", (2000, 1000), (180, 20, 20)).save(buf, format="JPEG")
    for kind, size in (("photo", (512, 512)), ("cover", (1200, 630))):
        r = await client.post(f"/api/v1/personal/cards/{first['id']}/images?kind={kind}", headers=h,
                              files={"file": ("x.jpg", io.BytesIO(buf.getvalue()), "image/jpeg")})
        url = r.json()[f"{kind}_url"]
        img = Image.open(io.BytesIO((await client.get(url.replace("http://testserver", ""))).content))
        assert img.size == size and img.format == "WEBP"
    r = await client.delete(f"/api/v1/personal/cards/{first['id']}/images?kind=cover", headers=h)
    assert r.json()["cover_url"] is None
    assert (await client.delete(f"/api/v1/personal/cards/{work['id']}", headers=h)).status_code == 204
    cards = (await client.get("/api/v1/personal/cards", headers=h)).json()
    assert len(cards) == 2 and sum(c["is_primary"] for c in cards) == 1


# ── §2 public page & leads ────────────────────────────────────────────────
async def test_public_page_visibility_vcard_views_and_leads(client: AsyncClient) -> None:
    p = await register_personal(client)
    card = await fill_card(client, p, visibility={"headline": "hidden"})
    slug = card["slug"]
    r = await client.get(f"/api/v1/public/p/{slug}?via=nfc", headers={"User-Agent": BROWSER_UA})
    body = r.json()
    f = body["card"]["fields"]
    assert r.status_code == 200 and f["full_name"] == "Amani Uwimana" and f["company"] == "Studio"
    assert "phones" not in f and "emails" not in f and "address" not in f and "headline" not in f
    assert body["card"]["template"]["id"] == "modern" and body["lead_capture_enabled"] is True
    vcf = (await client.get(f"/api/v1/public/p/{slug}/vcard")).text
    assert "FN:Amani Uwimana" in vcf and "+250788000111" not in vcf and "KN 4 Ave" not in vcf
    await client.get(f"/api/v1/public/p/{slug}", headers={"User-Agent": BOT_UA})
    await client.get(f"/api/v1/public/p/{slug}?via=qr", headers={"User-Agent": BROWSER_UA})
    stats = (await primary(client, p["headers"]))["stats"]
    assert stats["views"] == 2 and stats["nfc_taps"] == 1  # bot excluded

    # leads: honeypot, validation, success, rate limit
    r = await client.post(f"/api/v1/public/p/{slug}/leads", json={"full_name": "Bot", "email": "b@x.io",
                                                                   "website": "http://spam"})
    assert r.status_code == 201
    r = await client.post(f"/api/v1/public/p/{slug}/leads", json={"full_name": "No contact info"})
    assert r.status_code == 422
    r = await client.post(f"/api/v1/public/p/{slug}/leads", json={"full_name": "Eric N", "email": "eric@example.com",
                                                                   "company": "=HYPERLINK(1)", "message": "Let's talk"})
    assert r.status_code == 201
    contacts = (await client.get("/api/v1/personal/contacts?source=web_lead", headers=p["headers"])).json()
    assert contacts["total"] == 1 and contacts["items"][0]["card"]["fields"]["full_name"] == "Eric N"
    assert contacts["items"][0]["notes"] == "Let's talk"
    notes = (await client.get("/api/v1/notifications", headers=p["headers"])).json()["items"]
    assert notes[0]["type"] == "personal.lead"
    csv_text = (await client.get("/api/v1/personal/contacts/export.csv", headers=p["headers"])).text
    row = list(csv.reader(io.StringIO(csv_text)))[1]
    assert row[0] == "Eric N" and row[1] == "'=HYPERLINK(1)"  # CSV injection guard
    codes = [(await client.post(f"/api/v1/public/p/{slug}/leads", json={"full_name": "X", "email": "x@example.com"})
              ).status_code for _ in range(4)]
    assert codes[-1] == 429

    await client.patch(f"/api/v1/personal/cards/{card['id']}", json={"share_settings": {"web_page_enabled": False}},
                       headers=p["headers"])
    r = await client.get(f"/api/v1/public/p/{slug}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "card_unavailable" and r.json()["error"]["ref"] == "NFC-4006"


# ── §3/§4 token validation & exchanges ────────────────────────────────────
async def test_exchange_token_validation_paths(client: AsyncClient) -> None:
    alice = await register_personal(client, "Alice A")
    bob = await register_personal(client, "Bob B")
    bob_sess = await phone_login(client, bob)
    bob_card = await primary(client, bob["headers"])

    def ex(token: str, who: dict = alice) -> Any:  # type: ignore[type-arg]
        return client.post("/api/v1/personal/exchanges", json={"token": token}, headers=who["headers"])

    now = int(time.time())
    r = await ex(mint(bob_sess, bob_card, now - 601))
    assert r.status_code == 410 and r.json()["error"]["code"] == "card_token_expired"
    r = await ex(mint(bob_sess, bob_card, now + 200))
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_card_token"
    tok = mint(bob_sess, bob_card)
    tampered = tok[:-2] + ("AA" if not tok.endswith("AA") else "BB")
    assert (await ex(tampered)).json()["error"]["code"] == "invalid_card_token"
    other_key = dict(bob_sess, share_key={"key_id": bob_sess["share_key"]["key_id"],
                                          "secret": card_tokens.b64url_encode(b"\x07" * 32)})
    assert (await ex(mint(other_key, bob_card))).json()["error"]["ref"] == "NFC-4004"  # bad mac
    assert (await ex("not-a-token")).status_code == 422
    r = await ex(mint(bob_sess, bob_card), who=bob)
    assert r.status_code == 409 and r.json()["error"]["code"] == "self_exchange"
    assert (await ex(mint(bob_sess, bob_card, now - 599))).status_code == 201  # inside the window

    rotated = (await client.post(f"/api/v1/personal/cards/{bob_card['id']}/rotate-share-id", headers=bob["headers"])).json()
    r = await ex(mint(bob_sess, bob_card))  # old share_id
    assert r.status_code == 422
    assert (await ex(mint(bob_sess, rotated))).status_code == 201
    await client.delete(f"/api/v1/personal/sessions/{bob_sess['session']['id']}", headers=bob["headers"])
    r = await ex(mint(bob_sess, rotated))  # revoked session key
    assert r.status_code == 422 and "revoked" in r.json()["error"]["message"]
    bob_sess2 = await phone_login(client, bob)
    await client.patch(f"/api/v1/personal/cards/{rotated['id']}", json={"share_settings": {"nfc_sharing_enabled": False}},
                       headers=bob["headers"])
    assert (await ex(mint(bob_sess2, rotated))).json()["error"]["code"] == "card_unavailable"


async def test_mutual_and_one_way_exchange_with_live_refresh(client: AsyncClient) -> None:
    alice = await register_personal(client, "Alice A")
    bob = await register_personal(client, "Bob B")
    await fill_card(client, alice)
    bob_card = await fill_card(client, bob)
    bob_sess = await phone_login(client, bob)
    r = await client.post("/api/v1/personal/exchanges", json={"token": mint(bob_sess, bob_card), "via": "nfc"},
                          headers=alice["headers"])
    res = r.json()
    assert r.status_code == 201 and res["mutual"] is True and res["already_connected"] is False
    f = res["contact"]["card"]["fields"]
    assert f["full_name"] == "Bob B" and f["phones"][0]["value"] == "+250788000111"  # contacts level
    assert res["contact"]["card"]["template_id"] == "modern" and res["contact"]["card"]["layout"] == "centered"
    assert "address" not in f and res["contact"]["source"] == "nfc_exchange" and res["contact"]["live"] is True
    bob_contacts = (await client.get("/api/v1/personal/contacts", headers=bob["headers"])).json()["items"]
    assert len(bob_contacts) == 1 and bob_contacts[0]["card"]["fields"]["full_name"] == "Alice A"
    assert "phones" in bob_contacts[0]["card"]["fields"]
    notes = (await client.get("/api/v1/notifications", headers=bob["headers"])).json()["items"]
    assert notes[0]["title"] == "You exchanged cards with Alice A"

    r = await client.post("/api/v1/personal/exchanges", json={"token": mint(bob_sess, bob_card), "via": "qr"},
                          headers=alice["headers"])
    assert r.json()["already_connected"] is True
    assert (await client.get("/api/v1/personal/contacts", headers=alice["headers"])).json()["total"] == 1

    # live: Bob edits his card → Alice's contact refreshes (and respects visibility)
    await client.patch(f"/api/v1/personal/cards/{bob_card['id']}", json={
        "fields": {"headline": "Now at Big Co"}, "visibility": {"phones": "hidden"}}, headers=bob["headers"])
    c = (await client.get(f"/api/v1/personal/contacts/{res['contact']['id']}", headers=alice["headers"])).json()
    assert c["card"]["fields"]["headline"] == "Now at Big Co" and "phones" not in c["card"]["fields"]

    # one-way: Carol has auto_exchange off → scanner gets public fields only, Carol gets nothing
    carol = await register_personal(client, "Carol C")
    carol_card = await fill_card(client, carol, share_settings={"auto_exchange": False})
    carol_sess = await phone_login(client, carol)
    res = (await client.post("/api/v1/personal/exchanges", json={"token": mint(carol_sess, carol_card)},
                             headers=alice["headers"])).json()
    assert res["mutual"] is False and "phones" not in res["contact"]["card"]["fields"]
    assert res["contact"]["card"]["fields"]["company"] == "Studio"
    assert (await client.get("/api/v1/personal/contacts", headers=carol["headers"])).json()["total"] == 0
    stats = (await client.get("/api/v1/personal/stats?range=7d", headers=carol["headers"])).json()
    assert stats["totals"]["exchanges"] == 1
    act = (await client.get("/api/v1/personal/activity", headers=alice["headers"])).json()
    assert act["total"] >= 3 and act["items"][0]["type"] == "exchange"
    item = act["items"][0]
    assert set(item) == {"id", "type", "card_id", "card_label", "source", "counterpart_name", "detail", "created_at"}
    assert item["counterpart_name"] == "Carol C" and item["card_label"] == "Personal" and item["source"] == "nfc"

    # exchange QR generated on the web works like an NFC token
    dave = await register_personal(client, "Dave D")
    qr = (await client.get(f"/api/v1/personal/cards/{(await primary(client, dave['headers']))['id']}/exchange-qr",
                           headers=dave["headers"])).json()
    assert qr["qr_payload"].startswith("nfcterminal://card?v=1&t=")
    r = await client.post("/api/v1/personal/exchanges", json={"token": qr["token"], "via": "qr"},
                          headers=alice["headers"])
    assert r.status_code == 201 and r.json()["contact"]["source"] == "qr_exchange"


async def test_contacts_crud_and_exports(client: AsyncClient) -> None:
    p = await register_personal(client)
    h = p["headers"]
    r = await client.post("/api/v1/personal/contacts", json={
        "fields": {"full_name": "Grace M", "company": "Acme", "emails": [{"label": "Work", "value": "grace@acme.io"}]},
        "tags": ["conference"], "notes": "Met at expo"}, headers=h)
    c = r.json()
    assert r.status_code == 201 and c["source"] == "manual"
    assert (await client.post("/api/v1/personal/contacts", json={"fields": {}}, headers=h)).status_code == 422
    await client.post("/api/v1/personal/contacts", json={"fields": {"full_name": "Zed"}}, headers=h)
    assert (await client.get("/api/v1/personal/contacts?q=acme", headers=h)).json()["total"] == 1
    assert (await client.get("/api/v1/personal/contacts?tag=conference", headers=h)).json()["total"] == 1
    r = await client.patch(f"/api/v1/personal/contacts/{c['id']}", json={"favorite": True, "tags": ["vip"]}, headers=h)
    assert r.json()["favorite"] is True
    assert (await client.get("/api/v1/personal/contacts?favorite=true", headers=h)).json()["total"] == 1
    v = await client.get(f"/api/v1/personal/contacts/{c['id']}/vcard", headers=h)
    assert v.headers["content-type"].startswith("text/vcard") and "EMAIL;TYPE=INTERNET:grace@acme.io" in v.text
    allv = (await client.get("/api/v1/personal/contacts/export.vcf", headers=h)).text
    assert allv.count("BEGIN:VCARD") == 2
    assert (await client.delete(f"/api/v1/personal/contacts/{c['id']}", headers=h)).status_code == 204
    other = await register_personal(client)
    assert (await client.get(f"/api/v1/personal/contacts/{c['id']}", headers=other["headers"])).status_code == 404


# ── §5 terminals ──────────────────────────────────────────────────────────
async def test_developer_terminal_reads_digital_card(client: AsyncClient, user: dict) -> None:
    p = await register_personal(client, "Amani Uwimana")
    card = await fill_card(client, p, visibility={"headline": "hidden"})
    sess = await phone_login(client, p)
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": "https://hooks.example.com/dc",
                                                                       "enabled": True}, headers=user["headers"])
    dev = await register_device(client, created["api_key_plaintext"])
    share_hex = uuid.UUID(card["share_id"]).hex.upper()

    def ev(token: str, card_id: str = share_hex) -> dict:  # type: ignore[type-arg]
        return {"event_id": str(uuid.uuid4()), "card_id": card_id, "detected_at": datetime.now(UTC).isoformat(),
                "digital_card_token": token}

    with respx.mock() as mock:
        route = mock.post("https://hooks.example.com/dc").mock(return_value=httpx.Response(200))
        r = await client.post("/api/v1/device/events", json=ev(mint(sess, card)), headers=bearer(dev["device_token"]))
        assert r.status_code == 200 and r.json()["digital_card"] == {"verified": True, "error_code": None,
                                                                     "error_ref": None, "expired": False}  # Part 5
        import json as _json

        payload = _json.loads(route.calls[0].request.content)
    assert payload["card"]["type"] == "digital_card" and payload["card_id"] == share_hex
    dc = payload["digital_card"]
    assert dc["verified"] is True and dc["id"] == card["share_id"] and dc["full_name"] == "Amani Uwimana"
    assert dc["headline"] is None and dc["company"] == "Studio" and dc["public_url"].endswith(card["slug"])
    assert "phones" not in dc and "+250788000111" not in _json.dumps(payload)
    assert payload["security"] == {"authenticated": False, "level": "signed_token"}

    r = await client.post("/api/v1/device/events", json=ev(mint(sess, card), card_id="04AABBCCDD"),
                          headers=bearer(dev["device_token"]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "card_id_mismatch"
    with respx.mock() as mock:
        route = mock.post("https://hooks.example.com/dc").mock(return_value=httpx.Response(200))
        r = await client.post("/api/v1/device/events", json=ev(mint(sess, card, int(time.time()) - 700)),
                              headers=bearer(dev["device_token"]))
        assert r.status_code == 200 and r.json()["digital_card"]["verified"] is False
        assert r.json()["digital_card"]["error_code"] == "card_token_expired"
        unverified = _json.loads(route.calls[0].request.content)["digital_card"]
    assert unverified == {"id": card["share_id"], "verified": False}
    act = (await client.get("/api/v1/personal/activity", headers=p["headers"])).json()["items"]
    assert act[0]["type"] == "terminal_read" and act[0]["detail"] == "Read by a terminal of Front desk"
    assert act[0]["counterpart_name"] == "Front desk"


async def test_business_terminal_and_employee_digital_cards(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    emp = await create_employee(client, owner, "John", "Doe", phone="+250788000555")
    dev = await pair_business_device(client, owner)

    # issue a card → personal account accepts it
    r = await client.post(f"{base}/employees/{emp['id']}/digital-card", json={
        "email": "john@example.com", "template_id": "business", "locked_fields": ["company", "job_title"]},
        headers=owner["headers"])
    assert r.status_code == 201 and "register?card_invite=" in r.json()["dev_invite_url"]
    assert r.json()["digital_card"]["status"] == "invited" and r.json()["digital_card"]["user_email"] == "john@example.com"
    john = await register_personal(client, "John Doe", email="john@example.com")
    assert (await client.get("/api/v1/personal/business-invites", headers=john["headers"])).json() == []  # unverified
    r = await client.post("/api/v1/auth/verify-email", json={"token": token_from_url(john["dev_verification_url"])})
    assert r.status_code == 204, r.text
    invites = (await client.get("/api/v1/personal/business-invites", headers=john["headers"])).json()
    assert invites[0]["status"] == "pending" and invites[0]["business"]["name"] == "Acme Café"
    linked = (await client.post(f"/api/v1/personal/business-invites/{invites[0]['id']}/accept",
                                headers=john["headers"])).json()
    link = linked["business_link"]
    assert link["business_name"] == "Acme Café" and link["locked_fields"] == ["company", "job_title"]
    assert linked["fields"]["company"] == "Acme Café" and linked["fields"]["job_title"] == "Sales Manager"
    assert linked["template_id"] == "business" and link["template_locked"] is True
    r = await client.patch(f"/api/v1/personal/cards/{linked['id']}", json={"fields": {"company": "Mine"}},
                           headers=john["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "field_locked" and r.json()["error"]["ref"] == "NFC-6016"
    r = await client.patch(f"/api/v1/personal/cards/{linked['id']}", json={"template_id": "modern"}, headers=john["headers"])
    assert r.status_code == 403
    assert (await client.patch(f"/api/v1/personal/cards/{linked['id']}", json={"fields": {"bio": "Hi"}},
                               headers=john["headers"])).status_code == 200
    e = (await client.get(f"{base}/employees/{emp['id']}", headers=owner["headers"])).json()
    assert e["digital_card"]["status"] == "active" and e["digital_card"]["user_email"] == "john@example.com"

    # the business's own terminal reads John's linked card → recognized employee + CardTap
    sess = await phone_login(client, john)
    token = mint(sess, linked)
    share_hex = uuid.UUID(linked["share_id"]).hex.upper()
    r = await client.post("/api/v1/device/events", headers=dev["headers"], json={
        "event_id": str(uuid.uuid4()), "card_id": share_hex, "detected_at": datetime.now(UTC).isoformat(),
        "digital_card_token": token})
    b = r.json()["business"]
    assert b["result"] == "recognized" and b["assignee"]["type"] == "employee" and b["assignee"]["name"] == "John Doe"
    async with SessionLocal() as s:
        tap = (await s.execute(select(CardTap).where(CardTap.card_kind == "digital"))).scalar_one()
    assert tap.assignee_name == "John Doe" and tap.source == "reader"

    # someone else's personal card at the business terminal → digital_card result (public fields)
    stranger = await register_personal(client, "Stranger S")
    s_card = await fill_card(client, stranger)
    s_sess = await phone_login(client, stranger)
    r = await client.post("/api/v1/device/events", headers=dev["headers"], json={
        "event_id": str(uuid.uuid4()), "card_id": uuid.UUID(s_card["share_id"]).hex.upper(),
        "detected_at": datetime.now(UTC).isoformat(), "digital_card_token": mint(s_sess, s_card)})
    b = r.json()["business"]
    assert b["result"] == "digital_card" and b["assignee"]["name"] == "Stranger S" and b["assignee"]["type"] == "person"
    assert "+250788000111" not in r.text

    # deactivating the employee deactivates the linked card everywhere
    await client.post(f"{base}/employees/{emp['id']}/deactivate", headers=owner["headers"])
    card_now = (await client.get(f"/api/v1/personal/cards/{linked['id']}", headers=john["headers"])).json()
    assert card_now["status"] == "inactive" and card_now["business_link"]["status"] == "inactive"
    assert (await client.get(f"/api/v1/public/p/{linked['slug']}")).status_code == 404
    r = await client.post("/api/v1/personal/exchanges", json={"token": mint(sess, linked)},
                          headers=stranger["headers"])
    assert r.status_code == 404 and r.json()["error"]["code"] == "card_unavailable"
    e = (await client.get(f"{base}/employees/{emp['id']}", headers=owner["headers"])).json()
    assert e["digital_card"]["status"] == "inactive"


async def test_card_invite_via_registration_and_decline(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    emp = await create_employee(client, owner, "Grace", "M")
    r = await client.post(f"{base}/employees/{emp['id']}/digital-card", json={"email": "grace@example.com"},
                          headers=owner["headers"])
    token = token_from_url(r.json()["dev_invite_url"])
    wrong = await client.post("/api/v1/auth/register", json={"email": "other@example.com", "password": "Sup3rSecretPass",
                                                             "full_name": "O", "card_invite": token})
    assert wrong.status_code == 403, wrong.text
    g = await client.post("/api/v1/auth/register", json={"email": "grace@example.com", "password": "Sup3rSecretPass",
                                                         "full_name": "Grace M", "card_invite_token": token})
    assert g.status_code == 201 and g.json()["user"]["account_type"] == "personal" and g.json()["user"]["email_verified"]
    cards = (await client.get("/api/v1/personal/cards", headers=bearer(g.json()["access_token"]))).json()
    assert len(cards) == 1 and cards[0]["business_link"]["business_name"] == "Acme Café" and cards[0]["is_primary"]

    emp2 = await create_employee(client, owner, "Paul", "K")
    await client.post(f"{base}/employees/{emp2['id']}/digital-card", json={"email": "grace@example.com"},
                      headers=owner["headers"])
    inv = [i for i in (await client.get("/api/v1/personal/business-invites",
                                        headers=bearer(g.json()["access_token"]))).json() if i["status"] == "pending"][0]
    r = await client.post(f"/api/v1/personal/business-invites/{inv['id']}/decline", headers=bearer(g.json()["access_token"]))
    assert r.json()["status"] == "declined"
    r = await client.post(f"/api/v1/personal/business-invites/{inv['id']}/accept", headers=bearer(g.json()["access_token"]))
    assert r.status_code == 410 and r.json()["error"]["code"] == "card_invite_unavailable"
    staff_perm = await client.post(f"{base}/employees/{emp['id']}/digital-card", json={"email": "x@example.com"},
                                   headers=bearer(g.json()["access_token"]))
    assert staff_perm.status_code == 403, staff_perm.text


async def test_personal_request_logs_and_demo_seed(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    p = await register_personal(client)
    sess = await phone_login(client, p)
    await client.get("/api/v1/personal/cards", headers={**sess["headers"], "X-Request-ID": "req-personal-1"})
    await request_logs.flush(SessionLocal)
    logs = (await client.get("/api/v1/request-logs?request_id=req-personal-1", headers=p["headers"])).json()["items"]
    assert logs[0]["actor_type"] == "personal_session" and logs[0]["user_id"] == p["user"]["id"]
    other = await register_personal(client)
    assert (await client.get("/api/v1/request-logs?request_id=req-personal-1",
                             headers=other["headers"])).json()["total"] == 0

    from app.core.config import settings
    from app.services.demo import seed_demo_personal

    monkeypatch.setattr(settings, "SEED_DEMO_DATA", True)
    async with SessionLocal() as s:
        await seed_demo_personal(s)
    async with SessionLocal() as s:
        await seed_demo_personal(s)  # idempotent
        contacts = (await s.execute(select(Contact))).scalars().all()
    assert len([c for c in contacts if c.source == "nfc_exchange"]) == 2
    for email in ("personal.demo@example.com", "personal2.demo@example.com"):
        r = await client.post("/api/v1/personal/sessions", json={"email": email, "password": "DemoPassword123",
                                                                 "device_name": "Demo"})
        assert r.status_code == 201 and len(r.json()["cards"]) == 2



async def test_personal_defaults_from_preferences(client: AsyncClient) -> None:
    p = await register_personal(client)
    await client.patch("/api/v1/auth/me/preferences", json={"personal_defaults": {
        "visibility": {"phones": "hidden", "address": "contacts"}, "share_settings": {"auto_exchange": False}}},
        headers=p["headers"])
    card = (await client.post("/api/v1/personal/cards", json={"label": "Second"}, headers=p["headers"])).json()
    assert card["visibility"]["phones"] == "hidden" and card["visibility"]["address"] == "contacts"
    assert card["share_settings"]["auto_exchange"] is False and card["share_settings"]["web_page_enabled"] is True
