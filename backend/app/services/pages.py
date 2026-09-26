"""Part 6: built-in pages — page/section validation, extended theme, page templates, forms and .ics.

Everything that ends up on a public page is validated here: links are http(s)/mailto/tel only, images are served from
our `/media` or over https, and every section type has a strict shape (unknown keys rejected for the new types).
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.errors import AppError, validation_error
from app.services.actions import SOCIAL_PLATFORMS

logger = logging.getLogger("app.page_templates")

PAGE_TYPES = ("custom", "menu", "product", "links", "offer", "event", "gallery", "form", "wifi")
ALL_PROFILE_TYPES = ("business", "employee", *PAGE_TYPES)
LEGACY_SECTIONS = {"about", "contact", "hours", "social", "services", "gallery", "buttons", "text"}
SECTION_TYPES = LEGACY_SECTIONS | {"menu", "products", "links", "offer", "event", "wifi", "form"}
MENU_BADGES = ("vegetarian", "vegan", "spicy", "gluten_free", "new", "popular", "sold_out")
LINK_ICONS = (*SOCIAL_PLATFORMS, "link", "phone", "email", "map", "whatsapp")
FORM_FIELD_TYPES = ("text", "textarea", "email", "phone", "rating", "select", "checkbox")
HEADERS = ("cover", "logo", "minimal", "banner")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
SECTION_ID_RE = re.compile(r"^[a-z0-9_-]{1,40}$")
TEMPLATE_ID_RE = re.compile(r"^[a-z0-9_]{2,64}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9 ()\-.]{4,24}$")
PLACEHOLDER_RE = re.compile(r"\{\{\s*business\.(name|phone|email|website|address)\s*\}\}")
MAX_BUSINESS_TEMPLATES = 50


# ── URL rules ────────────────────────────────────────────────────────────────
def _clean(value: str) -> str:
    return "".join(ch for ch in value if ch.isprintable() and not ch.isspace())


def check_link(value: Any, field: str, required: bool = False) -> str | None:
    """http(s), mailto: or tel: only."""
    if value in (None, ""):
        if required:
            raise validation_error(field, "a link is required")
        return None
    if not isinstance(value, str) or len(value) > 2048:
        raise validation_error(field, "must be a URL string (≤ 2048 chars)")
    v = value.strip()
    low = _clean(v).lower()
    if low.startswith(("https://", "http://")) and len(low) > 10 and not any(c.isspace() for c in v):
        return v
    if low.startswith("mailto:") and EMAIL_RE.match(low[7:].split("?")[0]):
        return v
    if low.startswith("tel:") and PHONE_RE.match(low[4:]):
        return v
    raise validation_error(field, "must be an http(s), mailto: or tel: URL")


def check_image(value: Any, field: str) -> str | None:
    """Images: our own `/media/...` (relative or on PUBLIC_API_URL) or any https URL."""
    if value in (None, ""):
        return None
    if not isinstance(value, str) or len(value) > 2048 or any(c.isspace() or not c.isprintable() for c in value):
        raise validation_error(field, "must be an image URL")
    own = f"{settings.public_api_url}/media/"
    if value.startswith("/media/") and ".." not in value:
        return value
    if value.startswith(own) and ".." not in value:
        return value
    if value.lower().startswith("https://") and len(value) > 10:
        return value
    raise validation_error(field, "images must be uploaded (/media/...) or served over https")


# ── small typed readers ──────────────────────────────────────────────────────
def _s(obj: dict[str, Any], key: str, field: str, max_len: int, required: bool = False) -> str | None:
    value = obj.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise validation_error(f"{field}.{key}", "is required")
        return None
    if not isinstance(value, str) or len(value) > max_len:
        raise validation_error(f"{field}.{key}", f"a string of at most {max_len} characters")
    return value.strip()


def _b(obj: dict[str, Any], key: str, field: str) -> bool | None:
    value = obj.get(key)
    if value is None:
        return None
    if not isinstance(value, bool):
        raise validation_error(f"{field}.{key}", "must be true or false")
    return value


def _price(obj: dict[str, Any], key: str, field: str) -> Any:
    value = obj.get(key)
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not (isinstance(value, (int, float)) and value >= 0
                                       or isinstance(value, str) and len(value) <= 24):
        raise validation_error(f"{field}.{key}", "a non-negative number or short text")
    return value


def _keys(obj: Any, allowed: set[str], field: str) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise validation_error(field, "must be an object")
    extra = set(obj) - allowed
    if extra:
        raise validation_error(f"{field}.{sorted(extra)[0]}", "unknown property")
    return obj


def _list(obj: dict[str, Any], key: str, field: str, max_items: int, required: bool = False) -> list[Any]:
    value = obj.get(key)
    if value is None:
        if required:
            raise validation_error(f"{field}.{key}", "is required")
        return []
    if not isinstance(value, list) or len(value) > max_items:
        raise validation_error(f"{field}.{key}", f"a list of at most {max_items} items")
    return value


def _cta(obj: dict[str, Any], field: str) -> dict[str, str] | None:
    cta = obj.get("cta")
    if cta is None:
        return None
    _keys(cta, {"label", "url"}, f"{field}.cta")
    return {"label": _s(cta, "label", f"{field}.cta", 60, True),  # type: ignore[dict-item]
            "url": check_link(cta.get("url"), f"{field}.cta.url", True)}  # type: ignore[dict-item]


def _datetime(value: Any, field: str, required: bool = False, date_ok: bool = False) -> str | None:
    if value in (None, ""):
        if required:
            raise validation_error(field, "is required")
        return None
    try:
        if not isinstance(value, str) or len(value) > 40:
            raise ValueError
        if date_ok and len(value) == 10:
            date.fromisoformat(value)
        else:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise validation_error(field, "ISO-8601 date/time expected") from None
    return value


def _compact(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


# ── sections ─────────────────────────────────────────────────────────────────
def validate_section(section: Any, field: str) -> dict[str, Any]:
    """Validates one section (buttons' actions are validated by the caller, which has a DB session)."""
    if not isinstance(section, dict) or section.get("type") not in SECTION_TYPES:
        raise validation_error(f"{field}.type", f"one of: {', '.join(sorted(SECTION_TYPES))}")
    t = section["type"]
    sid = section.get("id")
    if sid is not None and not (isinstance(sid, str) and SECTION_ID_RE.match(sid)):
        raise validation_error(f"{field}.id", "1-40 chars of a-z, 0-9, _ and -")
    base = {"type": t, "id": sid}
    if t == "menu":
        _keys(section, {"type", "id", "title", "currency", "show_images", "categories"}, field)
        cats = []
        for i, cat in enumerate(_list(section, "categories", field, 40)):
            cf = f"{field}.categories.{i}"
            _keys(cat, {"name", "description", "items"}, cf)
            items = []
            for j, item in enumerate(_list(cat, "items", cf, 100)):
                itf = f"{cf}.items.{j}"
                _keys(item, {"name", "description", "price", "image_url", "badges", "variants", "tags"}, itf)
                badges = _list(item, "badges", itf, len(MENU_BADGES))
                if any(b not in MENU_BADGES for b in badges):
                    raise validation_error(f"{itf}.badges", f"badges: {', '.join(MENU_BADGES)}")
                variants = []
                for k, var in enumerate(_list(item, "variants", itf, 10)):
                    vf = f"{itf}.variants.{k}"
                    _keys(var, {"label", "price"}, vf)
                    variants.append(_compact({"label": _s(var, "label", vf, 60, True), "price": _price(var, "price", vf)}))
                tags = [str(x)[:30] for x in _list(item, "tags", itf, 10)]
                items.append(_compact({
                    "name": _s(item, "name", itf, 120, True), "description": _s(item, "description", itf, 500),
                    "price": _price(item, "price", itf), "image_url": check_image(item.get("image_url"), f"{itf}.image_url"),
                    "badges": badges or None, "variants": variants or None, "tags": tags or None}))
            cats.append(_compact({"name": _s(cat, "name", cf, 80, True), "description": _s(cat, "description", cf, 300),
                                  "items": items}))
        cur = _s(section, "currency", field, 8)
        return _compact({**base, "title": _s(section, "title", field, 120), "currency": cur,
                         "show_images": _b(section, "show_images", field), "categories": cats})
    if t == "products":
        _keys(section, {"type", "id", "title", "items"}, field)
        items = []
        for j, item in enumerate(_list(section, "items", field, 100)):
            itf = f"{field}.items.{j}"
            _keys(item, {"title", "name", "description", "price", "compare_at_price", "image_url", "badge", "cta",
                         "in_stock"}, itf)
            if not (item.get("title") or item.get("name")):
                raise validation_error(f"{itf}.name", "is required")
            items.append(_compact({
                "title": _s(item, "title", itf, 120), "name": _s(item, "name", itf, 120),
                "description": _s(item, "description", itf, 1000), "price": _price(item, "price", itf),
                "compare_at_price": _price(item, "compare_at_price", itf),
                "image_url": check_image(item.get("image_url"), f"{itf}.image_url"),
                "badge": _s(item, "badge", itf, 30), "cta": _cta(item, itf), "in_stock": _b(item, "in_stock", itf)}))
        return _compact({**base, "title": _s(section, "title", field, 120), "items": items})
    if t == "links":
        _keys(section, {"type", "id", "title", "items"}, field)
        items = []
        for j, item in enumerate(_list(section, "items", field, 50, True)):
            itf = f"{field}.items.{j}"
            _keys(item, {"label", "url", "icon", "highlight"}, itf)
            icon = item.get("icon")
            if icon is not None and icon not in LINK_ICONS:
                raise validation_error(f"{itf}.icon", f"one of: {', '.join(LINK_ICONS)}")
            items.append(_compact({"label": _s(item, "label", itf, 80, True), "url": check_link(item.get("url"), f"{itf}.url", True),
                                   "icon": icon, "highlight": _b(item, "highlight", itf)}))
        return _compact({**base, "title": _s(section, "title", field, 120), "items": items})
    if t == "offer":
        _keys(section, {"type", "id", "title", "description", "code", "discount_label", "valid_until", "terms", "cta"}, field)
        return _compact({**base, "title": _s(section, "title", field, 120, True),
                         "description": _s(section, "description", field, 2000), "code": _s(section, "code", field, 40),
                         "discount_label": _s(section, "discount_label", field, 40),
                         "valid_until": _datetime(section.get("valid_until"), f"{field}.valid_until", date_ok=True),
                         "terms": _s(section, "terms", field, 2000), "cta": _cta(section, field)})
    if t == "event":
        _keys(section, {"type", "id", "title", "starts_at", "ends_at", "venue", "address", "map_query", "description",
                        "cta"}, field)
        starts = _datetime(section.get("starts_at"), f"{field}.starts_at", required=True)
        ends = _datetime(section.get("ends_at"), f"{field}.ends_at")
        if ends and _as_utc(ends) < _as_utc(starts):  # type: ignore[arg-type]
            raise validation_error(f"{field}.ends_at", "must not be before starts_at")
        return _compact({**base, "title": _s(section, "title", field, 120, True), "starts_at": starts, "ends_at": ends,
                         "venue": _s(section, "venue", field, 120), "address": _s(section, "address", field, 300),
                         "map_query": _s(section, "map_query", field, 300),
                         "description": _s(section, "description", field, 4000), "cta": _cta(section, field)})
    if t == "wifi":
        _keys(section, {"type", "id", "title", "ssid", "password", "security", "hidden"}, field)
        security = section.get("security", "WPA")
        if security not in ("WPA", "WEP", "nopass"):
            raise validation_error(f"{field}.security", "one of WPA, WEP, nopass")
        password = _s(section, "password", field, 63)
        if security != "nopass" and not password:
            raise validation_error(f"{field}.password", "required unless security is nopass")
        return _compact({**base, "title": _s(section, "title", field, 120), "ssid": _s(section, "ssid", field, 32, True),
                         "password": password if security != "nopass" else None, "security": security,
                         "hidden": _b(section, "hidden", field)})
    if t == "form":
        _keys(section, {"type", "id", "title", "description", "fields", "submit_label", "success_message"}, field)
        fields, ids = [], set()
        raw_fields = _list(section, "fields", field, 12, True)
        if not raw_fields:
            raise validation_error(f"{field}.fields", "at least one field")
        for j, f in enumerate(raw_fields):
            ff = f"{field}.fields.{j}"
            _keys(f, {"id", "label", "type", "required", "options", "placeholder"}, ff)
            fid = f.get("id")
            if not (isinstance(fid, str) and SECTION_ID_RE.match(fid)) or fid in ids:
                raise validation_error(f"{ff}.id", "a unique short id (a-z, 0-9, _ and -)")
            ids.add(fid)
            ftype = f.get("type")
            if ftype not in FORM_FIELD_TYPES:
                raise validation_error(f"{ff}.type", f"one of: {', '.join(FORM_FIELD_TYPES)}")
            options = None
            if ftype == "select":
                options = _list(f, "options", ff, 20, True)
                if not options or not all(isinstance(o, str) and 0 < len(o) <= 80 for o in options):
                    raise validation_error(f"{ff}.options", "1-20 options of at most 80 characters")
            elif f.get("options") is not None:
                raise validation_error(f"{ff}.options", "only select fields have options")
            fields.append(_compact({"id": fid, "label": _s(f, "label", ff, 120, True), "type": ftype,
                                    "required": bool(_b(f, "required", ff)), "options": options,
                                    "placeholder": _s(f, "placeholder", ff, 120)}))
        return _compact({**base, "title": _s(section, "title", field, 120, True),
                         "description": _s(section, "description", field, 1000), "fields": fields,
                         "submit_label": _s(section, "submit_label", field, 40) or "Send",
                         "success_message": _s(section, "success_message", field, 300) or "Thank you!"})
    # legacy section types: free-form content, but every link/image must be safe
    _check_legacy_links(section, field)
    return {k: v for k, v in section.items() if not (k == "id" and v is None)}


_LEGACY_LINK_KEYS = {"url", "href", "link", "website"}
_LEGACY_IMAGE_KEYS = {"src", "image", "images", "image_url", "photo_url", "cover_image_url"}


def _check_legacy_links(value: Any, field: str, kind: str | None = None) -> None:
    from app.services.url_validation import unsafe_url_scheme

    if isinstance(value, dict):
        for key, item in value.items():
            k = "image" if key in _LEGACY_IMAGE_KEYS else "link" if (key in _LEGACY_LINK_KEYS or key.endswith("_url")) \
                else None
            _check_legacy_links(item, f"{field}.{key}", k)
    elif isinstance(value, list):
        for j, item in enumerate(value):
            _check_legacy_links(item, f"{field}.{j}", kind)
    elif kind and isinstance(value, str) and value.strip():
        if unsafe_url_scheme(value):
            raise validation_error(field, "must be an http(s), mailto: or tel: URL")
        if kind == "image" and "://" in value:
            check_image(value, field)


def assign_section_ids(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    for i, s in enumerate(sections):
        sid = s.get("id")
        if sid is None:
            sid = f"{s['type'][:10]}-{secrets.token_hex(3)}"
            while sid in seen:
                sid = f"{s['type'][:10]}-{secrets.token_hex(3)}"
            s["id"] = sid
        elif sid in seen:
            raise validation_error(f"body.sections.{i}.id", "section ids must be unique within the page")
        seen.add(sid)
    return sections


def validate_theme(theme: Any, field: str = "body.theme") -> dict[str, Any]:
    from app.services.card_design_v2 import FONT_PAIRS

    if not isinstance(theme, dict):
        raise validation_error(field, "must be an object")
    out: dict[str, Any] = {}
    for key, value in theme.items():
        f = f"{field}.{key}"
        if value is None:
            continue
        if key in ("accent", "background", "surface", "text"):
            if not (isinstance(value, str) and HEX_RE.match(value)):
                raise validation_error(f, "hex colour like #b91c1c")
        elif key == "font":
            if value not in {p["id"] for p in FONT_PAIRS}:
                raise validation_error(f, "a font-pair id from /personal/design-presets")
        elif key == "layout":
            if not (isinstance(value, str) and SECTION_ID_RE.match(value)):
                raise validation_error(f, "a layout id")
        elif key == "header":
            if value not in HEADERS:
                raise validation_error(f, f"one of: {', '.join(HEADERS)}")
        elif key in ("cover_image_url", "logo_url"):
            value = check_image(value, f)
        elif key == "corner_radius":
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 32:
                raise validation_error(f, "integer 0-32")
        elif key == "dark":
            if not isinstance(value, bool):
                raise validation_error(f, "true or false")
        else:
            raise validation_error(f, "unknown theme property")
        out[key] = value
    return out


# ── placeholders ─────────────────────────────────────────────────────────────
def business_values(business: Any) -> dict[str, str]:
    return {"name": business.name or "", "phone": business.phone or "", "email": business.email or "",
            "website": business.website or "", "address": business.address or ""}


SAMPLE_VALUES = {"name": "Sample Business", "phone": "+250788000000", "email": "hello@example.com",
                 "website": "https://example.com", "address": "KN 4 Ave, Kigali"}


def substitute(value: Any, values: dict[str, str]) -> Any:
    """Replaces {{business.*}} placeholders; list items whose url/link ends up empty are dropped."""
    if isinstance(value, str):
        return PLACEHOLDER_RE.sub(lambda m: values.get(m.group(1), ""), value)
    if isinstance(value, list):
        out = [substitute(v, values) for v in value]
        return [v for v in out if not (isinstance(v, dict) and "url" in v and v["url"] == "")]
    if isinstance(value, dict):
        out = {k: substitute(v, values) for k, v in value.items()}
        if isinstance(out.get("cta"), dict) and not out["cta"].get("url"):
            out.pop("cta")
        for key in ("url", "website", "email", "phone", "address"):
            if out.get(key) == "" and isinstance(value.get(key), str) and PLACEHOLDER_RE.search(value[key]):
                out.pop(key)
        return out
    return value


# ── page templates ───────────────────────────────────────────────────────────
def validate_template_data(raw: Any) -> tuple[dict[str, Any] | None, list[str]]:
    """Structural validation of a system template (sections are checked with sample placeholder values)."""
    if not isinstance(raw, dict):
        return None, ["template must be an object"]
    errors: list[str] = []
    extra = set(raw) - {"id", "page_type", "name", "description", "category", "preview_image_url", "theme", "sections"}
    if extra:
        errors.append(f"unknown keys: {', '.join(sorted(extra))}")
    tid = raw.get("id")
    if not (isinstance(tid, str) and TEMPLATE_ID_RE.match(tid)):
        errors.append("id must be 2-64 chars of a-z, 0-9, _")
    if raw.get("page_type") not in PAGE_TYPES:
        errors.append(f"page_type must be one of {', '.join(PAGE_TYPES)}")
    for key, limit, required in (("name", 80, True), ("description", 300, False), ("category", 40, False)):
        value = raw.get(key)
        if (value is None and required) or (value is not None and not (isinstance(value, str) and len(value) <= limit)):
            errors.append(f"{key} must be a string of at most {limit} characters")
    sections = raw.get("sections", [])
    if not isinstance(sections, list) or len(sections) > 50:
        errors.append("sections must be a list of at most 50")
        sections = []
    try:
        check_image(raw.get("preview_image_url"), "preview_image_url")
        validate_theme(substitute(raw.get("theme") or {}, SAMPLE_VALUES), "theme")
        clean = [validate_section(substitute(s, SAMPLE_VALUES), f"sections.{i}") for i, s in enumerate(sections)]
        assign_section_ids(clean)
    except AppError as exc:
        detail = (exc.details or [{}])[0] if isinstance(exc.details, list) else {}
        errors.append(f"{detail.get('field', '')}: {detail.get('message', exc.message)}")
    if errors:
        return None, errors
    ids = [s.get("id") for s in sections if isinstance(s, dict) and s.get("id")]
    if len(ids) != len(set(ids)):
        return None, ["section ids must be unique"]
    return {"id": tid, "page_type": raw["page_type"], "name": raw["name"], "description": raw.get("description") or "",
            "category": raw.get("category"), "preview_image_url": raw.get("preview_image_url"),
            "theme": dict(raw.get("theme") or {}), "sections": list(sections)}, []


def load_system_templates(path: str | Path | None = None) -> list[dict[str, Any]]:
    file = Path(path or settings.PAGE_TEMPLATES_PATH)
    if not file.is_absolute():
        file = Path(__file__).resolve().parents[2] / file
    if not file.exists():
        return []
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.error("Page templates file %s is unreadable: %s", file, exc)
        return []
    items = data.get("templates") if isinstance(data, dict) else data
    if not isinstance(items, list):
        logger.error("Page templates file %s must contain a list", file)
        return []
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(items):
        template, errors = validate_template_data(raw)
        if template is not None and template["id"] in {t["id"] for t in out}:
            template, errors = None, ["duplicate id"]
        if template is None:
            label = raw.get("id") if isinstance(raw, dict) else f"#{i}"
            logger.error("Skipping invalid page template %s: %s", label, "; ".join(errors[:10]))
            continue
        out.append(template)
    return out


def template_out(t: Any) -> dict[str, Any]:
    return {"id": t.id, "scope": t.scope, "business_id": str(t.business_id) if t.business_id else None,
            "page_type": t.page_type, "name": t.name, "description": t.description, "category": t.category,
            "preview_image_url": t.preview_image_url, "theme": dict(t.theme or {}), "sections": list(t.sections or []),
            "created_at": t.created_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if t.created_at else None}


def new_business_template_id() -> str:
    return f"b_{uuid.uuid4().hex}"


# ── forms ────────────────────────────────────────────────────────────────────
def find_section(profile: Any, section_id: str, type_: str) -> dict[str, Any] | None:
    return next((s for s in (profile.sections or []) if isinstance(s, dict) and s.get("id") == section_id
                 and s.get("type") == type_), None)


def validate_answers(form: dict[str, Any], answers: Any) -> tuple[dict[str, Any], float | None]:
    """Returns (clean answers, mean rating or None)."""
    if not isinstance(answers, dict):
        raise validation_error("body.answers", "must be an object {field_id: value}")
    fields = {f["id"]: f for f in form.get("fields") or []}
    unknown = set(answers) - set(fields)
    if unknown:
        raise validation_error(f"body.answers.{sorted(unknown)[0]}", "unknown field")
    out: dict[str, Any] = {}
    ratings: list[int] = []
    for fid, f in fields.items():
        value = answers.get(fid)
        where = f"body.answers.{fid}"
        empty = value is None or (isinstance(value, str) and not value.strip()) or (f["type"] == "checkbox" and value is False)
        if empty:
            if f.get("required"):
                raise validation_error(where, f"{f['label']} is required")
            continue
        t = f["type"]
        if t in ("text", "textarea", "email", "phone", "select"):
            if not isinstance(value, str):
                raise validation_error(where, "must be text")
            value = value.strip()
            limit = 5000 if t == "textarea" else 500
            if len(value) > limit:
                raise validation_error(where, f"at most {limit} characters")
            if t == "email" and not EMAIL_RE.match(value):
                raise validation_error(where, "invalid email address")
            if t == "phone" and not PHONE_RE.match(value):
                raise validation_error(where, "invalid phone number")
            if t == "select" and value not in (f.get("options") or []):
                raise validation_error(where, "not one of the options")
        elif t == "rating":
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
                raise validation_error(where, "a whole number 1-5")
            ratings.append(value)
        elif t == "checkbox":
            if not isinstance(value, bool):
                raise validation_error(where, "true or false")
        out[fid] = value
    return out, (sum(ratings) / len(ratings) if ratings else None)


def csv_cell(value: Any) -> str:
    text = "" if value is None else (("yes" if value else "no") if isinstance(value, bool) else str(value))
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


# ── .ics ─────────────────────────────────────────────────────────────────────
def _as_utc(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _ics_text(value: str | None) -> str:
    return ((value or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n"))


def _fold(line: str) -> str:
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, cur = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(cur) + len(b) > (75 if not parts else 74):
            parts.append(cur.decode("utf-8"))
            cur = b""
        cur += b
    parts.append(cur.decode("utf-8"))
    return "\r\n ".join(parts)


def event_ics(event: dict[str, Any], *, uid: str, url: str, organizer: str) -> str:
    fmt = "%Y%m%dT%H%M%SZ"
    start = _as_utc(event["starts_at"])
    end = _as_utc(event["ends_at"]) if event.get("ends_at") else None
    location = ", ".join(x for x in (event.get("venue"), event.get("address")) if x)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nexventures//nexTap//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", "BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{datetime.now(UTC).strftime(fmt)}",
             f"DTSTART:{start.strftime(fmt)}"]
    if end:
        lines.append(f"DTEND:{end.strftime(fmt)}")
    lines.append(f"SUMMARY:{_ics_text(event.get('title'))}")
    if location:
        lines.append(f"LOCATION:{_ics_text(location)}")
    if event.get("description"):
        lines.append(f"DESCRIPTION:{_ics_text(event['description'])}")
    lines += [f"URL:{url}", f"X-ORGANIZER-NAME:{_ics_text(organizer)}", "END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"
