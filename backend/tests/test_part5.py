"""Part 5: card design v2 — template validation, arrangements, design presets, ID badges."""

from __future__ import annotations

import copy
import json
import logging
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.services import card_design_v2 as v2
from tests.conftest import bearer, create_app, register_device
from tests.p2_helpers import BROWSER_UA, create_employee, pair_business_device, register_business, token_from_url
from tests.test_part4 import mint, phone_login, primary, register_personal

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "card_templates_v2.json").read_text())["templates"]
LAND, BADGE = FIXTURES


def _bad(mutate: Any) -> list[str]:
    t = copy.deepcopy(LAND)
    mutate(t)
    template, errors = v2.validate_template(t)
    assert template is None
    return errors


# ── §1 template validation ────────────────────────────────────────────────
def test_fixture_templates_are_valid() -> None:
    for t in FIXTURES:
        assert v2.validate_template(t)[1] == []


@pytest.mark.parametrize("path", [
    'M0 0 L10 10" onload="alert(1)',
    "M0 0 L10 10 Z<script>alert(1)</script>",
    "M0 0 l10 10 z",                      # relative commands are not allowed
    "M0 0 L10 10 url(#x)",
    "M0 0 L1e3 10",                       # exponent notation
    "M0 0 L10",                           # wrong arity
    "L10 10",                             # must start with M
    "M0 0 L99999 10",                     # far outside the canvas
    "M0 0 A50 50 0 2 1 100 100",          # arc flags must be 0/1
    "M0 0 L10 10 Z 5",                    # Z takes no numbers
    "M0 0 L--5 10",
    "",
])
def test_bad_paths_are_rejected(path: str) -> None:
    assert v2.validate_path(path, 1750, 1000) is not None
    errors = _bad(lambda t: t["canvas"]["front"]["layers"][0].update(path=path))
    assert any("layers.0.path" in e for e in errors)


def test_good_paths_accepted() -> None:
    for p in ("M0 0 H1750 V380 L0 620 Z", "M0,0 C10,20 30,40 50,60 S70 80 90 100 Q1 2 3 4 T5 6 Z",
              "M-10 -10 L1760 1010 A20 20 45 1 0 100 100 Z", "M.5 .5 L10.25 3"):
        assert v2.validate_path(p, 1750, 1000) is None, p


@pytest.mark.parametrize("mutate,needle", [
    (lambda t: t.update(engine="v3"), "engine"),
    (lambda t: t.update(id="Bad Id!"), "id"),
    (lambda t: t.update(format="square"), "format"),
    (lambda t: t.update(sides=["back"]), "sides"),
    (lambda t: t["canvas"].pop("back"), "canvas"),
    (lambda t: t["canvas"]["front"].update(background="javascript:alert(1)"), "background"),
    (lambda t: t["canvas"]["front"]["layers"][0].update(fill="url(#evil)"), "fill"),
    (lambda t: t["canvas"]["front"]["layers"][0].update(opacity=3), "opacity"),
    (lambda t: t["canvas"]["front"]["layers"][0].update(onclick="x"), "layers.0"),
    (lambda t: t["canvas"]["front"]["zones"][0].update(rect=[1500, 0, 400, 100]), "rect"),
    (lambda t: t["canvas"]["front"]["zones"][0].update(accepts=["photo", "hologram"]), "accepts"),
    (lambda t: t["canvas"]["front"]["zones"][0].update(max_blocks=0), "max_blocks"),
    (lambda t: t["canvas"]["front"]["zones"][1].update(id="hero"), "id"),
    (lambda t: t["canvas"]["front"]["zones"][0].update(on="image"), "on"),
    (lambda t: t["default_design"].update(primary="red"), "primary"),
    (lambda t: t["default_design"].update(background_image_opacity=0.95), "opacity"),
    (lambda t: t["default_design"].update(onload="x"), "onload"),
    (lambda t: t["default_arrangement"]["front"].update(hero=["photo", "name", "logo", "company"]), "at most"),
    (lambda t: t["default_arrangement"]["front"].update(info=["photo"]), "accept"),
    (lambda t: t["default_arrangement"]["back"].update(brand=["logo", "name"]), "accept"),
    (lambda t: t["default_arrangement"]["back"].update(brand=["qr"], nope=["qr"]), "unknown zone"),
])
def test_bad_templates_are_rejected(mutate: Any, needle: str) -> None:
    errors = _bad(mutate)
    assert any(needle in e for e in errors), errors


