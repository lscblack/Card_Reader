"""Part 3 §3 emails, §4 profiles/avatars, §5 Error Center, §7 preferences."""

from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime
from email.message import EmailMessage

import httpx
import pytest
import respx
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import EmailLog
from app.services import branding, email as email_service, email_templates, request_logs
from tests.conftest import bearer, create_app, register, register_device
from tests.p2_helpers import register_business, token_from_url


async def _admin(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    return bearer(r.json()["access_token"])


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[EmailMessage]:
    sent: list[EmailMessage] = []

    async def fake_send(msg: EmailMessage) -> None:
        sent.append(msg)

    monkeypatch.setattr(settings, "EMAIL_ENABLED", True)
    monkeypatch.setattr(email_service, "send_email", fake_send)
    return sent


def _parts(msg: EmailMessage) -> tuple[str, str]:
    text = msg.get_body(preferencelist=("plain",)).get_content()
    html = msg.get_body(preferencelist=("html",)).get_content()
    return html, text


# ══ Templates ══════════════════════════════════════════════════════════════
@pytest.mark.parametrize("name", list(email_templates.TEMPLATES))
def test_every_template_renders_html_and_text(name: str) -> None:
    subject = "A message from the team" if name == "admin_message" else None
    r = email_templates.render(name, email_templates.sample_context(name), branding.merged({}), subject)
    assert r.subject and "nexTap" in (r.subject + r.html)
    assert '<meta name="color-scheme" content="light dark">' in r.html and "prefers-color-scheme: dark" in r.html
    assert 'role="presentation"' in r.html and "600" in r.html and "#B91C1C" in r.html
    assert 'href="http://nexventures.net/"' in r.html and "Powered by" in r.html
    assert "Powered by Nexventures" in r.text and "<" not in r.text.replace("<-", "")
    assert r.text.strip() and "You're receiving this" in r.text
    ctx = email_templates.sample_context(name)
    if ctx.get("action_url"):
        assert ctx["action_url"] in r.html and ctx["action_url"] in r.text


def test_templates_use_branding() -> None:
    brand = branding.merged({"product_name": "TapCloud", "theme": {"accent_light": "#1D4ED8"},
                             "company_address": "1 Main St", "support_email": "help@tap.example.com"})
    r = email_templates.render("welcome", email_templates.sample_context("welcome"), brand)
    assert r.subject == "Welcome to TapCloud" and "#1D4ED8" in r.html and "1 Main St" in r.html
    assert "help@tap.example.com" in r.text


def test_admin_markdown_is_safe() -> None:
    html = email_templates.render_markdown(
        "Hello <script>alert(1)</script> **bold** [click](javascript:alert(1)) [ok](https://example.com)"
        "\n\n<img src=x onerror=alert(1)>\n\n![img](https://tracker.example/x.png)", "#B91C1C")
    assert "<script>" not in html and "&lt;script&gt;" in html and "<strong" in html
    assert 'href="javascript' not in html and 'href="https://example.com"' in html
    assert "<img" not in html and "onerror=alert" not in html.replace("&lt;img src=x onerror=alert(1)&gt;", "")


# ══ Transactional emails: links sent but not stored ═══════════════════════
async def test_one_time_links_sent_but_not_stored(client: AsyncClient, outbox: list[EmailMessage],
                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    r = await client.post("/api/v1/auth/register", json={"email": "links@example.com", "password": "Sup3rSecretPass",
                                                         "full_name": "Link Tester"})
    assert r.status_code == 201 and r.json()["dev_verification_url"] is None  # email enabled → no dev link
    await client.post("/api/v1/auth/forgot-password", json={"email": "links@example.com"})
    verify_msg, reset_msg = outbox[0], outbox[1]
    assert verify_msg["Subject"] == "Verify your nexTap email" and verify_msg["To"] == "links@example.com"
    html, text = _parts(reset_msg)
    reset_link = next(w for w in text.split() if "reset-password?token=" in w)
    assert reset_link in html and "Reset password" in html and "Hi Link Tester" in text

    async with SessionLocal() as s:
        logs = {l.template: l for l in (await s.execute(select(EmailLog))).scalars()}
    assert set(logs) == {"verify_email", "password_reset"}
    stored = logs["password_reset"]
    assert stored.status == "sent" and stored.sent_at and stored.user_id is not None
    assert reset_link not in stored.html and reset_link not in stored.text_body
    assert "[link removed]" in stored.html and "[link removed]" in stored.text_body
    token = token_from_url(reset_link)
    assert token not in stored.html and token not in (logs["verify_email"].html or "")

    # reset → password_changed notice; verify → welcome
    await client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "Another-Pass-123"})
    verify_link = next(w for w in _parts(verify_msg)[1].split() if "verify-email?token=" in w)
    await client.post("/api/v1/auth/verify-email", json={"token": token_from_url(verify_link)})
    subjects = [m["Subject"] for m in outbox]
    assert "Your nexTap password was changed" in subjects and "Welcome to nexTap" in subjects


