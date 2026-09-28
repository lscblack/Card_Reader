"""Registering a tapped physical card outside businesses: to a personal digital card, or to a developer app."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient

from tests.conftest import bearer, create_app, register_device
from tests.p2_helpers import create_card, pair_business_device, register_business
from tests.test_part4 import phone_login, primary, register_personal


def _tap(uid: str) -> dict[str, Any]:
    return {"event_id": str(uuid.uuid4()), "card_id": uid, "card_technologies": ["NfcA"], "card_type": "MIFARE_ULTRALIGHT",
            "detected_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "direct_delivery": None}


async def _dev_device(client: AsyncClient, user: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    created = await create_app(client, user["headers"])
    dev = await register_device(client, created["api_key_plaintext"])
    return created["application"], bearer(dev["device_token"])


async def test_personal_account_registers_a_physical_card(client: AsyncClient) -> None:
    person = await register_personal(client)
    h = person["headers"]
    card = await primary(client, h)

    phone = await phone_login(client, person)  # the app registers with its phone session
    r = await client.post("/api/v1/personal/chips", json={"uid": "04:a1:b2:c3:d4:e5:f6"}, headers=phone["headers"])
    assert r.status_code == 201, r.text
    chip = r.json()
    assert chip["uid"] == "04A1B2C3D4E5F6" and chip["digital_card_id"] == card["id"]
    assert chip["digital_card_label"] == card["label"] and chip["label"] == "Card E5F6"
    assert [c["id"] for c in (await client.get("/api/v1/personal/chips", headers=h)).json()] == [chip["id"]]

    # any phone tapping the chip is sent to the digital card
    r = await client.get("/api/v1/public/cards/resolve", params={"uid": "04 A1 B2 C3 D4 E5 F6"})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "digital_card" and r.json()["tap_url"].endswith(f"/p/{card['slug']}")
    assert (await client.get("/api/v1/personal/chips", headers=h)).json()[0]["taps"] == 1

    # already mine → named; someone else's → taken without saying whose
    r = await client.post("/api/v1/personal/chips", json={"uid": "04A1B2C3D4E5F6"}, headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_exists"
    assert r.json()["error"]["details"]["digital_card_id"] == card["id"]
    other = await register_personal(client, name="Other Person", phone="+250788000321")
    r = await client.post("/api/v1/personal/chips", json={"uid": "04A1B2C3D4E5F6"}, headers=other["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_taken"

    # a business can't take it either
    owner = await register_business(client)
    r = await client.post(f"/api/v1/businesses/{owner['business_id']}/cards", json={"name": "X", "uid": "04A1B2C3D4E5F6"},
                          headers=owner["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_taken"

    # unregister frees it
    r = await client.delete(f"/api/v1/personal/chips/{chip['id']}", headers=h)
    assert r.status_code == 204
    r = await client.get("/api/v1/public/cards/resolve", params={"uid": "04A1B2C3D4E5F6"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "card_not_registered"


async def test_personal_chip_can_open_a_chosen_card_and_follows_card_deletion(client: AsyncClient) -> None:
    person = await register_personal(client)
    h = person["headers"]
    r = await client.post("/api/v1/personal/cards", json={"label": "Work", "template_id": "split"}, headers=h)
    assert r.status_code == 201, r.text
    work = r.json()
    r = await client.post("/api/v1/personal/chips", json={"uid": "04112233445566", "card_id": work["id"],
                                                          "label": "Blue card"}, headers=h)
    assert r.status_code == 201 and r.json()["digital_card_id"] == work["id"] and r.json()["label"] == "Blue card"
    r = await client.post("/api/v1/personal/chips", json={"uid": "04998877665544", "card_id": str(uuid.uuid4())},
                          headers=h)
    assert r.status_code == 404

    assert (await client.delete(f"/api/v1/personal/cards/{work['id']}", headers=h)).status_code == 204
    assert (await client.get("/api/v1/personal/chips", headers=h)).json() == []
    assert (await client.get("/api/v1/public/cards/resolve", params={"uid": "04112233445566"})).status_code == 404


async def test_developer_device_registers_a_tapped_card(client: AsyncClient, user: dict[str, Any]) -> None:
    app, dh = await _dev_device(client, user)

    r = await client.post("/api/v1/device/events", json=_tap("04:aa:bb:cc:dd:ee"), headers=dh)
    assert r.status_code == 200, r.text
    assert r.json()["app_card"] == {"registered": False, "can_register": True}

    r = await client.post("/api/v1/device/app/cards", json={"uid": "04:aa:bb:cc:dd:ee", "label": "Alice badge"},
                          headers=dh)
    assert r.status_code == 201, r.text
    chip = r.json()
    assert chip["uid"] == "04AABBCCDDEE" and chip["application_id"] == app["id"] and chip["label"] == "Alice badge"

    r = await client.post("/api/v1/device/events", json=_tap("04AABBCCDDEE"), headers=dh)
    assert r.json()["app_card"] == {"registered": True, "id": chip["id"], "label": "Alice badge"}
    r = await client.post("/api/v1/device/app/cards", json={"uid": "04AABBCCDDEE"}, headers=dh)
    assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_exists"

    # dashboard: list, rename, unregister
    base = f"/api/v1/applications/{app['id']}/cards"
    listed = (await client.get(base, headers=user["headers"])).json()
    assert [c["id"] for c in listed] == [chip["id"]] and listed[0]["taps"] == 1
    r = await client.patch(f"{base}/{chip['id']}", json={"label": "Alice (front desk)"}, headers=user["headers"])
    assert r.status_code == 200 and r.json()["label"] == "Alice (front desk)"
    r = await client.post(base, json={"uid": "04 01 02 03", "label": "Spare"}, headers=user["headers"])
    assert r.status_code == 201 and r.json()["uid"] == "04010203"
    assert (await client.delete(f"{base}/{chip['id']}", headers=user["headers"])).status_code == 204
    assert [c["label"] for c in (await client.get(base, headers=user["headers"])).json()] == ["Spare"]

    # another developer can't see or touch this app's cards
    stranger = await client.post("/api/v1/auth/register", json={"country": "RW", "email": f"s-{uuid.uuid4().hex[:6]}@example.com",
                                                                "password": "Sup3rSecretPass", "full_name": "S"})
    sh = bearer(stranger.json()["access_token"])
    assert (await client.get(base, headers=sh)).status_code == 404


async def test_developer_cannot_register_a_card_someone_else_owns(client: AsyncClient, user: dict[str, Any]) -> None:
    person = await register_personal(client)
    await client.post("/api/v1/personal/chips", json={"uid": "04CAFE0001"}, headers=person["headers"])
    owner = await register_business(client)
    await create_card(client, owner, name="Door", uid="04CAFE0002")
    app, dh = await _dev_device(client, user)

    for uid in ("04CAFE0001", "04CAFE0002"):
        r = await client.post("/api/v1/device/events", json=_tap(uid), headers=dh)
        assert r.json()["app_card"] == {"registered": False, "can_register": False}
        r = await client.post("/api/v1/device/app/cards", json={"uid": uid}, headers=dh)
        assert r.status_code == 409 and r.json()["error"]["code"] == "card_uid_taken"


async def test_business_devices_keep_their_own_registration(client: AsyncClient) -> None:
    owner = await register_business(client)
    dev = await pair_business_device(client, owner)
    r = await client.post("/api/v1/device/app/cards", json={"uid": "04BEEF0001"}, headers=dev["headers"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "device_is_business"
    r = await client.post("/api/v1/device/events", json=_tap("04BEEF0001"), headers=dev["headers"])
    assert r.status_code == 200 and "app_card" not in r.json() and r.json()["business"]["result"] == "unknown_card"
