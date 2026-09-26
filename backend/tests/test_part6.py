"""Part 6: built-in pages, page templates, new actions, forms & .ics."""

from __future__ import annotations

import csv
import io
import json
import logging
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
from httpx import AsyncClient

from app.services import pages
from tests.conftest import bearer
from tests.p2_helpers import BROWSER_UA, add_member, create_card, pair_business_device, register_business

WEB = "http://web.test"


def _page(**extra: Any) -> dict[str, Any]:
    return {"title": "Page", "published": True, **extra}


async def _create(client: AsyncClient, owner: dict, **body: Any):  # type: ignore[no-untyped-def,type-arg]
    return await client.post(f"/api/v1/businesses/{owner['business_id']}/profiles", json=_page(**body),
                              headers=owner["headers"])


# ── §1 validation ──────────────────────────────────────────────────────────
HOSTILE_SECTIONS = [
    {"type": "links", "items": [{"label": "x", "url": "javascript:alert(1)"}]},
    {"type": "links", "items": [{"label": "x", "url": " JaVa\tScRiPt:alert(1)"}]},
    {"type": "links", "items": [{"label": "x", "url": "data:text/html,<script>1</script>"}]},
    {"type": "links", "items": [{"label": "x", "url": "//evil.example.com"}]},
    {"type": "links", "items": [{"label": "x", "url": "ftp://files.example.com"}]},
    {"type": "links", "items": [{"label": "x", "url": "https://ok.example.com", "icon": "<svg>"}]},
    {"type": "links", "items": [{"label": "x", "url": "https://ok.example.com", "onclick": "x"}]},
    {"type": "menu", "categories": [{"name": "A", "items": [{"name": "B", "image_url": "http://img.example.com/a.png"}]}]},
    {"type": "menu", "categories": [{"name": "A", "items": [{"name": "B", "image_url": "javascript:alert(1)"}]}]},
    {"type": "menu", "categories": [{"name": "A", "items": [{"name": "B", "image_url": "/media/../../etc/passwd"}]}]},
    {"type": "menu", "categories": [{"name": "A", "items": [{"name": "B", "badges": ["cheap"]}]}]},
    {"type": "products", "items": [{"name": "P", "cta": {"label": "Buy", "url": "javascript:x"}}]},
    {"type": "products", "items": [{"name": "P", "price": -5}]},
    {"type": "offer", "title": "Deal", "cta": {"label": "Go", "url": "vbscript:x"}},
    {"type": "offer", "title": "Deal", "valid_until": "next week"},
    {"type": "event", "title": "Launch"},
    {"type": "event", "title": "Launch", "starts_at": "2030-01-02T10:00:00Z", "ends_at": "2030-01-01T10:00:00Z"},
    {"type": "wifi", "ssid": "Guest", "security": "WPA"},
    {"type": "wifi", "ssid": "x" * 33, "security": "nopass"},
    {"type": "form", "title": "F", "fields": []},
    {"type": "form", "title": "F", "fields": [{"id": "a", "label": "A", "type": "file"}]},
    {"type": "form", "title": "F", "fields": [{"id": "a", "label": "A", "type": "text"}, {"id": "a", "label": "B", "type": "text"}]},
    {"type": "form", "title": "F", "fields": [{"id": "a", "label": "A", "type": "select"}]},
    {"type": "form", "title": "F", "fields": [{"id": f"f{i}", "label": "x", "type": "text"} for i in range(13)]},
    {"type": "gallery", "images": ["http://insecure.example.com/a.jpg"]},
    {"type": "hologram"},
    {"type": "about", "id": "Bad Id!"},
]


@pytest.mark.parametrize("section", HOSTILE_SECTIONS)
async def test_hostile_or_invalid_sections_rejected(client: AsyncClient, section: dict) -> None:  # type: ignore[type-arg]
    owner = await register_business(client)
    r = await _create(client, owner, type="custom", sections=[section])
    assert r.status_code == 422, (section, r.text)