async def test_emails_logged_when_disabled_and_failures_recorded(client: AsyncClient,
                                                                 monkeypatch: pytest.MonkeyPatch) -> None:
    await register(client, email="quiet@example.com")
    async with SessionLocal() as s:
        log = (await s.execute(select(EmailLog))).scalar_one()
    assert log.status == "logged" and log.template == "verify_email"

    calls = {"n": 0}

    async def boom(msg: EmailMessage) -> None:
        calls["n"] += 1
        raise ConnectionRefusedError("smtp down")

    monkeypatch.setattr(settings, "EMAIL_ENABLED", True)
    monkeypatch.setattr(email_service, "send_email", boom)
    monkeypatch.setattr(email_service, "RETRY_DELAY_SECONDS", 0)
    await client.post("/api/v1/auth/forgot-password", json={"email": "quiet@example.com"})
    async with SessionLocal() as s:
        failed = (await s.execute(select(EmailLog).where(EmailLog.template == "password_reset"))).scalar_one()
    assert failed.status == "failed" and failed.attempts == 3 and "ConnectionRefusedError" in failed.error
    assert calls["n"] == 3


# ══ Admin emails & campaigns ═══════════════════════════════════════════════
async def test_campaign_recipients_by_filter_and_worker(client: AsyncClient, outbox: list[EmailMessage],
                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "EMAIL_ENABLED", False)
    admin = await _admin(client)
    dev1 = await register(client, email="dev1@example.com")
    await register(client, email="dev2@example.com")
    await register_business(client)  # verified business owner
    outbox.clear()

    r = await client.post("/api/v1/admin/emails", json={"subject": "Hi", "body_markdown": "x"}, headers=admin)
    assert r.status_code == 422
    r = await client.post("/api/v1/admin/emails", json={"user_ids": [dev1["user"]["id"]], "filter": {},
                                                        "subject": "Hi", "body_markdown": "x"}, headers=admin)
    assert r.status_code == 422
    r = await client.post("/api/v1/admin/emails", json={"filter": {"account_type": "business", "email_verified": False},
                                                        "subject": "Hi", "body_markdown": "x"}, headers=admin)
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_recipients"
    monkeypatch.setattr("app.api.v1.routes.admin_part3.MAX_RECIPIENTS", 1)
    r = await client.post("/api/v1/admin/emails", json={"filter": {"account_type": "developer"}, "subject": "Hi",
                                                        "body_markdown": "x"}, headers=admin)
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_many_recipients"
    monkeypatch.setattr("app.api.v1.routes.admin_part3.MAX_RECIPIENTS", 5000)

    for flt, expected in (({"account_type": "developer"}, 3),  # admin + 2 developers
                          ({"account_type": "business"}, 1),
                          ({"account_type": "developer", "email_verified": False}, 3),
                          ({"plan_code": "biz_starter"}, 1), ({"plan_code": "free"}, 4), ({"status": "inactive"}, 0)):
        count = (await client.post("/api/v1/admin/emails", json={
            "filter": flt, "subject": "Probe", "body_markdown": "probe"}, headers=admin))
        if expected == 0:
            assert count.status_code == 422, flt
        else:
            assert count.json()["recipients"] == expected, (flt, count.text)

    monkeypatch.setattr(settings, "EMAIL_ENABLED", True)
    r = await client.post("/api/v1/admin/emails", json={
        "filter": {"account_type": "developer"}, "subject": "Maintenance on Saturday",
        "body_markdown": "We're **upgrading** things.\n\n<script>x</script>",
        "cta": {"label": "Status page", "url": "https://status.example.com"}}, headers=admin)
    assert r.status_code == 202 and r.json()["recipients"] == 3
    campaign_id = r.json()["campaign_id"]
    processed = 0
    while (n := await email_service.process_queue(SessionLocal, batch=10)):  # drains probe campaigns too
        processed += n
    assert processed >= 3
    to = sorted(m["To"] for m in outbox if m["Subject"] == "Maintenance on Saturday")
    assert to == ["admin@example.com", "dev1@example.com", "dev2@example.com"]
    html, text = _parts(next(m for m in outbox if m["Subject"] == "Maintenance on Saturday"))
    assert "<strong" in html and "&lt;script&gt;" in html and "https://status.example.com" in html and "upgrading" in text

    camps = (await client.get("/api/v1/admin/email-campaigns", headers=admin)).json()
    camp = next(c for c in camps["items"] if c["id"] == campaign_id)
    assert camp["recipients"] == 3 and camp["sent"] == 3 and camp["failed"] == 0
    logs = (await client.get(f"/api/v1/admin/emails?campaign_id={campaign_id}", headers=admin)).json()
    assert logs["total"] == 3 and {i["status"] for i in logs["items"]} == {"sent"}
    one = (await client.get(f"/api/v1/admin/emails/{logs['items'][0]['id']}", headers=admin)).json()
    assert "Maintenance on Saturday" in one["html"] and one["text"]
    assert (await client.get("/api/v1/admin/emails?q=dev1", headers=admin)).json()["total"] >= 1

    # SMTP failures: retried by the worker, then failed after 3 attempts
    async def flaky(msg: EmailMessage) -> None:
        raise TimeoutError("smtp timeout")

    monkeypatch.setattr(email_service, "send_email", flaky)
    r = await client.post("/api/v1/admin/emails", json={"user_ids": [dev1["user"]["id"]], "subject": "Retry me",
                                                        "body_markdown": "x"}, headers=admin)
    cid = r.json()["campaign_id"]
    async with SessionLocal() as s:
        for _ in range(3):
            from sqlalchemy import update

            await s.execute(update(EmailLog).where(EmailLog.campaign_id == uuid.UUID(cid))
                            .values(next_attempt_at=datetime.now(UTC)))
            await s.commit()
            await email_service.process_queue(SessionLocal, batch=10)
        log = (await s.execute(select(EmailLog).where(EmailLog.campaign_id == uuid.UUID(cid))
                               .execution_options(populate_existing=True))).scalar_one()
    assert log.status == "failed" and log.attempts == 3 and "TimeoutError" in log.error