def test_loader_skips_invalid_templates_without_crashing(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    evil = copy.deepcopy(LAND)
    evil["id"] = "evil_path"
    evil["canvas"]["front"]["layers"][0]["path"] = 'M0 0 L10 10" onload="alert(1)'
    dup = copy.deepcopy(BADGE)
    clash = copy.deepcopy(BADGE)
    clash["id"] = "modern"  # a v1 template id
    file = tmp_path / "t.json"
    file.write_text(json.dumps({"templates": [LAND, evil, BADGE, dup, clash, "junk"]}))
    with caplog.at_level(logging.ERROR, logger="app.card_templates"):
        loaded = v2.load_templates(file)
    assert [t["id"] for t in loaded] == ["fixture_band", "fixture_badge"]
    assert "evil_path" in caplog.text
    (tmp_path / "broken.json").write_text("{not json")
    assert v2.load_templates(tmp_path / "broken.json") == []
    assert v2.load_templates(tmp_path / "missing.json") == []


def test_shipped_template_file_is_valid() -> None:
    """The authored file (if present) must be fully valid: nothing silently skipped, ≥ 16 templates."""
    from app.core.config import settings

    path = Path(__file__).resolve().parents[1] / "app" / "data" / "card_templates_v2.json"
    if not path.exists():
        pytest.skip("app/data/card_templates_v2.json not authored yet")
    raw = json.loads(path.read_text())
    items = raw["templates"] if isinstance(raw, dict) else raw
    problems = {t.get("id"): v2.validate_template(t)[1] for t in items}
    assert not {k: v for k, v in problems.items() if v}, problems
    assert len(v2.load_templates(path)) == len(items) >= 16
    assert settings.CARD_TEMPLATES_V2_PATH  # configured


# ── serving templates & presets ───────────────────────────────────────────
async def test_templates_endpoint_serves_v1_and_v2(client: AsyncClient) -> None:
    templates = {t["id"]: t for t in (await client.get("/api/v1/personal/templates")).json()}
    assert templates["modern"]["engine"] == "v1" and "canvas" not in templates["modern"]
    band = templates["fixture_band"]
    assert band["engine"] == "v2" and band["format"] == "landscape" and band["sides"] == ["front", "back"]
    assert band["canvas"]["front"]["zones"][0]["id"] == "hero" and band["category"] == "business"
    assert band["default_arrangement"] == LAND["default_arrangement"] and band["layout"] == "compact"
    assert templates["fixture_badge"]["format"] == "portrait" and templates["fixture_badge"]["category"] == "badge"


async def test_design_presets(client: AsyncClient) -> None:
    r = await client.get("/api/v1/personal/design-presets")
    assert r.status_code == 200
    data = r.json()
    assert len(data["palettes"]) >= 16 and len({p["id"] for p in data["palettes"]}) == len(data["palettes"])
    for p in data["palettes"]:
        assert all(v2.HEX_RE.match(p[k]) for k in ("primary", "secondary", "background", "text", "accent"))
    assert {"crimson_navy", "gold_black", "teal", "ocean", "forest", "sunset", "mono", "pastel"} <= {
        p["id"] for p in data["palettes"]}
    assert data["font_pairs"] and all({"id", "heading", "body", "style"} <= set(f) for f in data["font_pairs"])
    # Font-pair ids are exactly the design.font values the renderers understand, and cards accept them.
    from app.services.personal import FONTS
    assert {f["id"] for f in data["font_pairs"]} == set(FONTS)


def test_template_variants_are_validated_and_kept() -> None:
    good = copy.deepcopy(LAND)
    good["variants"] = [{"id": "calm", "name": "Calm", "canvas": {"front": {"layers": [
        {"path": "M0 800 C 500 700 1100 900 1750 780 V1000 H0 Z", "fill": "accent", "opacity": 1}]}}}]
    template, errors = v2.validate_template(good)
    assert not errors and template is not None
    assert template["variants"][0]["id"] == "calm"

    def bad_path(t: dict[str, Any]) -> None:
        t["variants"] = [{"id": "x", "name": "X", "canvas": {"front": {"layers": [
            {"path": 'M0 0 L10 10" onload="alert(1)', "fill": "primary"}]}}}]

    def bad_side(t: dict[str, Any]) -> None:
        t["variants"] = [{"id": "x", "name": "X", "canvas": {"side3": {"layers": []}}}]

    def zones_override(t: dict[str, Any]) -> None:
        t["variants"] = [{"id": "x", "name": "X", "canvas": {"front": {"layers": [], "zones": []}}}]

    assert any("path" in e for e in _bad(bad_path))
    assert any("override" in e for e in _bad(bad_side))
    assert any("only replace layers" in e for e in _bad(zones_override))


# ── §2 cards: design_version, sides, arrangement, badge fields ────────────
async def test_v2_card_create_arrangement_rules_and_remap(client: AsyncClient) -> None:
    p = await register_personal(client)
    h = p["headers"]
    card = await primary(client, h)
    assert card["design_version"] == 1 and card["sides_enabled"] == ["front"] and card["arrangement"] is None

    r = await client.post("/api/v1/personal/cards", headers=h, json={"label": "Work", "template_id": "fixture_band"})
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["design_version"] == 2 and c["sides_enabled"] == ["front", "back"]
    assert c["arrangement"] == LAND["default_arrangement"] and c["design"]["photo_shape"] == "circle"
    cid = c["id"]

    bad = {"front": {"hero": ["photo", "photo"]}, "back": {"nope": ["qr"]}, "middle": {}}
    r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"arrangement": bad})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_arrangement"
    assert r.json()["error"]["ref"] == "NFC-6018"
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"body.arrangement.front.hero", "body.arrangement.back.nope", "body.arrangement.middle"} <= fields
    for arrangement in ({"front": {"info": ["photo"]}},                                  # not accepted by zone
                        {"front": {"hero": ["photo", "name", "logo", "company"]}},        # > max_blocks
                        {"front": {"hero": ["logo"]}, "back": {"brand": ["logo"]}},        # placed twice
                        {"front": {"hero": ["hologram"]}}):
        r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"arrangement": arrangement})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_arrangement", arrangement

    mine = {"front": {"hero": ["name", "company"], "info": ["qr", "contacts"]}, "back": {"brand": ["logo", "bio"]}}
    r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={
        "arrangement": mine, "sides_enabled": ["front"],
        "design": {"secondary": "#0f766e", "photo_shape": "hexagon", "icon_style": "outline",
                   "background_image_opacity": 0.4, "decor_style": "wave_b"},
        "fields": {"id_number": "EMP-0042", "valid_until": "2030-12-31", "barcode_value": "EMP-0042"}})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["arrangement"] == mine and c["sides_enabled"] == ["front"] and c["design"]["secondary"] == "#0F766E"
    assert c["fields"]["id_number"] == "EMP-0042" and c["expired"] is False
    for design in ({"photo_shape": "star"}, {"background_image_opacity": 0.9}, {"icon_style": 3}):
        r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"design": design})
        assert r.status_code == 422, design
    for fields in ({"valid_until": "31/12/2030"}, {"barcode_value": "é" * 3}, {"barcode_value": "x" * 49},
                   {"valid_from": "2031-01-01", "valid_until": "2030-01-01"}):
        r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"fields": fields})
        assert r.status_code == 422, fields
    r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"sides_enabled": ["back"]})
    assert r.status_code == 422

    # switch to the badge template: fields kept, blocks remapped to the first accepting zone, unplaceable ones dropped
    r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"template_id": "fixture_badge"})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["design_version"] == 2 and c["sides_enabled"] == ["front"] and c["fields"]["id_number"] == "EMP-0042"
    assert c["arrangement"] == {"front": {"main": ["name"], "top": ["company", "logo"], "foot": ["qr", "contacts"]}}
    # back to v1: arrangement cleared
    r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"template_id": "classic"})
    assert r.json()["design_version"] == 1 and r.json()["arrangement"] is None
    r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"arrangement": mine})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_arrangement"
    # v1 → v2 uses the template default
    r = await client.patch(f"/api/v1/personal/cards/{cid}", headers=h, json={"template_id": "fixture_band"})
    assert r.json()["arrangement"] == LAND["default_arrangement"] and r.json()["sides_enabled"] == ["front", "back"]
    dup = await client.post(f"/api/v1/personal/cards/{cid}/duplicate", headers=h)
    assert dup.status_code == 201 and dup.json()["design_version"] == 2