@pytest.mark.parametrize("theme", [{"cover_image_url": "javascript:alert(1)"}, {"logo_url": "http://x.example.com/l.png"},
                                   {"accent": "red"}, {"header": "giant"}, {"font": "comic"}, {"corner_radius": 99},
                                   {"dark": "yes"}, {"background_image": "x"}])
async def test_bad_theme_rejected(client: AsyncClient, theme: dict) -> None:  # type: ignore[type-arg]
    owner = await register_business(client)
    assert (await _create(client, owner, theme=theme)).status_code == 422, theme


async def test_every_new_page_and_section_type_accepted(client: AsyncClient) -> None:
    owner = await register_business(client)
    good = {
        "menu": [{"type": "menu", "currency": "RWF", "show_images": True, "categories": [{"name": "Mains", "items": [
            {"name": "Brochette", "price": 4500, "image_url": "/media/businesses/x/a.webp", "badges": ["spicy", "popular"],
             "variants": [{"label": "Large", "price": 6000}]}]}]}],
        "product": [{"type": "products", "items": [{"name": "Beans", "price": "12.00", "compare_at_price": 15,
                                                     "image_url": "https://cdn.example.com/b.jpg", "badge": "Sale",
                                                     "in_stock": True, "cta": {"label": "Order", "url": "https://x.example.com"}}]}],
        "links": [{"type": "links", "items": [{"label": "Call", "url": "tel:+250788000111", "icon": "phone"},
                                              {"label": "Mail", "url": "mailto:hi@example.com", "icon": "email"},
                                              {"label": "IG", "url": "https://instagram.com/x", "icon": "instagram",
                                               "highlight": True}]}],
        "offer": [{"type": "offer", "title": "20% off", "code": "SPRING20", "discount_label": "-20%",
                   "valid_until": "2030-06-30", "terms": "One per customer",
                   "cta": {"label": "Shop", "url": "https://shop.example.com"}}],
        "event": [{"type": "event", "title": "Launch", "starts_at": "2030-01-02T18:00:00+02:00",
                   "ends_at": "2030-01-02T21:00:00+02:00", "venue": "HQ", "address": "KN 4 Ave", "map_query": "HQ Kigali"}],
        "gallery": [{"type": "gallery", "images": ["https://cdn.example.com/1.jpg", "/media/x/2.webp"]}],
        "form": [{"type": "form", "title": "Book", "fields": [
            {"id": "name", "label": "Name", "type": "text", "required": True},
            {"id": "slot", "label": "Slot", "type": "select", "options": ["AM", "PM"]}]}],
        "wifi": [{"type": "wifi", "ssid": "Guest", "password": "coffee123", "security": "WPA"}],
    }
    theme = {"accent": "#0F766E", "background": "#FFFFFF", "surface": "#F4F4F5", "text": "#111111", "font": "elegant",
             "layout": "bistro", "header": "banner", "cover_image_url": "https://cdn.example.com/c.jpg",
             "logo_url": "/media/businesses/x/logo.webp", "corner_radius": 12, "dark": True}
    for page_type, sections in good.items():
        r = await _create(client, owner, type=page_type, title=page_type, sections=sections, theme=theme)
        assert r.status_code == 201, (page_type, r.text)
        body = r.json()
        assert body["type"] == page_type and body["theme"] == theme
        assert all(s["id"] for s in body["sections"])  # server-assigned section ids