async def test_admin_email_preview_templates_and_access(client: AsyncClient, user: dict) -> None:
    admin = await _admin(client)
    r = await client.post("/api/v1/admin/emails/preview", json={"subject": "Hello", "body_markdown": "# Title\n\nBody",
                                                                "cta": {"label": "Go", "url": "https://x.example.com"}},
                          headers=admin)
    assert r.status_code == 200 and "Title" in r.json()["html"] and "Go: https://x.example.com" in r.json()["text"]
    names = {t["name"] for t in (await client.get("/api/v1/admin/email-templates", headers=admin)).json()}
    assert names == {"verify_email", "password_reset", "invitation", "welcome", "admin_message", "password_changed",
                     "digital_card_invite"}  # Part 4 §6 added digital_card_invite
    for name in names:
        p = (await client.get(f"/api/v1/admin/email-templates/{name}/preview", headers=admin)).json()
        assert p["html"].startswith("<!DOCTYPE html>") and p["text"] and p["subject"]
    assert (await client.get("/api/v1/admin/email-templates/nope/preview", headers=admin)).status_code == 404
    for method, path in (("GET", "/api/v1/admin/emails"), ("POST", "/api/v1/admin/emails/preview"),
                         ("GET", "/api/v1/admin/email-campaigns"), ("GET", "/api/v1/admin/email-templates"),
                         ("GET", "/api/v1/admin/errors"), ("GET", "/api/v1/admin/branding"),
                         ("POST", "/api/v1/admin/accounts/send-verification"),
                         ("POST", f"/api/v1/admin/accounts/{uuid.uuid4()}/send-verification")):
        r = await client.request(method, path, json={}, headers=user["headers"])
        assert r.status_code == 403, path


