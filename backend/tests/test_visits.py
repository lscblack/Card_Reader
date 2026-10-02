"""Page visits: public tracking, the admin site report, support-page and business-page counts."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import bearer, register
from tests.p2_helpers import BROWSER_UA, register_business
from tests.test_part4 import register_personal

UA = {"User-Agent": BROWSER_UA}


async def _admin(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    return bearer(r.json()["access_token"])


async def _visit(client: AsyncClient, path: str, referrer: str | None = None, headers: dict | None = None) -> None:
    r = await client.post("/api/v1/visits", json={"path": path, "referrer": referrer}, headers={**UA, **(headers or {})})
    assert r.status_code == 204, r.text


async def test_site_support_and_business_visits(client: AsyncClient) -> None:
    admin = await _admin(client)
    owner = await register_business(client)
    slug, bid = owner["slug"], owner["business_id"]
    person = await register_personal(client)
    card = (await client.get("/api/v1/personal/cards", headers=person["headers"])).json()[0]

    await _visit(client, "/", referrer="https://www.google.com/search?q=nfc")
    await _visit(client, "/?utm=x")  # query strings are dropped
    await _visit(client, "/support")
    await _visit(client, f"/b/{slug}")
    await _visit(client, f"/b/{slug.upper()}/")
    await _visit(client, f"/p/{card['slug']}")
    # Not counted: private areas, unknown pages, bots.
    await _visit(client, "/dashboard/usage")
    await _visit(client, "/admin")
    await _visit(client, "/b/no-such-business")
    r = await client.post("/api/v1/visits", json={"path": "/"}, headers={"User-Agent": "Googlebot/2.1"})
    assert r.status_code == 204

    report = (await client.get("/api/v1/admin/visits", headers=admin, params={"days": 7})).json()
    assert report["period"]["visits"] == 6 and report["period"]["unique_visitors"] == 1
    assert report["by_kind"] == {"site": 2, "support": 1, "business": 2, "personal": 1}
    assert report["top_pages"][0]["path"] in ("/", f"/b/{slug}")
    assert report["top_referrers"] == [{"host": "www.google.com", "visits": 1}]
    assert len(report["daily"]) == 7 and report["daily"][-1]["visits"] == 6
    assert report["devices"] == {"ios": 6}

    support = (await client.get("/api/v1/admin/support", headers=admin)).json()
    assert support["page_visits_30d"] == 1

    biz = (await client.get(f"/api/v1/businesses/{bid}/page-visits", headers=owner["headers"])).json()
    assert biz["period"]["visits"] == 2 and biz["today"]["visits"] == 2
    assert biz["pages"][0]["title"] == "Business page" and biz["pages"][0]["visits"] == 2

    user = bearer((await register(client))["access_token"])
    assert (await client.get("/api/v1/admin/visits", headers=user)).status_code == 403
    assert (await client.get(f"/api/v1/businesses/{bid}/page-visits", headers=user)).status_code in (403, 404)
