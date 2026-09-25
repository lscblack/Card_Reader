from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import AuditLog, PasswordResetToken
from app.services import email as email_service
from tests.conftest import bearer, register


async def test_register_login_me(client: AsyncClient) -> None:
    data = await register(client, email="Alice@Example.com")
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 10080 * 60
    user = data["user"]
    assert user["email"] == "alice@example.com"
    assert user["role"] == "developer" and user["plan"] == "free" and user["is_active"] is True
    assert user["created_at"].endswith("Z")

    r = await client.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "Sup3rSecretPass"})
    assert r.status_code == 200
    token = r.json()["access_token"]

    r = await client.get("/api/v1/auth/me", headers=bearer(token))
    assert r.status_code == 200 and r.json()["id"] == user["id"]

    r = await client.patch("/api/v1/auth/me", json={"full_name": "Alice A."}, headers=bearer(token))
    assert r.json()["full_name"] == "Alice A."

    async with SessionLocal() as s:
        actions = set((await s.execute(select(AuditLog.action))).scalars())
    assert {"user.register", "user.login"} <= actions


async def test_register_duplicate_and_bad_login(client: AsyncClient) -> None:
    await register(client, email="bob@example.com")
    r = await client.post("/api/v1/auth/register",
                          json={"email": "bob@example.com", "password": "Sup3rSecretPass", "full_name": "B"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"

    r = await client.post("/api/v1/auth/login", json={"email": "bob@example.com", "password": "wrong-password"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"
    r = await client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong-password"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"


async def test_short_password_is_validation_error(client: AsyncClient) -> None:
    r = await client.post("/api/v1/auth/register", json={"email": "c@example.com", "password": "short", "full_name": "C"})
    assert r.status_code == 422
    body = r.json()["error"]
    assert body["code"] == "validation_error"
    assert any(d["field"] == "body.password" for d in body["details"])


async def test_missing_and_bad_tokens(client: AsyncClient) -> None:
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    r = await client.get("/api/v1/auth/me", headers=bearer("not-a-jwt"))
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_token"


async def test_change_password_invalidates_old_tokens(client: AsyncClient, user: dict) -> None:
    import asyncio

    await asyncio.sleep(1.1)  # iat has 1s resolution
    r = await client.post("/api/v1/auth/change-password",
                          json={"current_password": "Sup3rSecretPass", "new_password": "An0ther-Secret!"},
                          headers=user["headers"])
    assert r.status_code == 204
    r = await client.get("/api/v1/auth/me", headers=user["headers"])
    assert r.status_code == 401 and r.json()["error"]["code"] == "token_revoked"
    r = await client.post("/api/v1/auth/login", json={"email": user["user"]["email"], "password": "An0ther-Secret!"})
    assert r.status_code == 200

    r = await client.post("/api/v1/auth/change-password",
                          json={"current_password": "wrong", "new_password": "An0ther-Secret!2"},
                          headers=bearer(r.json()["access_token"]))
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_password"


async def test_forgot_and_reset_password(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[str] = []

    async def fake_send(to: str, name: str, token: str) -> None:
        sent.append(token)

    monkeypatch.setattr(email_service, "send_password_reset", fake_send)
    await register(client, email="reset@example.com")

    # Unknown email: still 202, nothing sent (no enumeration)
    r = await client.post("/api/v1/auth/forgot-password", json={"email": "ghost@example.com"})
    assert r.status_code == 202 and not sent

    r = await client.post("/api/v1/auth/forgot-password", json={"email": "reset@example.com"})
    assert r.status_code == 202 and len(sent) == 1
    token = sent[0]

    async with SessionLocal() as s:
        row = (await s.execute(select(PasswordResetToken))).scalar_one()
        assert row.token_hash != token and len(row.token_hash) == 64  # hashed

    r = await client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "Brand-New-Pass1"})
    assert r.status_code == 204
    # single use
    r = await client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "Brand-New-Pass2"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_reset_token"

    r = await client.post("/api/v1/auth/login", json={"email": "reset@example.com", "password": "Brand-New-Pass1"})
    assert r.status_code == 200


async def test_admin_seeded_and_admin_endpoints(client: AsyncClient, user: dict) -> None:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    assert r.status_code == 200
    admin = r.json()
    assert admin["user"]["role"] == "admin"
    h = bearer(admin["access_token"])

    r = await client.get("/api/v1/admin/users?page=1", headers=h)
    assert r.status_code == 200
    page = r.json()
    assert page["total"] == 2 and page["page"] == 1 and page["page_size"] == 20

    r = await client.get("/api/v1/admin/stats", headers=h)
    assert r.json() == {"users": 2, "applications": 0, "devices": 0, "events_total": 0}

    # Non-admin is forbidden
    r = await client.get("/api/v1/admin/stats", headers=user["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"

    # Deactivate the developer: their token stops working
    r = await client.patch(f"/api/v1/admin/users/{user['user']['id']}", json={"is_active": False}, headers=h)
    assert r.status_code == 200 and r.json()["is_active"] is False
    r = await client.get("/api/v1/auth/me", headers=user["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_disabled"


async def test_billing_plans_and_subscription(client: AsyncClient, user: dict) -> None:
    r = await client.get("/api/v1/billing/plans")
    plans = {p["code"]: p for p in r.json()}
    assert plans["free"]["events_per_month"] == 10_000 and plans["free"]["max_applications"] == 3
    assert plans["free"]["max_devices"] == 5 and plans["free"]["price_monthly_cents"] == 0
    assert plans["pro"]["price_monthly_cents"] == 2900 and plans["pro"]["events_per_month"] == 250_000
    assert plans["pro"]["max_applications"] == 20 and plans["pro"]["max_devices"] == 100
    assert plans["business"]["price_monthly_cents"] == 19900 and plans["business"]["events_per_month"] == 5_000_000
    assert plans["business"]["max_applications"] is None and plans["business"]["max_devices"] is None

    r = await client.get("/api/v1/billing/subscription", headers=user["headers"])
    sub = r.json()
    assert sub["plan"]["code"] == "free" and sub["status"] == "active"
    assert sub["current_period_start"] < sub["current_period_end"]