# ── §2 templates ───────────────────────────────────────────────────────────
def test_template_loader_skips_invalid(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    fixture = json.loads((Path(__file__).parent / "fixtures" / "page_templates.json").read_text())["templates"]
    dup = dict(fixture[0])
    file = tmp_path / "t.json"
    file.write_text(json.dumps([*fixture, dup, "junk", {"id": "x", "page_type": "menu"}]))
    with caplog.at_level(logging.ERROR, logger="app.page_templates"):
        loaded = pages.load_system_templates(file)
    assert [t["id"] for t in loaded] == ["fx_menu", "fx_links", "fx_feedback"]
    assert "fx_bad_url" in caplog.text
    (tmp_path / "bad.json").write_text("{nope")
    assert pages.load_system_templates(tmp_path / "bad.json") == []
    assert pages.load_system_templates(tmp_path / "missing.json") == []


def test_shipped_page_templates_are_valid() -> None:
    path = Path(__file__).resolve().parents[1] / "app" / "data" / "page_templates.json"
    if not path.exists():
        pytest.skip("app/data/page_templates.json not authored yet")
    raw = json.loads(path.read_text())
    items = raw["templates"] if isinstance(raw, dict) else raw
    problems = {t.get("id"): pages.validate_template_data(t)[1] for t in items}
    assert not {k: v for k, v in problems.items() if v}, problems
    assert len(pages.load_system_templates(path)) == len(items) >= 20


async def test_create_from_template_with_placeholders_and_defaults(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid, h = owner["business_id"], owner["headers"]
    public = (await client.get("/api/v1/page-templates")).json()
    assert {t["id"] for t in public} == {"fx_menu", "fx_links", "fx_feedback"} and all(t["scope"] == "system" for t in public)
    assert [t["id"] for t in (await client.get("/api/v1/page-templates?page_type=links")).json()] == ["fx_links"]

    r = await _create(client, owner, title="Dinner", template_id="fx_menu")
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["type"] == "menu" and p["theme"]["accent"] == "#b91c1c" and p["theme"]["layout"] == "bistro"
    assert p["sections"][0]["text"] == "Welcome to Acme Café"
    contact = p["sections"][2]
    assert contact["phone"] == "+250788000111" and contact["website"] == "https://acme.example.com"
    r = await _create(client, owner, title="Links", template_id="fx_links")
    links = r.json()
    assert links["theme"]["accent"] == "#0F766E"  # template value kept
    assert [i["url"] for i in links["sections"][0]["items"]] == ["https://acme.example.com", "mailto:hello@acme.example.com"]
    # missing business values: items that would link nowhere are dropped
    r = await client.patch(f"/api/v1/businesses/{bid}", json={"website": None}, headers=h)
    assert r.status_code == 200
    r2 = await _create(client, owner, title="Links 2", template_id="fx_links")
    assert r2.status_code == 201, r2.text
    links2 = r2.json()
    assert [i["label"] for i in links2["sections"][0]["items"]] == ["Email us"]

    assert (await _create(client, owner, title="X", template_id="nope")).status_code == 404
    r = await _create(client, owner, title="X", template_id="fx_menu", type="links")
    assert r.status_code == 422


async def test_duplicate_and_business_templates_are_scoped(client: AsyncClient) -> None:
    owner = await register_business(client)
    other = await register_business(client, name="Other Co")
    bid, h = owner["business_id"], owner["headers"]
    menu = (await _create(client, owner, title="Lunch", template_id="fx_menu")).json()

    dup = await client.post(f"/api/v1/businesses/{bid}/profiles/{menu['id']}/duplicate", json={"title": "Branch 2 lunch"},
                            headers=h)
    assert dup.status_code == 201, dup.text
    d = dup.json()
    assert d["published"] is False and d["type"] == "menu" and d["sections"] == menu["sections"] and d["slug"] != menu["slug"]
    assert (await client.post(f"/api/v1/businesses/{bid}/profiles/{menu['id']}/duplicate", headers=h)).json()["title"] \
        == "Lunch (copy)"

    r = await client.post(f"/api/v1/businesses/{bid}/profiles/{menu['id']}/save-as-template",
                          json={"name": "Our branch menu", "description": "Standard"}, headers=h)
    assert r.status_code == 201, r.text
    tpl = r.json()
    assert tpl["scope"] == "business" and tpl["business_id"] == bid and tpl["page_type"] == "menu"
    mine = {t["id"] for t in (await client.get(f"/api/v1/businesses/{bid}/page-templates", headers=h)).json()}
    assert tpl["id"] in mine and "fx_menu" in mine
    theirs = {t["id"] for t in (await client.get(f"/api/v1/businesses/{other['business_id']}/page-templates",
                                                 headers=other["headers"])).json()}
    assert tpl["id"] not in theirs and tpl["id"] not in {t["id"] for t in (await client.get("/api/v1/page-templates")).json()}
    # another business can't use, edit or delete it
    r = await _create(client, other, title="Stolen", template_id=tpl["id"])
    assert r.status_code == 404 and r.json()["error"]["code"] == "page_template_not_found"
    ob = f"/api/v1/businesses/{other['business_id']}/page-templates/{tpl['id']}"
    assert (await client.patch(ob, json={"name": "x"}, headers=other["headers"])).status_code == 404
    assert (await client.delete(ob, headers=other["headers"])).status_code == 404
    # system templates are read-only
    assert (await client.patch(f"/api/v1/businesses/{bid}/page-templates/fx_menu", json={"name": "x"},
                               headers=h)).status_code == 404
    # staff can read but not manage
    staff = await add_member(client, owner, "staff")
    assert (await client.get(f"/api/v1/businesses/{bid}/page-templates", headers=staff["headers"])).status_code == 200
    assert (await client.delete(f"/api/v1/businesses/{bid}/page-templates/{tpl['id']}",
                                headers=staff["headers"])).status_code == 403

    r = await client.patch(f"/api/v1/businesses/{bid}/page-templates/{tpl['id']}", json={
        "name": "Renamed", "sections": [{"type": "links", "items": [{"label": "x", "url": "javascript:1"}]}]}, headers=h)
    assert r.status_code == 422
    r = await client.patch(f"/api/v1/businesses/{bid}/page-templates/{tpl['id']}", json={"name": "Renamed"}, headers=h)
    assert r.json()["name"] == "Renamed"
    created = (await _create(client, owner, title="From mine", template_id=tpl["id"])).json()
    assert created["type"] == "menu" and created["sections"][1]["categories"] == menu["sections"][1]["categories"]
    assert (await client.delete(f"/api/v1/businesses/{bid}/page-templates/{tpl['id']}", headers=h)).status_code == 204

    from app.services import pages as pages_service

    for i in range(pages_service.MAX_BUSINESS_TEMPLATES):
        await client.post(f"/api/v1/businesses/{bid}/profiles/{menu['id']}/save-as-template", json={"name": f"T{i}"},
                          headers=h)
    r = await client.post(f"/api/v1/businesses/{bid}/profiles/{menu['id']}/save-as-template", json={"name": "one more"},
                          headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "page_template_limit"


# ── §3 actions ─────────────────────────────────────────────────────────────
async def test_new_page_actions_validate_and_resolve(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid, h, slug = owner["business_id"], owner["headers"], owner["slug"]
    types = {t["type"]: t for t in (await client.get("/api/v1/actions/types")).json()}
    for t, pt in (("links_page", "links"), ("offer_page", "offer"), ("event_page", "event"), ("feedback_form", "form"),
                  ("gallery_page", "gallery"), ("digital_menu", "menu"), ("product_info", "product"), ("wifi", "wifi")):
        field = next(f for f in types[t]["fields"] if f["name"] == "profile_id")
        assert field["page_type"] == pt, t

    made = {}
    for pt, sections in (("links", [{"type": "links", "items": [{"label": "a", "url": "https://a.example.com"}]}]),
                         ("offer", [{"type": "offer", "title": "Deal"}]),
                         ("event", [{"type": "event", "title": "E", "starts_at": "2030-01-01T10:00:00Z"}]),
                         ("form", [{"type": "form", "title": "F", "fields": [{"id": "r", "label": "R", "type": "rating"}]}]),
                         ("gallery", [{"type": "gallery", "images": []}]),
                         ("wifi", [{"type": "wifi", "ssid": "Guest", "password": "pw123456", "security": "WPA"}])):
        made[pt] = (await _create(client, owner, type=pt, title=f"{pt} page", sections=sections)).json()

    for action_type, pt in (("links_page", "links"), ("offer_page", "offer"), ("event_page", "event"),
                            ("feedback_form", "form"), ("gallery_page", "gallery")):
        # wrong page type rejected
        wrong = made["links" if pt != "links" else "offer"]
        r = await client.post(f"/api/v1/businesses/{bid}/cards", headers=h, json={
            "name": "x", "action": {"type": action_type, "config": {"profile_id": wrong["id"]}}})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_action_config", action_type
        card = await create_card(client, owner, name=action_type,
                                 action={"type": action_type, "config": {"profile_id": made[pt]["id"]}})
        r = await client.get(f"/t/{card['public_code']}", headers={"User-Agent": BROWSER_UA})
        assert r.status_code == 302 and r.headers["location"] == f"{WEB}/b/{slug}/{made[pt]['slug']}", action_type
    # url fallback only where allowed
    card = await create_card(client, owner, name="ext", action={"type": "event_page",
                                                                "config": {"url": "https://events.example.com/x"}})
    r = await client.get(f"/t/{card['public_code']}", headers={"User-Agent": BROWSER_UA})
    assert r.headers["location"] == "https://events.example.com/x"
    r = await client.post(f"/api/v1/businesses/{bid}/cards", headers=h, json={
        "name": "x", "action": {"type": "links_page", "config": {"url": "https://a.example.com"}}})
    assert r.status_code == 422
    r = await client.post(f"/api/v1/businesses/{bid}/cards", headers=h, json={
        "name": "x", "action": {"type": "gallery_page", "config": {}}})
    assert r.status_code == 422

    # wifi via a Wi-Fi page: tap opens the page; /public/w/ serves the page's network; reader shows the url
    wifi = await create_card(client, owner, name="wifi tag", kind="tag", uid="04A0B0C0",
                             action={"type": "wifi", "config": {"profile_id": made["wifi"]["id"]}})
    r = await client.get(f"/t/{wifi['public_code']}", headers={"User-Agent": BROWSER_UA})
    assert r.headers["location"] == f"{WEB}/b/{slug}/{made['wifi']['slug']}"
    w = (await client.get(f"/api/v1/public/w/{wifi['public_code']}")).json()
    assert w["ssid"] == "Guest" and w["wifi_qr"].startswith("WIFI:T:WPA;S:Guest;P:pw123456")
    dev = await pair_business_device(client, owner)
    import uuid
    from datetime import UTC, datetime

    res = (await client.post("/api/v1/device/events", headers=dev["headers"], json={
        "event_id": str(uuid.uuid4()), "card_id": "04A0B0C0", "detected_at": datetime.now(UTC).isoformat()})).json()
    assert res["business"]["result"] == "recognized"
    assert res["business"]["action"]["url"] == f"{WEB}/b/{slug}/{made['wifi']['slug']}"


# ── §4 forms ───────────────────────────────────────────────────────────────
async def test_forms_submit_validation_honeypot_rate_limit_export_and_analytics(client: AsyncClient) -> None:
    owner = await register_business(client)
    bid, h, slug = owner["business_id"], owner["headers"], owner["slug"]
    page = (await _create(client, owner, title="Feedback", template_id="fx_feedback", published=True)).json()
    form_id = page["sections"][0]["id"]
    assert form_id == "feedback" and page["sections"][0]["title"] == "How did we do at Acme Café?"
    url = f"/api/v1/public/b/{slug}/{page['slug']}/forms/{form_id}"
    card = await create_card(client, owner, name="Table 4")

    for bad in ({}, {"rating": 6}, {"rating": "5"}, {"rating": 4, "extra": 1}, {"rating": 4, "comment": "x" * 5001}):
        r = await client.post(url, json={"answers": bad})
        assert r.status_code == 422, bad
    r = await client.post(url, json={"answers": {"rating": 5, "comment": "=HYPERLINK(\"http://evil\")"},
                                     "card": card["public_code"]})
    assert r.status_code == 201 and r.json()["message"] == "Thanks!"
    r = await client.post(url, json={"answers": {"rating": 2}, "website": "http://spam"})  # honeypot: dropped
    assert r.status_code == 201
    codes = [(await client.post(url, json={"answers": {"rating": 3}})).status_code for _ in range(4)]
    assert codes == [201, 201, 201, 429]  # 5 accepted submissions per 10 min per IP and page (honeypot included)
    r = await client.post(url, json={"answers": {"rating": 3}})
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    assert (await client.post(f"/api/v1/public/b/{slug}/{page['slug']}/forms/nope", json={"answers": {}})).status_code == 404

    listed = (await client.get(f"/api/v1/businesses/{bid}/form-responses?profile_id={page['id']}", headers=h)).json()
    assert listed["total"] == 4
    first = listed["items"][-1]
    assert first["answers"]["rating"] == 5 and first["card_name"] == "Table 4" and first["profile_title"] == "Feedback"
    csv_text = (await client.get(f"/api/v1/businesses/{bid}/form-responses/export.csv", headers=h)).text
    rows = list(csv.reader(io.StringIO(csv_text)))
    assert rows[0][5:] == ["Rating", "Comment"] and len(rows) == 5
    assert any(r[6].startswith("'=HYPERLINK") for r in rows[1:])
    stats = (await client.get(f"/api/v1/businesses/{bid}/analytics", headers=h)).json()
    assert stats["feedback"] == {"responses": 4, "avg_rating": 3.5}
    notes = (await client.get("/api/v1/notifications", headers=h)).json()["items"]
    assert notes[0]["type"] == "business.form_response"

    staff = await add_member(client, owner, "staff")
    assert (await client.get(f"/api/v1/businesses/{bid}/form-responses", headers=staff["headers"])).status_code == 403
    other = await register_business(client, name="Nosy")
    assert (await client.get(f"/api/v1/businesses/{bid}/form-responses", headers=other["headers"])).status_code == 403
    r = await client.delete(f"/api/v1/businesses/{other['business_id']}/form-responses/{first['id']}",
                            headers=other["headers"])
    assert r.status_code == 404
    assert (await client.delete(f"/api/v1/businesses/{bid}/form-responses/{first['id']}", headers=h)).status_code == 204
    # unpublished page → form unavailable
    await client.post(f"/api/v1/businesses/{bid}/profiles/{page['id']}/unpublish", headers=h)
    r = await client.post(url, json={"answers": {"rating": 5}}, headers={"X-Forwarded-For": "1.2.3.4"})
    assert r.status_code == 404


# ── §5 .ics ────────────────────────────────────────────────────────────────
async def test_event_ics(client: AsyncClient) -> None:
    owner = await register_business(client)
    page = (await _create(client, owner, type="event", title="Launch", sections=[{
        "type": "event", "id": "launch", "title": "Launch; party, v2", "starts_at": "2030-01-02T18:00:00+02:00",
        "ends_at": "2030-01-02T21:00:00+02:00", "venue": "HQ", "address": "KN 4 Ave",
        "description": "Line 1\nLine 2"}])).json()
    r = await client.get(f"/api/v1/public/b/{owner['slug']}/{page['slug']}/events/launch.ics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    assert "DTSTART:20300102T160000Z" in body and "DTEND:20300102T190000Z" in body
    assert "SUMMARY:Launch\\; party\\, v2" in body and "DESCRIPTION:Line 1\\nLine 2" in body
    assert "LOCATION:HQ\\, KN 4 Ave" in body and urlsplit(owner["slug"]).path in body
    assert (await client.get(f"/api/v1/public/b/{owner['slug']}/{page['slug']}/events/nope.ics")).status_code == 404


def test_answer_validation_unit() -> None:
    form = {"fields": [{"id": "e", "label": "E", "type": "email", "required": True},
                       {"id": "p", "label": "P", "type": "phone"}, {"id": "c", "label": "C", "type": "checkbox"},
                       {"id": "s", "label": "S", "type": "select", "options": ["a", "b"]}]}
    clean, rating = pages.validate_answers(form, {"e": "a@b.co", "p": "+250 788 000", "c": True, "s": "b"})
    assert clean == {"e": "a@b.co", "p": "+250 788 000", "c": True, "s": "b"} and rating is None
    for bad in ({"e": "nope"}, {"e": "a@b.co", "p": "call me"}, {"e": "a@b.co", "s": "z"}, {"e": "a@b.co", "c": "yes"}):
        with pytest.raises(Exception):
            pages.validate_answers(form, bad)
    assert bearer("x")  # keep helper import used
