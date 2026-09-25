"""Demo data (Part 2 §A4) — only when SEED_DEMO_DATA=true AND ENVIRONMENT=development. Idempotent."""

from __future__ import annotations

import logging
import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import generate_device_token, generate_webhook_secret, hash_password, sha256_hex
from app.models import (
    Application,
    Card,
    CardTap,
    Customer,
    Delivery,
    Device,
    Employee,
    NfcEvent,
    Profile,
    User,
)
from app.services import business as biz
from app.services import plans as plan_service
from app.services import sandbox as sandbox_service
from app.services import usage
from app.services.applications import new_api_key, set_webhook_secret
from app.services.taps import visitor_hash

logger = logging.getLogger("app.demo")

DEV_EMAIL = "developer.demo@example.com"
BIZ_EMAIL = "business.demo@example.com"

_UIDS = ["04A1B2C3D4E5F6", "04B2C3D4E5F601", "04C3D4E5F60102", "04D4E5F6010203", "04E5F601020304", "04F60102030405"]
_UAS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
]


async def _user(session: AsyncSession, email: str, name: str, account_type: str) -> User:
    user = User(email=email, password_hash=hash_password(settings.DEMO_PASSWORD), full_name=name, role="developer",
                is_active=True, account_type=account_type, email_verified=True, email_verified_at=datetime.now(UTC))
    session.add(user)
    await session.flush()
    await plan_service.create_free_subscription(session, user)
    return user


def _device(app: Application, name: str, model: str, installation: str) -> Device:
    return Device(application_id=app.id, owner_id=app.owner_id, name=name, platform="android", model=model,
                  os_version="Android 15", app_version="1.0.0", installation_id=installation,
                  token_hash=sha256_hex(generate_device_token()), status="active", events_count=0,
                  last_seen_at=datetime.now(UTC) - timedelta(minutes=1), last_ip="192.168.1.50")


async def seed_demo_promotion(session: AsyncSession) -> None:
    """One demo promotion (Part 3), idempotent by code."""
    from app.models import Promotion

    if (await session.execute(select(Promotion.id).where(Promotion.code == "LAUNCH20"))).first():
        return
    now = datetime.now(UTC)
    session.add(Promotion(
        name="Launch offer", code="LAUNCH20", description="20% off paid plans for the first months (demo).",
        discount_type="percent", discount_value=20, audience="all", plan_codes=["pro", "biz_growth"],
        starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=30), is_active=True, show_on_landing=True,
        banner_text="Launch offer: 20% off Pro and Growth", max_redemptions=None, redemptions=0))
    await session.commit()


