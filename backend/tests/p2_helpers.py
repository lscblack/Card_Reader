"""Shared helpers for Part 2 tests."""

from __future__ import annotations

import uuid
from typing import Any
from urllib.parse import parse_qs, urlsplit

from httpx import AsyncClient

from tests.conftest import bearer

BROWSER_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
ANDROID_UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Mobile Safari/537.36")
BOT_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"


def business_payload(name: str = "Acme Café", **overrides: Any) -> dict[str, Any]:
    data = {"name": name, "email": "hello@acme.example.com", "phone": "+250788000111", "country": "rw",
            "category": "cafe", "description": "Coffee and pastries", "website": "https://acme.example.com",
            "address": "KN 4 Ave"}
    data.update(overrides)
    return data


def token_from_url(url: str) -> str:
    parts = urlsplit(url)
    q = parse_qs(parts.query)
    if "token" in q:
        return q["token"][0]
    return parts.path.rsplit("/", 1)[-1]


async def register_business(client: AsyncClient, *, verify: bool = True, name: str = "Acme Café",
                            email: str | None = None) -> dict[str, Any]:
    email = email or f"owner-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "Sup3rSecretPass", "full_name": "Owner One",
        "account_type": "business", "business": business_payload(name)})
    assert r.status_code == 201, r.text
    data = r.json()
    data["headers"] = bearer(data["access_token"])
    data["business_id"] = data["user"]["memberships"][0]["business_id"]
    data["slug"] = data["user"]["memberships"][0]["business_slug"]
    if verify:
        assert data["dev_verification_url"], "dev_verification_url expected in development"
        r = await client.post("/api/v1/auth/verify-email", json={"token": token_from_url(data["dev_verification_url"])})
        assert r.status_code == 204, r.text
    return data


async def add_member(client: AsyncClient, owner: dict[str, Any], role: str) -> dict[str, Any]:
    """Invite + register-with-invite; returns the new member's auth data."""
    email = f"{role}-{uuid.uuid4().hex[:6]}@example.com"
    r = await client.post(f"/api/v1/businesses/{owner['business_id']}/invitations",
                          json={"email": email, "role": role}, headers=owner["headers"])
    assert r.status_code == 201, r.text
    token = token_from_url(r.json()["dev_invite_url"])
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": "Sup3rSecretPass",
                                                         "full_name": role.title(), "invite_token": token})
    assert r.status_code == 201, r.text
    data = r.json()
    data["headers"] = bearer(data["access_token"])
    assert data["user"]["memberships"][0]["role"] == role
    return data


async def terminal_app_id(client: AsyncClient, owner: dict[str, Any]) -> str:
    r = await client.get(f"/api/v1/businesses/{owner['business_id']}/applications", headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


async def pair_business_device(client: AsyncClient, owner: dict[str, Any], name: str = "Counter") -> dict[str, Any]:
    app_id = await terminal_app_id(client, owner)
    r = await client.post(f"/api/v1/applications/{app_id}/pairing-codes", json={"device_name": name},
                          headers=owner["headers"])
    assert r.status_code == 201, r.text
    r = await client.post("/api/v1/device/register", headers=bearer(r.json()["code"]), json={
        "device_name": "x", "platform": "android", "model": "Pixel 8", "os_version": "Android 15",
        "app_version": "1.0.0", "installation_id": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    data = r.json()
    data["headers"] = bearer(data["device_token"])
    data["app_id"] = app_id
    return data


async def create_card(client: AsyncClient, owner: dict[str, Any], **body: Any) -> dict[str, Any]:
    body.setdefault("name", "Card")
    r = await client.post(f"/api/v1/businesses/{owner['business_id']}/cards", json=body, headers=owner["headers"])
    assert r.status_code == 201, r.text
    return r.json()


async def create_employee(client: AsyncClient, owner: dict[str, Any], first: str = "John", last: str = "Doe",
                          **extra: Any) -> dict[str, Any]:
    r = await client.post(f"/api/v1/businesses/{owner['business_id']}/employees",
                          json={"first_name": first, "last_name": last, "position": "Sales Manager", **extra},
                          headers=owner["headers"])
    assert r.status_code == 201, r.text
    return r.json()
