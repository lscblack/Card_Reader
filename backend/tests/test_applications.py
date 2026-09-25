from __future__ import annotations

import hashlib

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import decrypt_secret
from app.db.session import SessionLocal
from app.models import ApiKey, Application, AuditLog
from tests.conftest import bearer, create_app, register_device


async def test_create_application_returns_plaintexts_once(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"], name="Gym", description="Door reader")
    app, key = created["application"], created["api_key"]
    api_key, secret = created["api_key_plaintext"], created["webhook_secret_plaintext"]

    assert api_key.startswith("nfc_") and len(api_key) == 4 + 48
    assert secret.startswith("whsec_") and len(secret) == 6 + 43
    assert key["prefix"] == api_key[:12] and key["last4"] == api_key[-4:] and key["is_active"] is True
    assert key["application_name"] == "Gym"
    assert app["delivery_mode"] == "relay" and app["device_count"] == 0
    assert app["webhook_secret"] == {"configured": True, "last4": secret[-4:], "rotated_at": app["webhook_secret"]["rotated_at"]}
    assert app["endpoint"] == {
        "url": None, "enabled": False, "timeout_seconds": 10, "custom_headers": {},
        "last_tested_at": None, "last_test_success": None,
    }

    # Plaintexts never come back
    r = await client.get(f"/api/v1/applications/{app['id']}", headers=user["headers"])
    assert api_key not in r.text and secret not in r.text
    r = await client.get("/api/v1/api-keys", headers=user["headers"])
    assert api_key not in r.text and len(r.json()) == 1

    # Stored as SHA-256 hash / Fernet ciphertext only
    async with SessionLocal() as s:
        row = (await s.execute(select(ApiKey))).scalar_one()
        assert row.key_hash == hashlib.sha256(api_key.encode()).hexdigest()
        application = (await s.execute(select(Application))).scalar_one()
        assert secret not in (application.webhook_secret_encrypted or "")
        assert decrypt_secret(application.webhook_secret_encrypted) == secret
        audit_rows = (await s.execute(select(AuditLog))).scalars().all()
        assert all(api_key not in str(a.meta) and secret not in str(a.meta) for a in audit_rows)


async def test_custom_webhook_secret_and_rotation(client: AsyncClient, user: dict) -> None:
    custom = "my-own-webhook-secret-123456"
    created = await create_app(client, user["headers"], webhook_secret=custom)
    assert created["webhook_secret_plaintext"] == custom
    app_id = created["application"]["id"]

    r = await client.post(f"/api/v1/applications/{app_id}/webhook-secret/rotate", headers=user["headers"])
    assert r.status_code == 200
    body = r.json()
    assert body["webhook_secret_plaintext"].startswith("whsec_") and body["last4"] == body["webhook_secret_plaintext"][-4:]

    r = await client.post(f"/api/v1/applications/{app_id}/webhook-secret/rotate",
                          json={"webhook_secret": "short"}, headers=user["headers"])
    assert r.status_code == 422


async def test_api_key_create_use_and_revoke(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    r = await client.post("/api/v1/api-keys", json={"application_id": app_id, "name": "CI"}, headers=user["headers"])
    assert r.status_code == 201
    new_key = r.json()["plaintext"]
    key_id = r.json()["api_key"]["id"]
    assert r.json()["api_key"]["last_used_at"] is None

    await register_device(client, new_key)
    r = await client.get(f"/api/v1/api-keys?application_id={app_id}", headers=user["headers"])
    used = next(k for k in r.json() if k["id"] == key_id)
    assert used["last_used_at"] is not None

    r = await client.post(f"/api/v1/api-keys/{key_id}/revoke", headers=user["headers"])
    assert r.status_code == 200 and r.json()["is_active"] is False and r.json()["revoked_at"]

    # Revocation is immediate
    r = await client.post("/api/v1/device/register", headers=bearer(new_key),
                          json={"device_name": "x", "installation_id": "install-0001"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "api_key_revoked"

    # Unknown / malformed keys
    r = await client.post("/api/v1/device/register", headers=bearer("nfc_" + "A" * 48),
                          json={"device_name": "x", "installation_id": "install-0001"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_api_key"


async def test_other_users_cannot_see_resources(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    from tests.conftest import register

    other = await register(client)
    h = bearer(other["access_token"])
    r = await client.get(f"/api/v1/applications/{created['application']['id']}", headers=h)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = await client.post("/api/v1/api-keys", json={"application_id": created["application"]["id"], "name": "x"}, headers=h)
    assert r.status_code == 404
    r = await client.post(f"/api/v1/api-keys/{created['api_key']['id']}/revoke", headers=h)
    assert r.status_code == 404


async def test_update_and_delete_application(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    device = await register_device(client, created["api_key_plaintext"])

    r = await client.patch(f"/api/v1/applications/{app_id}", json={"name": "Renamed", "is_active": False},
                           headers=user["headers"])
    assert r.status_code == 200 and r.json()["name"] == "Renamed" and r.json()["is_active"] is False
    r = await client.get("/api/v1/device/config", headers=bearer(device["device_token"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "application_disabled"

    r = await client.delete(f"/api/v1/applications/{app_id}", headers=user["headers"])
    assert r.status_code == 204
    r = await client.get("/api/v1/applications", headers=user["headers"])
    assert r.json() == []
    # keys and devices are revoked
    r = await client.get("/api/v1/device/config", headers=bearer(device["device_token"]))
    assert r.status_code == 401 and r.json()["error"]["code"] == "device_revoked"
    r = await client.post("/api/v1/device/register", headers=bearer(created["api_key_plaintext"]),
                          json={"device_name": "x", "installation_id": "install-0001"})
    assert r.status_code == 401

    async with SessionLocal() as s:
        actions = [a for a in (await s.execute(select(AuditLog.action))).scalars()]
    for action in ("application.create", "application.update", "application.delete", "api_key.create", "device.register"):
        assert action in actions


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/hook",
        "https://user:pass@example.com/hook",
        "https://example.com/hook#frag",
        "http://example.com/hook",  # http only allowed for localhost/LAN in development
        "https://" + "a" * 2050 + ".com",
        "not a url",
        "https:///nohost",
    ],
)
async def test_endpoint_validation_rejects_bad_urls(client: AsyncClient, user: dict, url: str) -> None:
    created = await create_app(client, user["headers"])
    r = await client.put(f"/api/v1/applications/{created['application']['id']}/endpoint",
                         json={"url": url, "enabled": True}, headers=user["headers"])
    assert r.status_code == 422, r.text
    err = r.json()["error"]
    assert err["code"] == "validation_error" and err["details"][0]["field"] == "body.url"


@pytest.mark.parametrize(
    "url", ["http://localhost:9000/hook", "http://127.0.0.1/hook", "http://10.0.2.2:8080/x",
            "http://192.168.1.20/hook", "https://example.com/api/nfc/card"],
)
async def test_endpoint_validation_accepts_dev_urls(client: AsyncClient, user: dict, url: str) -> None:
    created = await create_app(client, user["headers"])
    r = await client.put(
        f"/api/v1/applications/{created['application']['id']}/endpoint",
        json={"url": url, "enabled": True, "timeout_seconds": 5, "custom_headers": {"X-Api-Token": "abc"},
              "delivery_mode": "direct"},
        headers=user["headers"],
    )
    assert r.status_code == 200, r.text
    ep = r.json()["endpoint"]
    assert ep["url"] == url and ep["enabled"] is True and ep["timeout_seconds"] == 5
    assert ep["custom_headers"] == {"X-Api-Token": "abc"} and r.json()["delivery_mode"] == "direct"


async def test_custom_headers_cannot_override_signature_headers(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    r = await client.put(f"/api/v1/applications/{created['application']['id']}/endpoint",
                         json={"url": "https://example.com/x", "enabled": True,
                               "custom_headers": {"X-NFC-Signature": "v1=forged"}},
                         headers=user["headers"])
    assert r.status_code == 422
