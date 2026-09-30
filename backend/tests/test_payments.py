"""Stripe upgrades: checkout session creation, activation on return / webhook, cancellation back to free."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services import payments
from tests.conftest import bearer, register
from tests.p2_helpers import register_business


class _Resource:
    def __init__(self, owner: "FakeStripe", kind: str) -> None:
        self.owner, self.kind = owner, kind

    async def create_async(self, params: dict[str, Any]) -> SimpleNamespace:
        self.owner.calls.append((self.kind, "create", params))
        n = len(self.owner.calls)
        if self.kind == "session":
            self.owner.sessions[f"cs_test_{n}"] = params
            return SimpleNamespace(id=f"cs_test_{n}", client_secret=f"cs_test_{n}_secret")
        if self.kind == "portal":
            return SimpleNamespace(url="https://billing.stripe.test/p/session")
        return SimpleNamespace(id=f"{self.kind}_{n}")

    async def retrieve_async(self, id_: str) -> SimpleNamespace:
        if self.kind == "session":
            return SimpleNamespace(id=id_, status=self.owner.status, payment_status=self.owner.payment_status,
                                   subscription=f"sub_{id_}")
        raise payments.stripe.InvalidRequestError("No such coupon", "id")

    async def cancel_async(self, id_: str) -> None:
        self.owner.canceled.append(id_)


class FakeStripe:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.sessions: dict[str, dict[str, Any]] = {}
        self.canceled: list[str] = []
        self.status, self.payment_status = "open", "unpaid"
        self.v1 = SimpleNamespace(
            customers=_Resource(self, "cus"), coupons=_Resource(self, "coupon"),
            checkout=SimpleNamespace(sessions=_Resource(self, "session")),
            billing_portal=SimpleNamespace(sessions=_Resource(self, "portal")),
            subscriptions=_Resource(self, "sub"),
            accounts=SimpleNamespace(retrieve_current_async=self._account),
        )
        self.event: Any = None

    async def _account(self) -> SimpleNamespace:
        return SimpleNamespace(id="acct_1", business_profile=SimpleNamespace(name="nexTap Test"), settings=None)

    def construct_event(self, payload: bytes, sig: str | None, secret: str) -> Any:
        if sig != "good":
            raise payments.stripe.SignatureVerificationError("bad", sig)
        return self.event


@pytest.fixture
def fake_stripe(monkeypatch: pytest.MonkeyPatch) -> FakeStripe:
    fake = FakeStripe()
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setattr(settings, "STRIPE_PUBLISHABLE_KEY", "pk_test_x")
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "whsec_x")
    async def _fake_client(session: Any, **_: Any) -> FakeStripe:
        return fake

    monkeypatch.setattr(payments, "_client", _fake_client)
    monkeypatch.setattr(payments, "make_client", lambda key: fake)
    return fake


async def test_disabled_without_keys(client: AsyncClient) -> None:
    h = bearer((await register(client))["access_token"])
    state = (await client.get("/api/v1/billing/payments", headers=h)).json()
    assert state["enabled"] is False and state["can_manage"] is False
    r = await client.post("/api/v1/billing/checkout", headers=h, json={"plan_code": "pro"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "payments_disabled"


async def test_developer_upgrade_then_cancel(client: AsyncClient, fake_stripe: FakeStripe) -> None:
    h = bearer((await register(client))["access_token"])
    assert (await client.post("/api/v1/billing/checkout", headers=h, json={"plan_code": "biz_growth"})).status_code == 422
    assert (await client.post("/api/v1/billing/checkout", headers=h, json={"plan_code": "free"})).status_code == 422

    r = await client.post("/api/v1/billing/checkout", headers=h, json={"plan_code": "pro", "interval": "year"})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["client_secret"].endswith("_secret") and out["publishable_key"] == "pk_test_x"
    params = fake_stripe.sessions[out["session_id"]]
    assert params["ui_mode"] == "elements" and params["mode"] == "subscription"
    assert params["line_items"][0]["price_data"]["unit_amount"] == 29000
    assert params["line_items"][0]["price_data"]["recurring"] == {"interval": "year"}

    # Not paid yet: still open, plan unchanged.
    res = (await client.get(f"/api/v1/billing/checkout/{out['session_id']}", headers=h)).json()
    assert res["status"] == "open"
    assert (await client.get("/api/v1/billing/subscription", headers=h)).json()["plan"]["code"] == "free"

    fake_stripe.status, fake_stripe.payment_status = "complete", "paid"
    res = (await client.get(f"/api/v1/billing/checkout/{out['session_id']}", headers=h)).json()
    assert res["status"] == "complete" and res["plan_name"] == "Pro" and res["billing_link"] == "/dashboard/usage"
    assert (await client.get("/api/v1/billing/subscription", headers=h)).json()["plan"]["code"] == "pro"
    state = (await client.get("/api/v1/billing/payments", headers=h)).json()
    assert state["paid_online"] is True and state["can_manage"] is True
    r = await client.post("/api/v1/billing/checkout", headers=h, json={"plan_code": "pro"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_on_plan"
    assert (await client.post("/api/v1/billing/portal", headers=h, json={})).json()["url"].startswith("https://")

    # Webhook: bad signature rejected; subscription deleted → back to free.
    bad = await client.post("/api/v1/billing/stripe/webhook", content=b"{}", headers={"stripe-signature": "nope"})
    assert bad.status_code == 400
    fake_stripe.event = SimpleNamespace(type="customer.subscription.deleted",
                                        data=SimpleNamespace(object=SimpleNamespace(id=f"sub_{out['session_id']}")))
    ok = await client.post("/api/v1/billing/stripe/webhook", content=b"{}", headers={"stripe-signature": "good"})
    assert ok.status_code == 200, ok.text
    assert (await client.get("/api/v1/billing/subscription", headers=h)).json()["plan"]["code"] == "free"


async def test_business_upgrade_owner_only(client: AsyncClient, fake_stripe: FakeStripe) -> None:
    owner = await register_business(client)
    h, bid = owner["headers"], owner["business_id"]
    other = bearer((await register(client))["access_token"])
    r = await client.post("/api/v1/billing/checkout", headers=other, json={"plan_code": "biz_growth", "business_id": bid})
    assert r.status_code == 403

    r = await client.post("/api/v1/billing/checkout", headers=h, json={"plan_code": "biz_growth", "business_id": bid})
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]
    fake_stripe.event = SimpleNamespace(type="checkout.session.completed", data=SimpleNamespace(object=SimpleNamespace(
        id=sid, status="complete", payment_status="paid", subscription="sub_biz_1")))
    assert (await client.post("/api/v1/billing/stripe/webhook", content=b"{}",
                              headers={"stripe-signature": "good"})).status_code == 200
    billing = (await client.get(f"/api/v1/businesses/{bid}/billing", headers=h)).json()
    assert billing["plan"]["code"] == "biz_growth"

    # Switching to another paid plan cancels the old Stripe subscription once the new one is paid.
    sid2 = (await client.post("/api/v1/billing/checkout", headers=h,
                              json={"plan_code": "biz_enterprise", "business_id": bid})).json()["session_id"]
    fake_stripe.status, fake_stripe.payment_status = "complete", "paid"
    res = (await client.get(f"/api/v1/billing/checkout/{sid2}", headers=h)).json()
    assert res["status"] == "complete" and res["billing_link"] == f"/business/{bid}/billing"
    assert fake_stripe.canceled == ["sub_biz_1"]


async def _admin(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    return bearer(r.json()["access_token"])


async def test_admin_payment_settings(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeStripe()
    monkeypatch.setattr(payments, "make_client", lambda key: fake)
    admin = await _admin(client)
    user = bearer((await register(client))["access_token"])
    assert (await client.get("/api/v1/admin/payments", headers=user)).status_code == 403
    view = (await client.get("/api/v1/admin/payments", headers=admin)).json()
    assert view["enabled"] is False and view["source"] == "none"

    bad = await client.patch("/api/v1/admin/payments", headers=admin, json={"secret_key": "pk_test_wrong"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_stripe_key"
    mixed = await client.patch("/api/v1/admin/payments", headers=admin,
                               json={"secret_key": "sk_test_abcdefgh1234", "publishable_key": "pk_live_x"})
    assert mixed.status_code == 422
    r = await client.patch("/api/v1/admin/payments", headers=admin, json={
        "secret_key": "sk_test_abcdefgh1234", "publishable_key": "pk_test_pub", "webhook_secret": "whsec_x"})
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["enabled"] is True and view["mode"] == "test" and view["source"] == "admin"
    assert view["secret_key_hint"] == "sk_test_…1234" and "sk_test_abcdefgh1234" not in r.text
    assert (await client.get("/api/v1/billing/payments", headers=user)).json()["enabled"] is True
    assert (await client.post("/api/v1/admin/payments/test", headers=admin)).json()["account"] == "nexTap Test"

    # Switched off by the admin: checkout refuses, keys are kept.
    off = (await client.patch("/api/v1/admin/payments", headers=admin, json={"enabled": False})).json()
    assert off["enabled"] is False and off["secret_key_hint"]
    assert (await client.get("/api/v1/billing/payments", headers=user)).json()["enabled"] is False
    r = await client.post("/api/v1/billing/checkout", headers=user, json={"plan_code": "pro"})
    assert r.status_code == 503


async def test_support_tickets(client: AsyncClient) -> None:
    admin = await _admin(client)
    guest = await client.post("/api/v1/support/tickets", json={
        "name": "Guest", "email": "Guest@Example.com", "phone": "+250 788 000 000", "category": "billing",
        "subject": "Payment question", "message": "How do I pay for the Pro plan?"})
    assert guest.status_code == 201, guest.text
    assert guest.json()["email"] == "guest@example.com"
    reg = await register(client)
    h = bearer(reg["access_token"])
    mine = await client.post("/api/v1/support/tickets", headers=h, json={
        "name": "Dev", "email": reg["user"]["email"], "subject": "Webhook help", "message": "My webhook fails with 500."})
    assert mine.status_code == 201
    assert [t["subject"] for t in (await client.get("/api/v1/support/tickets", headers=h)).json()] == ["Webhook help"]
    assert (await client.post("/api/v1/support/tickets", json={"name": "x", "email": "x@y.z", "subject": "hi",
                                                             "message": "short"})).status_code == 422

    inbox = (await client.get("/api/v1/admin/support", headers=admin, params={"status": "open"})).json()
    assert inbox["counts"]["open"] >= 2
    row = next(t for t in inbox["items"] if t["id"] == mine.json()["id"])
    assert row["user"]["email"] == reg["user"]["email"]
    phone = (await client.get("/api/v1/admin/support", headers=admin, params={"q": "788 000"})).json()
    assert phone["items"][0]["phone"] == "+250 788 000 000"
    upd = await client.patch(f"/api/v1/admin/support/{row['id']}", headers=admin,
                             json={"status": "resolved", "admin_note": "Replied by email"})
    assert upd.status_code == 200 and upd.json()["resolved_at"] and upd.json()["admin_note"] == "Replied by email"
    assert (await client.get("/api/v1/support/tickets", headers=h)).json()[0]["status"] == "resolved"
    assert (await client.get("/api/v1/admin/support", headers=h)).status_code == 403