async def test_admin_send_verification(client: AsyncClient) -> None:
    admin = await _admin(client)
    a = await register(client)
    b = await register_business(client)  # already verified
    r = await client.post(f"/api/v1/admin/accounts/{a['user']['id']}/send-verification", headers=admin)
    assert r.status_code == 202 and r.json()["sent"] is True and "verify-email?token=" in r.json()["dev_verification_url"]
    r = await client.post(f"/api/v1/admin/accounts/{b['user']['id']}/send-verification", headers=admin)
    assert r.json() == {"sent": False, "already_verified": True, "dev_verification_url": None}
    r = await client.post("/api/v1/admin/accounts/send-verification",
                          json={"user_ids": [a["user"]["id"], b["user"]["id"]]}, headers=admin)
    assert r.status_code == 202 and r.json() == {"sent": 1, "skipped_already_verified": 1}


# ══ Profiles & avatars ═════════════════════════════════════════════════════
def _image(fmt: str, size: tuple[int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buf, format=fmt)
    return buf.getvalue()


async def test_profile_fields_and_avatar(client: AsyncClient, user: dict) -> None:
    h = user["headers"]
    r = await client.patch("/api/v1/auth/me", json={"phone": "+250788000111", "company": "Acme", "country": "rw",
                                                    "job_title": "CTO"}, headers=h)
    me = r.json()
    assert (me["phone"], me["company"], me["country"], me["job_title"]) == ("+250788000111", "Acme", "RW", "CTO")
    assert (await client.patch("/api/v1/auth/me", json={"country": "Rwanda"}, headers=h)).status_code == 422

    r = await client.post("/api/v1/auth/me/avatar", headers=h,
                          files={"file": ("me.jpg", io.BytesIO(_image("JPEG", (1200, 800))), "image/jpeg")})
    assert r.status_code == 200 and r.json()["avatar_url"].endswith(".webp")
    served = await client.get(r.json()["avatar_url"].replace("http://testserver", ""))
    img = Image.open(io.BytesIO(served.content))
    assert img.size == (256, 256) and img.format == "WEBP"
    r = await client.post("/api/v1/auth/me/avatar", headers=h, files={"file": ("x.gif", io.BytesIO(b"GIF89a..."), "image/gif")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_upload"
    r = await client.post("/api/v1/auth/me/avatar", headers=h,
                          files={"file": ("broken.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"junk" * 10), "image/png")})
    assert r.status_code == 422
    assert (await client.delete("/api/v1/auth/me/avatar", headers=h)).json()["avatar_url"] is None

    # login bookkeeping + admin view
    await client.post("/api/v1/auth/login", json={"email": user["user"]["email"], "password": "Sup3rSecretPass"})
    admin = await _admin(client)
    await client.post("/api/v1/auth/me/avatar", headers=h,
                      files={"file": ("me.png", io.BytesIO(_image("PNG", (300, 300))), "image/png")})
    d = (await client.get(f"/api/v1/admin/accounts/{user['user']['id']}", headers=admin)).json()
    assert d["login_count"] == 1 and d["last_login_at"] and d["avatar_url"] and d["company"] == "Acme"
    assert d["recent_logins"][0]["ip_address"] and d["memberships"] == []
    assert d["email_logs"][0]["template"] == "verify_email"
    r = await client.patch(f"/api/v1/admin/accounts/{user['user']['id']}", json={"job_title": "CEO", "country": "ke"},
                           headers=admin)
    assert r.json()["job_title"] == "CEO" and r.json()["country"] == "KE"
    r = await client.delete(f"/api/v1/admin/accounts/{user['user']['id']}/avatar", headers=admin)
    assert r.json()["avatar_url"] is None


async def test_preferences_merge_patch(client: AsyncClient, user: dict) -> None:
    h = user["headers"]
    r = await client.patch("/api/v1/auth/me/preferences", json={"tours_completed": ["developer.dashboard"],
                                                                "theme": {"density": "compact"}}, headers=h)
    assert r.json()["preferences"] == {"tours_completed": ["developer.dashboard"], "theme": {"density": "compact"}}
    r = await client.patch("/api/v1/auth/me/preferences", json={"tours_dismissed": True, "theme": {"mode": "dark"}},
                           headers=h)
    assert r.json()["preferences"] == {"tours_completed": ["developer.dashboard"], "tours_dismissed": True,
                                       "theme": {"density": "compact", "mode": "dark"}}
    r = await client.patch("/api/v1/auth/me/preferences", json={"theme": None}, headers=h)
    assert "theme" not in r.json()["preferences"]
    assert (await client.patch("/api/v1/auth/me/preferences", json={"blob": "x" * 9000}, headers=h)).status_code == 422
    assert (await client.patch("/api/v1/auth/me/preferences", json={"tours_completed": "all"}, headers=h)).status_code == 422
    assert (await client.patch("/api/v1/auth/me/preferences", json=[1], headers=h)).status_code == 422
    assert (await client.get("/api/v1/auth/me", headers=h)).json()["preferences"]["tours_dismissed"] is True


# ══ Error Center ═══════════════════════════════════════════════════════════
async def test_error_center_stats(client: AsyncClient, user: dict) -> None:
    admin = await _admin(client)
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": "https://hooks.example.com/e",
                                                                       "enabled": True}, headers=user["headers"])
    dev = await register_device(client, created["api_key_plaintext"])
    for _ in range(3):
        await client.get(f"/api/v1/applications/{uuid.uuid4()}", headers=user["headers"])
    with respx.mock() as mock:
        mock.post("https://hooks.example.com/e").mock(return_value=httpx.Response(503))
        for _ in range(2):
            await client.post("/api/v1/device/events", headers=bearer(dev["device_token"]), json={
                "event_id": str(uuid.uuid4()), "card_id": "04AABBCC", "detected_at": datetime.now(UTC).isoformat()})
    await request_logs.flush(SessionLocal)

    entries = (await client.get("/api/v1/admin/errors?range=24h", headers=admin)).json()
    by_code = {e["code"] + ":" + e["source"]: e for e in entries}
    nf = by_code["not_found:api"]
    assert nf["ref"] == "NFC-2002" and nf["stats"]["count"] == 3 and nf["stats"]["affected_users"] == 1
    assert nf["stats"]["previous_count"] == 0 and nf["stats"]["last_seen_at"]
    assert len(nf["stats"]["trend"]) in (24, 25) and sum(b["count"] for b in nf["stats"]["trend"]) == 3
    d5 = by_code["delivery_http_5xx:delivery"]
    assert d5["stats"]["count"] == 2 and d5["stats"]["affected_devices"] == 1
    assert by_code["nfc_disabled:mobile"]["stats"] is None
    assert entries[0]["stats"]["count"] == 3  # sorted by occurrences
    occurring = (await client.get("/api/v1/admin/errors?only_occurring=true", headers=admin)).json()
    assert {e["code"] for e in occurring} == {"not_found", "delivery_http_5xx"}
    assert {e["source"] for e in (await client.get("/api/v1/admin/errors?source=mobile", headers=admin)).json()} == {"mobile"}
    assert [e["ref"] for e in (await client.get("/api/v1/admin/errors?q=NFC-5006", headers=admin)).json()] == ["NFC-5006"]
    assert len((await client.get("/api/v1/admin/errors?range=7d", headers=admin)).json()[0]["stats"]["trend"]) >= 28

    detail = (await client.get("/api/v1/admin/errors/NFC-2002", headers=admin)).json()
    assert detail["top_routes"] == [{"route": "/api/v1/applications/{application_id}", "count": 3}]
    assert detail["top_users"][0]["email"] == user["user"]["email"] and len(detail["recent"]) == 3
    detail = (await client.get("/api/v1/admin/errors/NFC-5006", headers=admin)).json()
    assert len(detail["recent_deliveries"]) == 2 and detail["recent_deliveries"][0]["error_code"] == "delivery_http_5xx"
    mob = (await client.get("/api/v1/admin/errors/MOB-1002", headers=admin)).json()
    assert mob["stats"] is None and mob["code"] == "nfc_disabled"
    assert (await client.get("/api/v1/admin/errors/NFC-0000", headers=admin)).status_code == 404
