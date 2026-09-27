"""One browser + one phone per account, emailed sign-in codes, email-code sign-in, passkey endpoints, mandatory
country, the phone account endpoints and admin demographics."""

from __future__ import annotations

import io
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image

from app.core.config import settings
from tests.conftest import bearer, register
from tests.test_part4 import phone_login, register_personal

PASSWORD = "Sup3rSecretPass"


def browser(cid: str) -> dict[str, str]:
    return {"X-Client-Id": cid}


async def _login(client: AsyncClient, email: str, cid: str = "pytest-browser", password: str = PASSWORD) -> dict[str, Any]:
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": password}, headers=browser(cid))
    assert r.status_code == 200, r.text
    return r.json()


async def _admin(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"},
                          headers=browser("admin-browser"))
    body = r.json()
    if body["status"] == "confirm":
        body = (await client.post("/api/v1/auth/login/confirm", json={"challenge_id": body["challenge_id"]})).json()
    return bearer(body["access_token"])


# ── web: one browser per account ─────────────────────────────────────────────
async def test_second_browser_confirms_then_replaces_the_first(client: AsyncClient) -> None:
    u = await register(client)
    first = bearer(u["access_token"])
    email = u["user"]["email"]
    assert (await client.get("/api/v1/auth/me", headers=first)).status_code == 200

    step = await _login(client, email, cid="laptop-browser-2")
    assert step["status"] == "confirm" and step["otp_required"] is False  # development: no code
    assert step["existing_session"]["kind"] == "web" and "access_token" not in step
    assert (await client.get("/api/v1/auth/me", headers=first)).status_code == 200, "nothing changes before confirming"

    done = (await client.post("/api/v1/auth/login/confirm", json={"challenge_id": step["challenge_id"]})).json()
    assert done["status"] == "ok" and done["access_token"]
    r = await client.get("/api/v1/auth/me", headers=first)
    assert r.status_code == 401 and r.json()["error"]["code"] == "session_replaced"
    second = bearer(done["access_token"])
    assert (await client.get("/api/v1/auth/me", headers=second)).status_code == 200
    # A used step can't be replayed.
    r = await client.post("/api/v1/auth/login/confirm", json={"challenge_id": step["challenge_id"]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "login_challenge_expired"

    # The same browser signing in again needs no confirmation.
    again = await _login(client, email, cid="laptop-browser-2")
    assert again["status"] == "ok"
    sessions = (await client.get("/api/v1/auth/sessions", headers=bearer(again["access_token"]))).json()
    assert sessions["web"]["current"] is True and sessions["mobile"] is None

    assert (await client.post("/api/v1/auth/logout", headers=bearer(again["access_token"]))).status_code == 204
    r = await client.get("/api/v1/auth/me", headers=bearer(again["access_token"]))
    assert r.status_code == 401 and r.json()["error"]["code"] == "token_revoked"
    # Signed out everywhere → the next sign-in (any browser) goes straight through.
    assert (await _login(client, email, cid="third-browser-xyz"))["status"] == "ok"


async def test_production_requires_the_emailed_code(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "LOGIN_OTP_REQUIRED", True)
    u = await register(client)
    email = u["user"]["email"]
    step = await _login(client, email)
    assert step["status"] == "confirm" and step["otp_required"] is True
    assert step["otp_sent_to"].endswith("@example.com") and "•" in step["otp_sent_to"]
    assert step["dev_code"] and len(step["dev_code"]) == 6  # dev with email off only

    r = await client.post("/api/v1/auth/login/confirm", json={"challenge_id": step["challenge_id"], "code": "000000"
                                                              if step["dev_code"] != "000000" else "111111"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_login_code"
    r = await client.post("/api/v1/auth/login/confirm", json={"challenge_id": step["challenge_id"]})
    assert r.status_code == 401
    resent = (await client.post("/api/v1/auth/login/resend", json={"challenge_id": step["challenge_id"]})).json()
    assert resent["status"] == "sent" and resent["dev_code"]
    ok = (await client.post("/api/v1/auth/login/confirm",
                            json={"challenge_id": step["challenge_id"], "code": resent["dev_code"]})).json()
    assert ok["status"] == "ok" and ok["access_token"]

    # Five wrong codes burn the step.
    step = await _login(client, email)
    wrong = "123456" if step["dev_code"] != "123456" else "654321"
    for _ in range(settings.LOGIN_CODE_MAX_ATTEMPTS):
        await client.post("/api/v1/auth/login/confirm", json={"challenge_id": step["challenge_id"], "code": wrong})
    r = await client.post("/api/v1/auth/login/confirm", json={"challenge_id": step["challenge_id"], "code": step["dev_code"]})
    assert r.status_code in (400, 429)


async def test_email_code_sign_in(client: AsyncClient) -> None:
    u = await register(client)
    email = u["user"]["email"]
    start = (await client.post("/api/v1/auth/email-code", json={"email": email})).json()
    assert start["challenge_id"] and start["dev_code"] and "•" in start["sent_to"]
    unknown = (await client.post("/api/v1/auth/email-code", json={"email": "nobody-here@example.com"})).json()
    assert unknown["challenge_id"] and "dev_code" not in unknown  # same shape, nothing sent
    r = await client.post("/api/v1/auth/email-code/verify", json={"challenge_id": unknown["challenge_id"], "code": "123456"})
    assert r.status_code == 401

    done = (await client.post("/api/v1/auth/email-code/verify",
                              json={"challenge_id": start["challenge_id"], "code": start["dev_code"]})).json()
    assert done["status"] == "ok"  # same browser as the register session
    assert done["user"]["email_verified"] is True, "receiving the code proves the address"


async def test_passkey_endpoints(client: AsyncClient) -> None:
    u = await register(client)
    h = bearer(u["access_token"])
    opts = (await client.post("/api/v1/auth/passkeys/register/options", headers=h)).json()
    assert opts["challenge_id"] and opts["options"]["challenge"] and opts["options"]["rp"]["id"]
    assert opts["options"]["authenticatorSelection"]["residentKey"] == "required"
    r = await client.post("/api/v1/auth/passkeys/register/verify", headers=h,
                          json={"challenge_id": opts["challenge_id"], "credential": {"id": "x", "rawId": "x",
                                                                                     "type": "public-key", "response": {}}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "passkey_invalid"
    assert (await client.get("/api/v1/auth/passkeys", headers=h)).json() == []

    login = (await client.post("/api/v1/auth/passkeys/login/options", json={})).json()
    assert login["challenge_id"] and login["options"]["challenge"]
    r = await client.post("/api/v1/auth/passkeys/login/verify",
                          json={"challenge_id": login["challenge_id"], "credential": {"id": "nope", "rawId": "nope"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "passkey_unknown"


# ── country ──────────────────────────────────────────────────────────────────
async def test_country_is_required_and_cannot_be_cleared(client: AsyncClient) -> None:
    base = {"email": f"c-{uuid.uuid4().hex[:6]}@example.com", "password": PASSWORD, "full_name": "C"}
    r = await client.post("/api/v1/auth/register", json=base)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "body.country"
    r = await client.post("/api/v1/auth/register", json={**base, "country": "XX"})
    assert r.status_code == 422
    r = await client.post("/api/v1/auth/register", json={**base, "country": "ke"})
    assert r.status_code == 201 and r.json()["user"]["country"] == "KE"
    h = bearer(r.json()["access_token"])
    assert (await client.patch("/api/v1/auth/me", json={"country": ""}, headers=h)).status_code == 422
    assert (await client.patch("/api/v1/auth/me", json={"country": "ug"}, headers=h)).json()["country"] == "UG"


# ── phone: one phone per account ─────────────────────────────────────────────
async def test_phone_takeover_code_and_account(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    p = await register_personal(client)
    s1 = await phone_login(client, p, installation="install-phone-one")

    monkeypatch.setattr(settings, "LOGIN_OTP_REQUIRED", True)
    r = await client.post("/api/v1/personal/sessions", json={"email": p["email"], "password": PASSWORD,
                                                             "device_name": "Galaxy S24", "installation_id": "install-phone-two"})
    assert r.status_code == 202, r.text
    step = r.json()
    assert step["otp_required"] is True and step["existing_session"]["device_name"] == "Pixel 8"
    r = await client.post("/api/v1/personal/sessions/confirm", json={"challenge_id": step["challenge_id"], "code": "999999"
                                                                     if step["dev_code"] != "999999" else "888888"})
    assert r.status_code == 401
    r = await client.post("/api/v1/personal/sessions/confirm",
                          json={"challenge_id": step["challenge_id"], "code": step["dev_code"]})
    assert r.status_code == 201 and r.json()["session"]["device_name"] == "Galaxy S24"
    s2 = bearer(r.json()["session_token"])
    r = await client.get("/api/v1/personal/cards", headers=s1["headers"])
    assert r.status_code == 401 and r.json()["error"]["code"] == "session_replaced"

    # Passwordless on the phone: email code (no extra code needed, it *is* the code).
    code = (await client.post("/api/v1/personal/email-code", json={"email": p["email"]})).json()
    r = await client.post("/api/v1/personal/sessions", json={"email_code_challenge_id": code["challenge_id"],
                                                             "email_code": code["dev_code"],
                                                             "installation_id": "install-phone-two"})
    assert r.status_code == 201, r.text  # same phone → straight in
    s2 = bearer(r.json()["session_token"])

    # Account: country can change, never be cleared; optional photo.
    r = await client.patch("/api/v1/personal/account", json={"country": "tz"}, headers=s2)
    assert r.status_code == 200 and r.json()["country"] == "TZ"
    assert (await client.patch("/api/v1/personal/account", json={"country": ""}, headers=s2)).status_code == 422
    buf = io.BytesIO()
    Image.new("RGB", (300, 300), (20, 120, 200)).save(buf, format="PNG")
    r = await client.post("/api/v1/personal/account/avatar", headers=s2, files={"file": ("me.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200 and r.json()["avatar_url"]
    assert (await client.delete("/api/v1/personal/account/avatar", headers=s2)).json()["avatar_url"] is None

    # From the web, the phone can be listed and signed out.
    web = (await client.get("/api/v1/auth/sessions", headers=p["headers"])).json()
    assert web["mobile"]["device_name"] == "Pixel 8" or web["mobile"]["device_name"]
    assert (await client.delete("/api/v1/auth/sessions/mobile", headers=p["headers"])).status_code == 204
    assert (await client.get("/api/v1/personal/cards", headers=s2)).status_code == 401


# ── admin demographics ───────────────────────────────────────────────────────
async def test_admin_demographics_by_country(client: AsyncClient) -> None:
    for country in ("RW", "RW", "KE"):
        r = await client.post("/api/v1/auth/register", json={
            "email": f"d-{uuid.uuid4().hex[:6]}@example.com", "password": PASSWORD, "full_name": "D", "country": country,
            "account_type": "personal"})
        assert r.status_code == 201
    admin = await _admin(client)
    d = (await client.get("/api/v1/admin/demographics", headers=admin)).json()
    counts = {row["country"]: row for row in d["by_country"]}
    assert counts["RW"]["users"] >= 2 and counts["RW"]["personal"] >= 2 and counts["KE"]["users"] >= 1
    assert d["total_users"] >= 4 and d["countries"] >= 2 and len(d["signups_by_month"]) == 12
    assert d["by_account_type"]["personal"] >= 3
    page = (await client.get("/api/v1/admin/accounts", params={"country": "ke"}, headers=admin)).json()
    assert page["total"] >= 1 and all(i["country"] == "KE" for i in page["items"] if "country" in i)
    assert (await client.get("/api/v1/admin/demographics", headers=bearer((await register(client))["access_token"]))
            ).status_code == 403