def test_remap_arrangement_unit() -> None:
    band, badge = v2.validate_template(LAND)[0], v2.validate_template(BADGE)[0]
    assert v2.remap_arrangement(None, badge) == BADGE["default_arrangement"]
    moved = v2.remap_arrangement(LAND["default_arrangement"], badge)
    assert moved == {"front": {"main": ["photo", "name"], "foot": ["contacts", "qr"], "top": ["logo", "company"]}}
    assert v2.arrangement_errors(badge, moved) == []
    back = v2.remap_arrangement(moved, band)
    assert v2.arrangement_errors(band, back) == [] and "badge_meta" not in json.dumps(back)


async def test_public_card_exposes_v2_render_data_filtered_by_visibility(client: AsyncClient) -> None:
    p = await register_personal(client)
    h = p["headers"]
    c = (await client.post("/api/v1/personal/cards", headers=h, json={
        "label": "Badge", "template_id": "fixture_badge",
        "fields": {"full_name": "Ana B", "id_number": "A-77", "barcode_value": "A-77",
                   "valid_until": (date.today() - timedelta(days=2)).isoformat()}})).json()
    r = await client.get(f"/api/v1/public/p/{c['slug']}", headers={"User-Agent": BROWSER_UA})
    assert r.status_code == 200
    card = r.json()["card"]
    assert card["design_version"] == 2 and card["sides_enabled"] == ["front"]
    assert card["arrangement"] == BADGE["default_arrangement"] and card["template"]["canvas"]["front"]["zones"]
    assert card["expired"] is True
    assert card["fields"]["valid_until"] and "id_number" not in card["fields"] and "barcode_value" not in card["fields"]
    await client.patch(f"/api/v1/personal/cards/{c['id']}", headers=h,
                       json={"visibility": {"id_number": "public", "valid_until": "hidden"}})
    card = (await client.get(f"/api/v1/public/p/{c['slug']}")).json()["card"]
    assert card["fields"]["id_number"] == "A-77" and "valid_until" not in card["fields"]
    vcf = (await client.get(f"/api/v1/public/p/{c['slug']}/vcard")).text
    assert "A-77" not in vcf and "FN:Ana B" in vcf  # vCard unchanged (no badge fields)


