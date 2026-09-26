"""Cards assigned to the business itself (assignee type "business")."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.db.session import SessionLocal
from app.models import Card
from tests.p2_helpers import BROWSER_UA, create_card, create_employee, pair_business_device, register_business


async def test_assign_card_to_the_company(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid, h = owner["business_id"], owner["headers"]
    base = f"/api/v1/businesses/{bid}"

    card = await create_card(client, owner, name="Front door")
    assert card["effective_status"] == "unassigned" and card["assignee"] is None
    r = await client.post(f"{base}/cards/{card['id']}/assign", json={"assignee_type": "business"}, headers=h)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["assignee"]["type"] == "business" and c["assignee"]["id"] == bid and c["assignee"]["name"] == "Acme Café"
    assert c["effective_status"] == "active"

    r = await client.post(f"{base}/cards/{card['id']}/assign", json={"assignee_type": "business", "assignee_id": bid},
                          headers=h)
    assert r.status_code == 200 and r.json()["assignee"]["type"] == "business"
    r = await client.post(f"{base}/cards/{card['id']}/assign",
                          json={"assignee_type": "business", "assignee_id": str(uuid.uuid4())}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "body.assignee_id"
    r = await client.post(f"{base}/cards/{card['id']}/assign", json={"assignee_type": "employee"}, headers=h)
    assert r.status_code == 422

    # switching to a person clears the company flag, and vice versa
    emp = await create_employee(client, owner)
    r = await client.post(f"{base}/cards/{card['id']}/assign", json={"assignee_type": "employee", "assignee_id": emp["id"]},
                          headers=h)
    assert r.json()["assignee"]["type"] == "employee"
    r = await client.post(f"{base}/cards/{card['id']}/assign", json={"assignee_type": "business"}, headers=h)
    assert r.json()["assignee"]["type"] == "business"
    r = await client.post(f"{base}/cards/{card['id']}/unassign", headers=h)
    assert r.json()["assignee"] is None and r.json()["effective_status"] == "unassigned"

    # create directly as a company tag; wrong id rejected
    tag = await create_card(client, owner, name="Lobby tag", kind="tag", assignee_type="business")
    assert tag["assignee"]["type"] == "business" and tag["effective_status"] == "active"
    r = await client.post(f"{base}/cards", json={"name": "X", "assignee_type": "business",
                                                 "assignee_id": emp["id"]}, headers=h)
    assert r.status_code == 422

    # list filter
    listed = (await client.get(f"{base}/cards?assignee_type=business", headers=h)).json()
    assert [x["id"] for x in listed["items"]] == [tag["id"]]
    none = (await client.get(f"{base}/cards?assignee_type=none", headers=h)).json()
    assert card["id"] in [x["id"] for x in none["items"]] and tag["id"] not in [x["id"] for x in none["items"]]

    hist = (await client.get(f"{base}/cards/{card['id']}/history", headers=h)).json()
    types = [(x["type"], x["data"].get("assignee_type") or x["data"].get("previous_assignee_type")) for x in hist]
    assert ("assigned", "business") in types and ("unassigned", "business") in types

    # taps + analytics
    await client.get(f"/t/{tag['public_code']}", headers={"User-Agent": BROWSER_UA})
    await client.get(f"/t/{card['public_code']}", headers={"User-Agent": BROWSER_UA})
    taps = (await client.get(f"{base}/taps", headers=h)).json()["items"]
    company_tap = next(t for t in taps if t["card_id"] == tag["id"])
    assert company_tap["assignee"]["type"] == "business" and company_tap["assignee"]["name"] == "Acme Café"
    stats = (await client.get(f"{base}/analytics", headers=h)).json()
    assert stats["by_assignee_type"] == {"employee": 0, "customer": 0, "business": 1, "unassigned": 1}


async def test_reader_and_device_registration_of_company_cards(client: AsyncClient) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    dev = await pair_business_device(client, owner)
    r = await client.post("/api/v1/device/business/cards", headers=dev["headers"],
                          json={"uid": "04:AA:BB:CC", "name": "Reception", "assign_to_business": True})
    assert r.status_code == 201, r.text
    assert r.json()["assignee"]["type"] == "business" and r.json()["effective_status"] == "active"
    r = await client.post("/api/v1/device/business/cards", headers=dev["headers"], json={"uid": "04DDEEFF"})
    assert r.status_code == 201 and r.json()["assignee"] is None
    items = {c["name"]: c for c in (await client.get("/api/v1/device/business/cards", headers=dev["headers"])).json()["items"]}
    assert items["Reception"]["assignee_type"] == "business" and items["Reception"]["assignee_name"] == "Acme Café"
    assert items["Card EEFF"]["assignee_type"] is None

    body = {"event_id": str(uuid.uuid4()), "card_id": "04AABBCC", "detected_at": datetime.now(UTC).isoformat()}
    res = (await client.post("/api/v1/device/events", json=body, headers=dev["headers"])).json()
    b = res["business"]
    assert b["result"] == "recognized" and b["card"]["effective_status"] == "active"
    assert b["assignee"]["type"] == "business" and b["assignee"]["name"] == "Acme Café"
    assert b["assignee"]["position"] is None and b["message"] == "Acme Café · Reception"
    replay = (await client.post("/api/v1/device/events", json=body, headers=dev["headers"])).json()
    assert replay["business"]["assignee"]["type"] == "business"
    taps = (await client.get(f"{base}/taps?source=reader", headers=owner["headers"])).json()["items"]
    assert taps[0]["assignee"]["type"] == "business"


async def test_db_check_allows_only_one_assignee(client: AsyncClient) -> None:
    owner = await register_business(client)
    emp = await create_employee(client, owner)
    card = await create_card(client, owner, name="Mixed", assignee_type="employee", assignee_id=emp["id"])
    async with SessionLocal() as s:
        with pytest.raises(IntegrityError, match="single_assignee"):
            await s.execute(update(Card).where(Card.id == uuid.UUID(card["id"])).values(assigned_to_business=True))
            await s.commit()
