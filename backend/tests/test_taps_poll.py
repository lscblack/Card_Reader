"""Pull-based tap polling: GET /taps (API-key auth, scoped to one application).

Lets a developer without a public webhook endpoint fetch recent taps with their
application API key, and tail new taps forward with an opaque keyset cursor.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient

from tests.conftest import bearer, create_app, register_device


async def _submit_tap(client: AsyncClient, device_token: str, card_id: str) -> str:
    event_id = str(uuid.uuid4())
    r = await client.post(
        "/api/v1/device/events",
        json={"event_id": event_id, "card_id": card_id, "detected_at": datetime.now(UTC).isoformat()},
        headers=bearer(device_token),
    )
    assert r.status_code == 200, r.text
    return event_id


async def test_poll_returns_the_applications_taps(client: AsyncClient, user: dict[str, Any]) -> None:
    app = await create_app(client, user["headers"])
    dev = await register_device(client, app["api_key_plaintext"])
    await _submit_tap(client, dev["device_token"], "04A1B2C3")
    await _submit_tap(client, dev["device_token"], "04D4E5F6")

    r = await client.get("/api/v1/taps", headers=bearer(app["api_key_plaintext"]))

    assert r.status_code == 200, r.text
    body = r.json()
    assert {item["card_id"] for item in body["items"]} == {"04A1B2C3", "04D4E5F6"}
    assert body["next_cursor"] is not None


async def test_poll_is_scoped_to_the_key_s_application(client: AsyncClient, user: dict[str, Any]) -> None:
    app_a = await create_app(client, user["headers"], name="App A")
    app_b = await create_app(client, user["headers"], name="App B")
    dev_a = await register_device(client, app_a["api_key_plaintext"])
    await _submit_tap(client, dev_a["device_token"], "04A1B2C3")

    r = await client.get("/api/v1/taps", headers=bearer(app_b["api_key_plaintext"]))

    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


async def test_cursor_tails_new_taps_forward_without_duplicates(client: AsyncClient, user: dict[str, Any]) -> None:
    app = await create_app(client, user["headers"])
    dev = await register_device(client, app["api_key_plaintext"])

    # Tail from now: no taps yet.
    first = await client.get("/api/v1/taps", headers=bearer(app["api_key_plaintext"]))
    assert first.status_code == 200
    cursor = first.json()["next_cursor"]

    await _submit_tap(client, dev["device_token"], "04A1B2C3")
    await _submit_tap(client, dev["device_token"], "04D4E5F6")

    page = await client.get(f"/api/v1/taps?cursor={cursor}", headers=bearer(app["api_key_plaintext"]))
    assert page.status_code == 200, page.text
    cards = [item["card_id"] for item in page.json()["items"]]
    assert cards == ["04A1B2C3", "04D4E5F6"]  # ascending, oldest first

    # Polling again with the advanced cursor yields nothing new.
    again = await client.get(
        f"/api/v1/taps?cursor={page.json()['next_cursor']}", headers=bearer(app["api_key_plaintext"])
    )
    assert again.status_code == 200
    assert again.json()["items"] == []


async def test_limit_caps_the_page_and_flags_more(client: AsyncClient, user: dict[str, Any]) -> None:
    app = await create_app(client, user["headers"])
    dev = await register_device(client, app["api_key_plaintext"])
    start = await client.get("/api/v1/taps", headers=bearer(app["api_key_plaintext"]))
    cursor = start.json()["next_cursor"]
    for i in range(3):
        await _submit_tap(client, dev["device_token"], f"04{i:06X}")

    page = await client.get(f"/api/v1/taps?cursor={cursor}&limit=2", headers=bearer(app["api_key_plaintext"]))

    assert page.status_code == 200, page.text
    body = page.json()
    assert len(body["items"]) == 2
    assert body["has_more"] is True


async def test_poll_requires_a_valid_api_key(client: AsyncClient, user: dict[str, Any]) -> None:
    await create_app(client, user["headers"])

    missing = await client.get("/api/v1/taps")
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "invalid_api_key"

    bad = await client.get("/api/v1/taps", headers=bearer("nfc_not_a_real_key"))
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "invalid_api_key"


async def test_get_single_tap_by_id(client: AsyncClient, user: dict[str, Any]) -> None:
    app = await create_app(client, user["headers"])
    dev = await register_device(client, app["api_key_plaintext"])
    await _submit_tap(client, dev["device_token"], "04A1B2C3")
    listed = await client.get("/api/v1/taps", headers=bearer(app["api_key_plaintext"]))
    tap_id = listed.json()["items"][0]["id"]

    r = await client.get(f"/api/v1/taps/{tap_id}", headers=bearer(app["api_key_plaintext"]))

    assert r.status_code == 200, r.text
    assert r.json()["id"] == tap_id
    assert r.json()["card_id"] == "04A1B2C3"


async def test_single_tap_is_scoped_to_the_application(client: AsyncClient, user: dict[str, Any]) -> None:
    app_a = await create_app(client, user["headers"], name="App A")
    app_b = await create_app(client, user["headers"], name="App B")
    dev_a = await register_device(client, app_a["api_key_plaintext"])
    await _submit_tap(client, dev_a["device_token"], "04A1B2C3")
    tap_id = (await client.get("/api/v1/taps", headers=bearer(app_a["api_key_plaintext"]))).json()["items"][0]["id"]

    r = await client.get(f"/api/v1/taps/{tap_id}", headers=bearer(app_b["api_key_plaintext"]))

    assert r.status_code == 404