async def seed_demo(session: AsyncSession) -> None:
    await seed_demo_promotion(session)
    exists = (await session.execute(select(User.id).where(User.email.in_([DEV_EMAIL, BIZ_EMAIL])))).first()
    if exists:
        return
    rng = random.Random(42)
    now = datetime.now(UTC)

    # ── Demo developer ──────────────────────────────────────────────────
    dev = await _user(session, DEV_EMAIL, "Demo Developer", "developer")
    sandbox = sandbox_service.new_endpoint(dev.id, "Default sandbox")
    session.add(sandbox)
    app = Application(owner_id=dev.id, name="Demo Access Control", description="Door readers (demo data)",
                      is_active=True, delivery_mode="relay", endpoint_url=sandbox_service.sandbox_url(sandbox.token),
                      endpoint_enabled=True, endpoint_timeout_seconds=10, endpoint_custom_headers={}, allowed_domains=[])
    set_webhook_secret(app, generate_webhook_secret())
    session.add(app)
    await session.flush()
    sandbox.application_id = app.id
    key, _ = new_api_key(app, "Default key")
    session.add(key)
    devices = [_device(app, "Front door Pixel", "Pixel 8", "demo-dev-install-1"),
               _device(app, "Warehouse Galaxy", "Galaxy S23", "demo-dev-install-2")]
    session.add_all(devices)
    await session.flush()
    for i in range(40):
        d = devices[i % 2]
        received = now - timedelta(days=rng.randint(0, 13), minutes=rng.randint(0, 1400))
        ok = rng.random() > 0.1
        ev = NfcEvent(id=uuid.uuid4(), application_id=app.id, device_id=d.id, owner_id=dev.id,
                      event_type="card.detected", card_id=rng.choice(_UIDS), card_type="mifare_ultralight",
                      card_technologies=["NfcA", "MifareUltralight"], delivery_mode="relay",
                      status="delivered" if ok else "failed", attempts=1 if ok else 4,
                      last_status_code=200 if ok else 503, last_error=None if ok else "HTTP 503",
                      last_error_code=None if ok else "delivery_http_5xx",
                      detected_at=received, received_at=received, delivered_at=received if ok else None)
        session.add(ev)
        d.events_count += 1
        await session.flush()
        session.add(Delivery(event_id=ev.id, application_id=app.id, owner_id=dev.id, attempt=1, mode="relay",
                             url=app.endpoint_url, success=ok, status_code=200 if ok else 503,
                             latency_ms=rng.randint(40, 400), error=None if ok else "HTTP 503",
                             error_code=None if ok else "delivery_http_5xx", response_excerpt='{"ok":true}'))
        await usage.bump(session, application_id=app.id, owner_id=dev.id, day=received.date(), events=1,
                         delivered=1 if ok else 0, failed=0 if ok else 1)

    # ── Demo business ───────────────────────────────────────────────────
    owner = await _user(session, BIZ_EMAIL, "Demo Business Owner", "business")
    business = await biz.create_workspace(session, owner, {
        "name": "Acme Café", "email": BIZ_EMAIL, "phone": "+250788000111", "country": "RW", "category": "cafe",
        "description": "Specialty coffee, fresh pastries and fast Wi-Fi in the heart of Kigali.",
        "website": "https://example.com", "address": "KN 4 Ave, Kigali",
    })
    terminal = await biz.terminal_application(session, business.id)
    assert terminal is not None
    biz_sandbox = sandbox_service.new_endpoint(owner.id, "Business sandbox", business.id, terminal.id)
    session.add(biz_sandbox)
    menu = Profile(business_id=business.id, type="menu", slug="menu", title="Our menu", published=True,
                   theme={"accent": "#b91c1c"}, sections=[{"type": "menu", "categories": [
                       {"name": "Coffee", "items": [
                           {"name": "Espresso", "description": "Double shot", "price": "2.00", "tags": ["hot"]},
                           {"name": "Cappuccino", "description": "Milk foam", "price": "3.00", "tags": ["hot"]}]},
                       {"name": "Pastries", "items": [
                           {"name": "Croissant", "description": "Butter", "price": "1.50", "tags": []}]}]}])
    session.add(menu)
    employees = []
    for first, last, position, dept in (("Alice", "Uwase", "Store Manager", "Management"),
                                        ("John", "Doe", "Sales Manager", "Sales"),
                                        ("Grace", "Mukamana", "Barista", "Service")):
        e = Employee(business_id=business.id, first_name=first, last_name=last, position=position, department=dept,
                     phone="+250788000222", email=f"{first.lower()}@example.com", social_links=[],
                     slug=biz.slugify(f"{first} {last}"), status="active", total_taps=0)
        session.add(e)
        employees.append(e)
    await session.flush()
    for e in employees:
        session.add(Profile(business_id=business.id, type="employee", slug=e.slug, title=e.full_name, employee_id=e.id,
                            published=True, theme={"accent": "#b91c1c"},
                            sections=[{"type": "contact", "phone": e.phone, "email": e.email}]))
    customers = [Customer(business_id=business.id, full_name=n, email=f"{n.split()[0].lower()}@example.com",
                          tags=["vip"] if i == 0 else [], status="active", total_taps=0)
                 for i, n in enumerate(("Eric Nshuti", "Diane Ingabire"))]
    session.add_all(customers)
    await session.flush()
    cards = [
        Card(business_id=business.id, kind="card", name="Alice's card", uid=_UIDS[0], employee_id=employees[0].id,
             action={"type": "employee_profile", "config": {}}),
        Card(business_id=business.id, kind="card", name="John's card", uid=_UIDS[1], employee_id=employees[1].id,
             action={"type": "share_contact", "config": {}}),
        Card(business_id=business.id, kind="card", name="VIP loyalty card", uid=_UIDS[2], customer_id=customers[0].id),
        Card(business_id=business.id, kind="tag", name="Table 1 menu", uid=_UIDS[3],
             action={"type": "digital_menu", "config": {"profile_id": None}}),
        Card(business_id=business.id, kind="tag", name="Guest Wi-Fi", uid=_UIDS[4],
             action={"type": "wifi", "config": {"ssid": "AcmeCafe-Guest", "password": "coffee2026",
                                                "security": "WPA", "hidden": False}}),
        Card(business_id=business.id, kind="tag", name="WhatsApp orders", uid=None,
             action={"type": "whatsapp", "config": {"phone": "+250788000111", "message": "Hi Acme Café!"}}),
    ]
    for c in cards:
        c.public_code = biz.generate_public_code()
        c.status = "active"
        c.total_taps = 0
        c.unique_visitors = 0
        c.programmed_at = now - timedelta(days=20) if c.uid else None
        session.add(c)
    await session.flush()
    cards[3].action = {"type": "digital_menu", "config": {"profile_id": str(menu.id)}}
    reader = _device(terminal, "Counter Pixel", "Pixel 7a", "demo-biz-install-1")
    reader.assigned_employee_id = employees[0].id
    session.add(reader)
    await session.flush()
    for i in range(120):
        c = rng.choice(cards)
        source = "reader" if (c.uid and rng.random() < 0.25) else "web"
        ua = rng.choice(_UAS)
        created = now - timedelta(days=rng.randint(0, 29), hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
        vh = visitor_hash(f"10.0.{rng.randint(0, 9)}.{rng.randint(1, 60)}", ua, created.strftime("%Y-%m-%d")) \
            if source == "web" else None
        assignee = biz.assignee_of(c)
        session.add(CardTap(
            business_id=business.id, card_id=c.id, card_name=c.name, card_kind=c.kind,
            assignee_type=assignee["type"] if assignee else None, assignee_id=assignee["id"] if assignee else None,
            assignee_name=assignee["name"] if assignee else None, source=source,
            action_type=(c.action or {}).get("type", "business_profile"),
            result="redirected" if (c.action or {}).get("type") not in ("share_contact", "wifi") else
            ("vcard" if (c.action or {}).get("type") == "share_contact" else "page"),
            device_id=reader.id if source == "reader" else None, device_name=reader.name if source == "reader" else None,
            visitor_hash=vh, device_type=("ios" if "iPhone" in ua else "android") if source == "web" else "android",
            browser=("safari" if "iPhone" in ua else "chrome") if source == "web" else None,
            country="RW" if source == "web" else None, is_bot=False, created_at=created))
        c.total_taps += 1
        if vh:
            c.unique_visitors += 1
        c.last_tap_at = max(c.last_tap_at or created, created)
        if c.employee_id:
            emp = next(e for e in employees if e.id == c.employee_id)
            emp.total_taps += 1
            emp.last_tap_at = max(emp.last_tap_at or created, created)
    await session.commit()
    logger.info("Demo data created: %s / %s (password from DEMO_PASSWORD)", DEV_EMAIL, BIZ_EMAIL)
