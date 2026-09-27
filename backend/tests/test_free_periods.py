"""Free-period promotions ("1 year free"): admin set-up, in-app claim per account type, reminder and automatic end."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Notification, PromotionClaim
from app.services import free_periods
from tests.conftest import bearer, register
from tests.p2_helpers import register_business
from tests.test_part4 import register_personal


async def _admin(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    return bearer(r.json()["access_token"])


async def _free_year(client: AsyncClient, admin: dict[str, str], **extra: Any) -> dict[str, Any]:
    r = await client.post("/api/v1/admin/promotions", headers=admin, json={
        "name": "1 year free", "discount_type": "free", "discount_value": 12,
        "plan_codes": ["pro", "biz_growth", "personal_pro"], "banner_text": "Claim a free year", **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_add_months() -> None:
    assert free_periods.add_months(datetime(2026, 1, 31, tzinfo=UTC), 1).day == 28
    assert free_periods.add_months(datetime(2026, 9, 27, tzinfo=UTC), 12) == datetime(2027, 9, 27, tzinfo=UTC)


async def test_admin_validation(client: AsyncClient) -> None:
    admin = await _admin(client)
    base = {"name": "Bad", "discount_type": "free", "discount_value": 12}
    for body, field in ((base, "body.plan_codes"),
                        ({**base, "discount_value": 48, "plan_codes": ["pro"]}, "body.discount_value"),
                        ({**base, "plan_codes": ["free"]}, "body.plan_codes"),
                        ({**base, "plan_codes": ["pro", "business"]}, "body.plan_codes")):
        r = await client.post("/api/v1/admin/promotions", headers=admin, json=body)
        assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == field, (body, r.text)


async def test_claim_each_account_type_and_automatic_end(client: AsyncClient) -> None:
    admin = await _admin(client)
    promo = await _free_year(client, admin)

    # Developer on the free plan.
    dev = await register(client)
    h = bearer(dev["access_token"])
    listing = (await client.get("/api/v1/billing/free-offers", headers=h)).json()
    offer = next(o for o in listing["offers"] if o["promotion_id"] == promo["id"])
    assert offer["eligible"] and offer["months"] == 12 and offer["plan"]["code"] == "pro" and listing["active"] is None
    r = await client.post(f"/api/v1/billing/free-offers/{promo['id']}/claim", headers=h, json={})
    assert r.status_code == 201, r.text
    assert r.json()["active"]["plan_code"] == "pro" and r.json()["active"]["ends_at"].startswith(str(datetime.now(UTC).year + 1))
    assert (await client.get("/api/v1/billing/subscription", headers=h)).json()["plan"]["code"] == "pro"
    again = await client.post(f"/api/v1/billing/free-offers/{promo['id']}/claim", headers=h, json={})
    assert again.status_code == 409 and again.json()["error"]["details"]["reason"] == "already_claimed"
    # The free period doesn't change the price shown for the paid plan.
    plans = (await client.get("/api/v1/billing/plans")).json()
    pro = next(p for p in plans if p["code"] == "pro")
    assert not pro.get("promotion") or pro["promotion"]["discount_type"] != "free"

    # Business owner: the business itself is upgraded.
    owner = await register_business(client)
    bh = owner["headers"]
    r = await client.post(f"/api/v1/billing/free-offers/{promo['id']}/claim", headers=bh, json={})
    assert r.status_code == 201, r.text
    biz = (await client.get(f"/api/v1/businesses/{owner['business_id']}", headers=bh)).json()
    assert biz["plan"]["code"] == "biz_growth"

    # Personal account.
    person = await register_personal(client)
    r = await client.post(f"/api/v1/billing/free-offers/{promo['id']}/claim", headers=person["headers"], json={})
    assert r.status_code == 201 and r.json()["active"]["plan_code"] == "personal_pro"

    # 14 days before the end: a reminder; after the end: back to the free plans.
    async with SessionLocal() as session:
        ends = (await session.execute(select(PromotionClaim.ends_at).where(
            PromotionClaim.promotion_id == promo["id"]))).scalars().first()
        reminded, ended = await free_periods.sweep(session, ends - timedelta(days=10))
        assert reminded == 3 and ended == 0
        reminded, ended = await free_periods.sweep(session, ends + timedelta(minutes=1))
        assert ended == 3
        titles = (await session.execute(select(Notification.title).where(Notification.type == "promotion"))).scalars().all()
        assert any("ends on" in t for t in titles) and any("has ended" in t for t in titles)
    assert (await client.get("/api/v1/billing/subscription", headers=h)).json()["plan"]["code"] == "free"
    biz = (await client.get(f"/api/v1/businesses/{owner['business_id']}", headers=bh)).json()
    assert biz["plan"] is None or biz["plan"]["code"] == "biz_starter"
    # Claimed once: not claimable again after it ended.
    listing = (await client.get("/api/v1/billing/free-offers", headers=h)).json()
    assert next(o for o in listing["offers"] if o["promotion_id"] == promo["id"])["reason"] == "already_claimed"


async def test_paid_accounts_cannot_claim(client: AsyncClient) -> None:
    admin = await _admin(client)
    first = await _free_year(client, admin, name="Free year A")
    second = await _free_year(client, admin, name="Free year B")
    dev = await register(client)
    h = bearer(dev["access_token"])
    assert (await client.post(f"/api/v1/billing/free-offers/{first['id']}/claim", headers=h, json={})).status_code == 201
    listing = (await client.get("/api/v1/billing/free-offers", headers=h)).json()
    b = next(o for o in listing["offers"] if o["promotion_id"] == second["id"])
    assert not b["eligible"] and b["reason"] == "free_period_running"
    r = await client.post(f"/api/v1/billing/free-offers/{second['id']}/claim", headers=h, json={})
    assert r.status_code == 409
