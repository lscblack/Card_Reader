"""iOS app: universal links for tap links, and tap code → UID for iPhone terminals."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import CardTap
from tests.conftest import bearer, create_app, register, register_device
from tests.p2_helpers import BROWSER_UA, create_card, pair_business_device, register_business

AASA = "/.well-known/apple-app-site-association"


async def test_aasa_needs_the_team_id(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "APPLE_TEAM_ID", "")
    r = await client.get(AASA)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"

    monkeypatch.setattr(settings, "APPLE_TEAM_ID", "ABC-123")  # not a Team ID: no file rather than a useless one
    assert (await client.get(AASA)).status_code == 404

    monkeypatch.setattr(settings, "APPLE_TEAM_ID", "abcde12345")  # case-insensitive, published uppercase
    monkeypatch.setattr(settings, "IOS_BUNDLE_ID", "net.nexventures.nfc-terminal")
    r = await client.get(AASA)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/json")
    details = r.json()["applinks"]["details"]
    assert details[0]["appIDs"] == ["ABCDE12345.net.nexventures.nfc-terminal"]
    # Links the app itself sends to the browser (?via=app) are excluded first, then every tap link opens the app.
    first, second = details[0]["components"]
    assert first["/"] == "/t/*" and first["?"] == {"via": "app"} and first["exclude"] is True
    assert second["/"] == "/t/*" and "exclude" not in second
    assert r.headers["cache-control"] == "public, max-age=3600"


async def test_tap_link_opened_from_the_app_still_runs_the_action(client: AsyncClient) -> None:
    owner = await register_business(client)
    card = await create_card(client, owner, name="Info", action={"type": "website", "config": {"url": "https://example.com/menu"}})
    r = await client.get(f"/t/{card['public_code']}", params={"via": "app"}, headers={"User-Agent": BROWSER_UA})
    assert r.status_code == 302 and r.headers["location"] == "https://example.com/menu"
    async with SessionLocal() as s:
        taps = (await s.execute(select(CardTap).where(CardTap.card_id == card["id"]))).scalars().all()
    assert len(taps) == 1 and taps[0].source == "web"


async def test_terminal_resolves_its_own_tap_codes_only(client: AsyncClient) -> None:
    owner = await register_business(client)
    dev = await pair_business_device(client, owner)
    mine = (await client.post("/api/v1/device/business/cards", headers=dev["headers"],
                              json={"uid": "04A1B2C3D4E5F6", "name": "Front desk"})).json()
    code = mine["tap_url"].rsplit("/", 1)[-1]

    r = await client.get(f"/api/v1/device/business/cards/by-code/{code}", headers=dev["headers"])
    assert r.status_code == 200, r.text
    assert r.json() == {"uid": "04A1B2C3D4E5F6", "card_id": mine["id"], "name": "Front desk"}

    # Unknown code, and a card created in the dashboard that has no chip yet.
    r = await client.get("/api/v1/device/business/cards/by-code/nosuchcode1", headers=dev["headers"])
    assert r.status_code == 404
    unbound = await create_card(client, owner, name="Not programmed")
    r = await client.get(f"/api/v1/device/business/cards/by-code/{unbound['public_code']}", headers=dev["headers"])
    assert r.status_code == 404

    # Another business's terminal never learns this card's UID.
    other = await register_business(client, name="Other Co")
    dev2 = await pair_business_device(client, other)
    r = await client.get(f"/api/v1/device/business/cards/by-code/{code}", headers=dev2["headers"])
    assert r.status_code == 404

    # Nor does a developer device, or anyone without a device token.
    user = await register(client)
    app = await create_app(client, bearer(user["access_token"]))
    dd = await register_device(client, app["api_key_plaintext"])
    r = await client.get(f"/api/v1/device/business/cards/by-code/{code}", headers=bearer(dd["device_token"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "device_not_business"
    r = await client.get(f"/api/v1/device/business/cards/by-code/{code}")
    assert r.status_code == 401