# ── §4 business-issued badges ─────────────────────────────────────────────
async def test_employee_number_unique_per_business(client: AsyncClient) -> None:
    owner = await register_business(client)
    other = await register_business(client, name="Other Co")
    base = f"/api/v1/businesses/{owner['business_id']}"
    e1 = await create_employee(client, owner, "A", "One", employee_number="E-001")
    assert e1["employee_number"] == "E-001"
    r = await client.post(f"{base}/employees", headers=owner["headers"],
                          json={"first_name": "B", "last_name": "Two", "employee_number": "E-001"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "employee_number_taken"
    assert r.json()["error"]["ref"] == "NFC-6019"
    e2 = await create_employee(client, owner, "B", "Two", employee_number="E-002")
    r = await client.patch(f"{base}/employees/{e2['id']}", headers=owner["headers"], json={"employee_number": "E-001"})
    assert r.status_code == 409
    r = await client.patch(f"{base}/employees/{e1['id']}", headers=owner["headers"], json={"employee_number": "E-001"})
    assert r.status_code == 200  # its own number
    r = await client.post(f"{base}/employees", headers=owner["headers"],
                          json={"first_name": "C", "employee_number": "bad\nnumber"})
    assert r.status_code == 422
    await create_employee(client, other, "Z", "Z", employee_number="E-001")  # other business: fine


async def test_business_badge_issue_accept_lock_and_expired_reads(client: AsyncClient, user: dict) -> None:
    owner = await register_business(client)
    base = f"/api/v1/businesses/{owner['business_id']}"
    emp = await create_employee(client, owner, "Kim", "Lee", employee_number="E-900")
    r = await client.post(f"{base}/employees/{emp['id']}/digital-card", headers=owner["headers"], json={
        "email": "kim@example.com", "template_id": "fixture_badge", "arrangement": {"front": {"main": ["photo"]}}})
    assert r.status_code == 201, r.text  # partial arrangement: other blocks hidden
    r = await client.post(f"{base}/employees/{emp['id']}/digital-card", headers=owner["headers"], json={
        "email": "kim@example.com", "template_id": "fixture_badge", "arrangement": {"front": {"top": ["barcode"]}}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_arrangement"
    r = await client.post(f"{base}/employees/{emp['id']}/digital-card", headers=owner["headers"], json={
        "email": "kim@example.com", "template_id": "fixture_badge", "badge": {"valid_until": "yesterday"}})
    assert r.status_code == 422
    yesterday = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()
    r = await client.post(f"{base}/employees/{emp['id']}/digital-card", headers=owner["headers"], json={
        "email": "kim@example.com", "template_id": "fixture_badge", "badge": {"valid_until": yesterday}})
    assert r.status_code == 201, r.text
    token = token_from_url(r.json()["dev_invite_url"])
    reg = await client.post("/api/v1/auth/register", json={"country": "RW", "email": "kim@example.com", "password": "Sup3rSecretPass",
                                                           "full_name": "Kim Lee", "card_invite_token": token})
    assert reg.status_code == 201, reg.text
    kim = {"headers": bearer(reg.json()["access_token"]), "email": "kim@example.com"}
    card = (await client.get("/api/v1/personal/cards", headers=kim["headers"])).json()[0]
    assert card["design_version"] == 2 and card["template_id"] == "fixture_badge"
    assert card["fields"]["id_number"] == "E-900" and card["fields"]["barcode_value"] == "E-900"
    assert card["fields"]["valid_until"] == yesterday and card["expired"] is True
    assert set(card["business_link"]["locked_fields"]) == {"company", "id_number", "valid_until", "barcode_value"}
    r = await client.patch(f"/api/v1/personal/cards/{card['id']}", headers=kim["headers"],
                           json={"fields": {"valid_until": "2099-01-01"}})
    assert r.status_code == 403 and r.json()["error"]["code"] == "field_locked"

    # readers: developer terminal (payload) and the business's own terminal both see expired
    sess = await phone_login(client, kim)
    created = await create_app(client, user["headers"], endpoint_url="http://127.0.0.1:9/hook")
    dev = await register_device(client, created["api_key_plaintext"])
    tok = mint(sess, card)
    body = {"event_id": str(uuid.uuid4()), "card_id": uuid.UUID(card["share_id"]).hex.upper(),
            "detected_at": datetime.now(UTC).isoformat(), "digital_card_token": tok, "card_type": "digital_card"}
    import httpx
    import respx

    with respx.mock(assert_all_called=False) as mock:
        route = mock.post("http://127.0.0.1:9/hook").mock(return_value=httpx.Response(200))
        r = await client.post("/api/v1/device/events", headers=bearer(dev["device_token"]), json=body)
    assert r.status_code == 200, r.text
    assert r.json()["digital_card"]["verified"] is True and r.json()["digital_card"]["expired"] is True
    sent = json.loads(route.calls[0].request.content)
    assert sent["digital_card"]["expired"] is True and sent["digital_card"]["verified"] is True
    terminal = await pair_business_device(client, owner)
    body["event_id"] = str(uuid.uuid4())
    body["digital_card_token"] = mint(sess, card, int(time.time()))
    r = await client.post("/api/v1/device/events", headers=terminal["headers"], json=body)
    assert r.status_code == 200 and r.json()["digital_card"]["expired"] is True, r.text


async def test_cards_accept_every_font_pair(client: AsyncClient) -> None:
    from app.services.personal import FONTS

    user = await register_personal(client)
    card = await primary(client, user["headers"])
    for font in FONTS:
        r = await client.patch(f"/api/v1/personal/cards/{card['id']}", json={"design": {"font": font}},
                               headers=user["headers"])
        assert r.status_code == 200, (font, r.text)
