"""Part 2: profiles, customers' cards, demo seed, public status."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Business, Card, CardTap, User
from app.services.demo import BIZ_EMAIL, DEV_EMAIL, seed_demo
from tests.conftest import bearer
from tests.p2_helpers import BROWSER_UA, create_card, create_employee, register_business


async def test_profiles_crud_and_validation(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    r = await client.post(f"{base}/profiles", json={
        "type": "product", "title": "Espresso Machine", "slug": "Espresso Pro", "published": True,
        "theme": {"accent": "#123abc"},
        "sections": [{"type": "products", "items": [{"title": "Pro", "description": "x", "price": "499"}]},
                     {"type": "buttons", "items": [{"label": "Buy", "action": {"type": "website",
                                                                               "config": {"url": "https://shop.example.com"}}}]}]},
        headers=owner["headers"])
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["slug"] == "espresso-pro" and p["public_url"].endswith(f"/b/{owner['slug']}/espresso-pro")
    r = await client.post(f"{base}/profiles", json={"title": "Dup", "slug": "espresso-pro"}, headers=owner["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "slug_taken"
    r = await client.post(f"{base}/profiles", json={"title": "Bad", "sections": [{"type": "iframe"}]}, headers=owner["headers"])
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "body.sections.0.type"
    r = await client.post(f"{base}/profiles", json={"title": "Bad", "sections": [{"type": "buttons", "items": [
        {"label": "x", "action": {"type": "developer_webhook", "config": {}}}]}]}, headers=owner["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_action_config"
    r = await client.post(f"{base}/profiles", json={"title": "Bad", "theme": {"accent": "red"}}, headers=owner["headers"])
    assert r.status_code == 422

    pub = (await client.get(f"/api/v1/public/b/{owner['slug']}/espresso-pro")).json()
    assert pub["profile"]["title"] == "Espresso Machine" and pub["employee"] is None
    r = await client.patch(f"{base}/profiles/{p['id']}", json={"title": "Espresso Pro X"}, headers=owner["headers"])
    assert r.json()["title"] == "Espresso Pro X"
    assert (await client.delete(f"{base}/profiles/{p['id']}", headers=owner["headers"])).status_code == 204
    assert (await client.get(f"/api/v1/public/b/{owner['slug']}/espresso-pro")).status_code == 404

    emp = await create_employee(client, owner, "Grace", "Mukamana", email="grace@example.com")
    pub = (await client.get(f"/api/v1/public/b/{owner['slug']}/grace-mukamana")).json()
    assert pub["employee"]["full_name"] == "Grace Mukamana" and pub["employee"]["email"] == "grace@example.com"
    v = await client.get(f"/api/v1/public/b/{owner['slug']}/grace-mukamana/vcard")
    assert "FN:Grace Mukamana" in v.text
    r = await client.delete(f"{base}/profiles/{emp['profile_id']}", headers=owner["headers"])
    assert r.status_code == 409


async def test_customer_cards_and_inactive_customer(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    cust = (await client.post(f"{base}/customers", json={"full_name": "Eric N"}, headers=owner["headers"])).json()
    card = await create_card(client, owner, name="Loyalty", assignee_type="customer", assignee_id=cust["id"])
    assert card["assignee"]["type"] == "customer" and card["effective_status"] == "active"
    await client.get(f"/t/{card['public_code']}", headers={"User-Agent": BROWSER_UA})
    c = (await client.get(f"{base}/customers/{cust['id']}", headers=owner["headers"])).json()
    assert c["total_taps"] == 1 and c["cards"][0]["id"] == card["id"]
    await client.patch(f"{base}/customers/{cust['id']}", json={"status": "inactive"}, headers=owner["headers"])
    c = (await client.get(f"{base}/cards/{card['id']}", headers=owner["headers"])).json()
    assert c["effective_status"] == "inactive_owner"
    taps = (await client.get(f"{base}/taps?customer_id={cust['id']}", headers=owner["headers"])).json()
    assert taps["total"] == 1 and taps["items"][0]["assignee"]["name"] == "Eric N"


async def test_demo_seed_is_idempotent_and_usable(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SEED_DEMO_DATA", True)
    async with SessionLocal() as s:
        await seed_demo(s)
    async with SessionLocal() as s:
        await seed_demo(s)  # second run: no duplicates
        users = (await s.execute(select(func.count()).select_from(User).where(User.email.in_([DEV_EMAIL, BIZ_EMAIL])))).scalar_one()
        businesses = (await s.execute(select(func.count()).select_from(Business))).scalar_one()
        cards = (await s.execute(select(func.count()).select_from(Card))).scalar_one()
        taps = (await s.execute(select(func.count()).select_from(CardTap))).scalar_one()
    assert (users, businesses, cards, taps) == (2, 1, 6, 120)
    for email in (DEV_EMAIL, BIZ_EMAIL):
        r = await client.post("/api/v1/auth/login", json={"email": email, "password": "DemoPassword123"})
        assert r.status_code == 200, email
    biz = (await client.post("/api/v1/auth/login", json={"email": BIZ_EMAIL, "password": "DemoPassword123"})).json()
    bid = biz["user"]["memberships"][0]["business_id"]
    a = (await client.get(f"/api/v1/businesses/{bid}/analytics?range=30d", headers=bearer(biz["access_token"]))).json()
    assert a["totals"]["taps"] == 120
    dev = (await client.post("/api/v1/auth/login", json={"email": DEV_EMAIL, "password": "DemoPassword123"})).json()
    ov = (await client.get("/api/v1/overview", headers=bearer(dev["access_token"]))).json()
    assert ov["applications"] == 1 and ov["active_devices"] == 2
    assert (await client.get(f"/api/v1/public/b/{biz['user']['memberships'][0]['business_slug']}")).status_code == 200


async def test_meta_status(client: AsyncClient) -> None:
    body = (await client.get("/api/v1/meta/status")).json()
    assert body["maintenance_message"] is None and body["public_web_url"] == "http://web.test"
    assert body["public_api_url"] == "http://testserver"
