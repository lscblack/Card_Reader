"""Card actions (Part 2 §B5): definitions served as data, validation and resolution."""

from __future__ import annotations

import html
import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.models import Application, Business, Card, Employee, Profile
from app.services.business import business_public_url

E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9 ()\-.]{4,24}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# USSD / short codes: starts with * or #, digits and * in between, usually ends with # (e.g. *182*8*1*123#).
USSD_RE = re.compile(r"^[*#][0-9*#]{1,40}$")
MAX_USSD_OPTIONS = 6
SOCIAL_PLATFORMS = ["instagram", "facebook", "x", "linkedin", "tiktok", "youtube", "github", "snapchat",
                    "pinterest", "telegram", "whatsapp", "website", "other"]


def _f(name: str, type_: str, required: bool = False, label: str | None = None, **extra: Any) -> dict[str, Any]:
    return {"name": name, "type": type_, "required": required, "label": label or name.replace("_", " ").title(), **extra}


ACTION_TYPES: list[dict[str, Any]] = [
    {"type": "website", "label": "Open website", "result": "redirect",
     "description": "Redirects to a web page (https; http only in development).",
     "fields": [_f("url", "url", True, "URL")]},
    {"type": "custom_url", "label": "Custom URL", "result": "redirect",
     "description": "Redirects to any https URL (deep links, forms, booking pages…).",
     "fields": [_f("url", "url", True, "URL")]},
    {"type": "business_profile", "label": "Business profile", "result": "redirect",
     "description": "Opens the business's public profile page.", "fields": []},
    {"type": "employee_profile", "label": "Employee profile", "result": "redirect",
     "description": "Opens an employee's public profile (defaults to the card's assignee).",
     "fields": [_f("employee_id", "employee", False, "Employee")]},
    {"type": "profile", "label": "Custom page", "result": "redirect",
     "description": "Opens one of the business's custom, menu or product pages.",
     "fields": [_f("profile_id", "profile", True, "Page")]},
    {"type": "share_contact", "label": "Save contact (vCard)", "result": "vcard",
     "description": "Downloads a contact card for the employee (or the business).",
     "fields": [_f("employee_id", "employee", False, "Employee")]},
    {"type": "whatsapp", "label": "WhatsApp chat", "result": "redirect",
     "description": "Opens a WhatsApp chat with an optional pre-filled message.",
     "fields": [_f("phone", "phone", True, "Phone (E.164, e.g. +250788123456)"), _f("message", "text")]},
    {"type": "phone_call", "label": "Phone call", "result": "page",
     "description": "Shows a page with a call button (browsers may block direct tel: redirects).",
     "fields": [_f("phone", "phone", True, "Phone")]},
    {"type": "ussd", "label": "Dial USSD code", "result": "page",
     "description": "Opens the phone dialer with a USSD code filled in (mobile money, balance, menus). Android dials "
                    "straight away; iPhones get a copy button. Add more codes to let the customer choose.",
     "fields": [_f("code", "string", True, "USSD code", placeholder="*182*8*1*123#"),
                _f("button_label", "string", False, "Button label", placeholder="e.g. Pay with MoMo"),
                _f("more_codes", "text", False, "More codes to choose from",
                   placeholder="Airtel Money = *500#\nCheck balance = *182*6*1#",
                   help="Optional. One per line as “Name = code”; the customer picks which one to dial.")]},
    {"type": "email", "label": "Send email", "result": "page",
     "description": "Opens the visitor's email app with a pre-filled message.",
     "fields": [_f("to", "email", True, "To"), _f("subject", "string"), _f("body", "text")]},
    {"type": "maps", "label": "Open in maps", "result": "redirect",
     "description": "Opens Google Maps at an address/search query or coordinates (one of).",
     "fields": [_f("query", "string", False, "Address or search"), _f("lat", "number", False, "Latitude"),
                _f("lng", "number", False, "Longitude")]},
    {"type": "social", "label": "Social profile", "result": "redirect",
     "description": "Opens a social media profile.",
     "fields": [_f("platform", "select", True, "Platform", options=SOCIAL_PLATFORMS), _f("url", "url", True, "URL")]},
    {"type": "digital_menu", "label": "Digital menu", "result": "redirect",
     "description": "Opens a menu page (profile) or an external menu URL (one of).",
     "fields": [_f("profile_id", "profile", False, "Menu page", page_type="menu"), _f("url", "url", False, "URL")]},
    {"type": "product_info", "label": "Product information", "result": "redirect",
     "description": "Opens a product page (profile) or an external product URL (one of).",
     "fields": [_f("profile_id", "profile", False, "Product page", page_type="product"),
                _f("url", "url", False, "URL")]},
    {"type": "wifi", "label": "Wi-Fi access", "result": "page",
     "description": "Shows the network name, a copy-password button and a Wi-Fi QR code. The nexTap app "
                    "can also write a native Wi-Fi record to the tag. Either the network details, or `profile_id` "
                    "of a Wi-Fi page.",
     "fields": [_f("ssid", "string", True, "Network name (SSID)"), _f("password", "string", False, "Password"),
                _f("security", "select", True, "Security", options=["WPA", "WEP", "nopass"]),
                _f("hidden", "boolean", False, "Hidden network"),
                _f("profile_id", "profile", False, "Wi-Fi page (instead of the details)", page_type="wifi")]},
    # Part 6: built-in pages
    {"type": "links_page", "label": "Links page", "result": "redirect",
     "description": "Opens a link-in-bio page built in nexTap.",
     "fields": [_f("profile_id", "profile", True, "Links page", page_type="links")]},
    {"type": "offer_page", "label": "Offer / coupon", "result": "redirect",
     "description": "Opens an offer page built in nexTap, or an external offer URL (one of).",
     "fields": [_f("profile_id", "profile", False, "Offer page", page_type="offer"), _f("url", "url", False, "URL")]},
    {"type": "event_page", "label": "Event", "result": "redirect",
     "description": "Opens an event page (with Add to calendar), or an external event URL (one of).",
     "fields": [_f("profile_id", "profile", False, "Event page", page_type="event"), _f("url", "url", False, "URL")]},
    {"type": "feedback_form", "label": "Feedback form", "result": "redirect",
     "description": "Opens a form page (feedback, contact or booking request); responses appear in the dashboard.",
     "fields": [_f("profile_id", "profile", True, "Form page", page_type="form")]},
    {"type": "gallery_page", "label": "Gallery", "result": "redirect",
     "description": "Opens a photo gallery / portfolio page.",
     "fields": [_f("profile_id", "profile", True, "Gallery page", page_type="gallery")]},
    {"type": "developer_webhook", "label": "Developer webhook", "result": "webhook",
     "description": "Sends a signed `card.tapped` event to one of the business's applications, then runs "
                    "`then` (or opens the business profile).",
     "fields": [_f("application_id", "application", True, "Application"),
                _f("then", "action", False, "Then (optional follow-up action)")]},
]
ACTION_TYPE_MAP = {t["type"]: t for t in ACTION_TYPES}
# action type → (page type it opens, whether a plain url is accepted instead)
PAGE_ACTIONS = {"links_page": ("links", False), "offer_page": ("offer", True), "event_page": ("event", True),
                "feedback_form": ("form", False), "gallery_page": ("gallery", False)}


class _Errors:
    def __init__(self, prefix: str) -> None:
        self.prefix = prefix
        self.items: list[dict[str, str]] = []

    def add(self, name: str, message: str) -> None:
        self.items.append({"field": f"{self.prefix}.{name}", "message": message})


def _valid_url(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
        return None
    value = value.strip()
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme not in ("https", "http") or not parts.hostname or parts.username or parts.password:
        return None
    if parts.scheme == "http" and not settings.is_development:
        return None
    return value


async def validate_action(
    session: AsyncSession, business_id: uuid.UUID, action: Any, prefix: str = "body.action",
    allow_webhook: bool = True,
) -> dict[str, Any] | None:
    """Returns the normalised action or raises 422 invalid_action_config."""
    if action is None:
        return None
    errors = _Errors(prefix)
    normalized = await _validate(session, business_id, action, errors, allow_webhook)
    if errors.items:
        raise AppError(422, "invalid_action_config", "The action configuration is invalid", errors.items)
    return normalized


async def _validate(session: AsyncSession, business_id: uuid.UUID, action: Any, errors: _Errors,
                    allow_webhook: bool) -> dict[str, Any] | None:
    if not isinstance(action, dict):
        errors.add("type", "action must be an object {type, config, label?}")
        return None
    type_ = action.get("type")
    if type_ not in ACTION_TYPE_MAP:
        errors.add("type", f"unknown action type; one of: {', '.join(ACTION_TYPE_MAP)}")
        return None
    if type_ == "developer_webhook" and not allow_webhook:
        errors.add("type", "developer_webhook cannot be nested")
        return None
    config = action.get("config") or {}
    if not isinstance(config, dict):
        errors.add("config", "config must be an object")
        return None
    label = action.get("label")
    if label is not None and (not isinstance(label, str) or len(label) > 80):
        errors.add("label", "label must be a string of at most 80 characters")
    out: dict[str, Any] = {}
    cfg = _Errors(f"{errors.prefix}.config")

    async def owned(model: type, key: str, page_type: str | None = None) -> uuid.UUID | None:
        raw = config.get(key)
        if raw in (None, ""):
            return None
        try:
            ident = uuid.UUID(str(raw))
        except ValueError:
            cfg.add(key, "must be a UUID")
            return None
        stmt = select(model.id).where(model.id == ident, model.business_id == business_id)
        if hasattr(model, "deleted_at"):
            stmt = stmt.where(model.deleted_at.is_(None))
        if not (await session.execute(stmt)).first():
            cfg.add(key, "not found in this business")
            return None
        if page_type is not None:
            ptype = (await session.execute(select(model.type).where(model.id == ident))).scalar()
            if ptype != page_type:
                cfg.add(key, f"must be a {page_type} page")
                return None
        return ident

    if type_ in ("website", "custom_url"):
        url = _valid_url(config.get("url"))
        if not url:
            cfg.add("url", "a valid https URL is required")
        out["url"] = url
    elif type_ == "business_profile":
        pass
    elif type_ in ("employee_profile", "share_contact"):
        eid = await owned(Employee, "employee_id")
        if eid:
            out["employee_id"] = str(eid)
    elif type_ == "profile":
        pid = await owned(Profile, "profile_id")
        if not pid and "profile_id" not in [e["field"].rsplit(".", 1)[-1] for e in cfg.items]:
            cfg.add("profile_id", "profile_id is required")
        out["profile_id"] = str(pid) if pid else None
    elif type_ == "whatsapp":
        phone = str(config.get("phone") or "").replace(" ", "")
        if not E164_RE.match(phone):
            cfg.add("phone", "phone must be in E.164 format, e.g. +250788123456")
        out["phone"] = phone
        if config.get("message"):
            out["message"] = str(config["message"])[:1000]
    elif type_ == "phone_call":
        phone = str(config.get("phone") or "").strip()
        if not PHONE_RE.match(phone):
            cfg.add("phone", "a valid phone number is required")
        out["phone"] = phone
    elif type_ == "ussd":
        code = _clean_ussd(config.get("code"))
        if not USSD_RE.match(code):
            cfg.add("code", "a USSD code like *182*8*1*123# (digits, * and #)")
        out["code"] = code
        if config.get("button_label"):
            out["button_label"] = str(config["button_label"]).strip()[:40]
        extra = str(config.get("more_codes") or "").strip()
        if extra:
            lines = [ln for ln in extra.splitlines() if ln.strip()]
            if len(lines) > MAX_USSD_OPTIONS - 1:
                cfg.add("more_codes", f"at most {MAX_USSD_OPTIONS - 1} extra codes")
            for ln in lines:
                name, _, value = ln.rpartition("=")
                if not USSD_RE.match(_clean_ussd(value)) or not name.strip():
                    cfg.add("more_codes", f"“{ln.strip()[:60]}” should look like “Name = *123#”")
                    break
            out["more_codes"] = "\n".join(ln.strip() for ln in lines)[:1000]
    elif type_ == "email":
        to = str(config.get("to") or "").strip()
        if not EMAIL_RE.match(to):
            cfg.add("to", "a valid email address is required")
        out["to"] = to
        for key in ("subject", "body"):
            if config.get(key):
                out[key] = str(config[key])[:2000]
    elif type_ == "maps":
        query = str(config.get("query") or "").strip()
        lat, lng = config.get("lat"), config.get("lng")
        if query:
            out["query"] = query[:300]
        elif lat is not None and lng is not None:
            try:
                flat, flng = float(lat), float(lng)
                if not (-90 <= flat <= 90 and -180 <= flng <= 180):
                    raise ValueError
                out["lat"], out["lng"] = flat, flng
            except (TypeError, ValueError):
                cfg.add("lat", "lat/lng must be valid coordinates")
        else:
            cfg.add("query", "provide either query or lat and lng")
    elif type_ == "social":
        platform = str(config.get("platform") or "").lower()
        if platform not in SOCIAL_PLATFORMS:
            cfg.add("platform", f"one of: {', '.join(SOCIAL_PLATFORMS)}")
        url = _valid_url(config.get("url"))
        if not url:
            cfg.add("url", "a valid https URL is required")
        out.update(platform=platform, url=url)
    elif type_ in ("digital_menu", "product_info"):
        pid = await owned(Profile, "profile_id")
        url = _valid_url(config.get("url")) if config.get("url") else None
        if config.get("url") and not url:
            cfg.add("url", "a valid https URL is required")
        if not pid and not url and not cfg.items:
            cfg.add("profile_id", "provide either profile_id or url")
        if pid:
            out["profile_id"] = str(pid)
        elif url:
            out["url"] = url
    elif type_ in PAGE_ACTIONS:  # Part 6: built-in pages (+ url fallback where allowed)
        page_type, url_ok = PAGE_ACTIONS[type_]
        pid = await owned(Profile, "profile_id", page_type)
        url = _valid_url(config.get("url")) if (url_ok and config.get("url")) else None
        if url_ok and config.get("url") and not url:
            cfg.add("url", "a valid https URL is required")
        if not url_ok and config.get("url"):
            cfg.add("url", "this action opens a page: use profile_id")
        if not pid and not url and not cfg.items:
            cfg.add("profile_id", f"pick a {page_type} page" + (" or give a url" if url_ok else ""))
        if pid:
            out["profile_id"] = str(pid)
        elif url:
            out["url"] = url
    elif type_ == "wifi" and config.get("profile_id"):
        pid = await owned(Profile, "profile_id", "wifi")
        if pid:
            out["profile_id"] = str(pid)
    elif type_ == "wifi":
        ssid = str(config.get("ssid") or "")
        security = str(config.get("security") or "WPA")
        password = config.get("password")
        if not 1 <= len(ssid) <= 32:
            cfg.add("ssid", "ssid must be 1-32 characters")
        if security not in ("WPA", "WEP", "nopass"):
            cfg.add("security", "one of WPA, WEP, nopass")
        if security != "nopass" and not password:
            cfg.add("password", "password is required unless security is nopass")
        if password is not None and len(str(password)) > 63:
            cfg.add("password", "password must be at most 63 characters")
        out.update(ssid=ssid, security=security, hidden=bool(config.get("hidden", False)))
        if security != "nopass" and password:
            out["password"] = str(password)
    elif type_ == "developer_webhook":
        aid = await owned(Application, "application_id")
        if not aid and not cfg.items:
            cfg.add("application_id", "application_id is required")
        out["application_id"] = str(aid) if aid else None
        then = config.get("then")
        if then is not None:
            nested = _Errors(f"{cfg.prefix}.then")
            out["then"] = await _validate(session, business_id, then, nested, allow_webhook=False)
            cfg.items.extend(nested.items)
    errors.items.extend(cfg.items)
    result: dict[str, Any] = {"type": type_, "config": out}
    if label:
        result["label"] = label
    return result


# ── Resolution ─────────────────────────────────────────────────────────────
@dataclass
class Resolution:
    action_type: str
    kind: str  # redirect | page | vcard | webhook
    url: str | None = None
    label: str | None = None
    vcard: str | None = None
    page_html: str | None = None
    webhook_application_id: uuid.UUID | None = None
    then: Resolution | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def default_action() -> dict[str, Any]:
    return {"type": "business_profile", "config": {}}


def effective_action(card: Card | None, business: Business) -> dict[str, Any]:
    if card is not None and card.action:
        return card.action
    default = (business.settings or {}).get("default_card_action")
    return default or default_action()


async def _profile(session: AsyncSession, business_id: uuid.UUID, pid: Any) -> Profile | None:
    if not pid:
        return None
    try:
        ident = uuid.UUID(str(pid))
    except ValueError:
        return None
    return (await session.execute(
        select(Profile).where(Profile.id == ident, Profile.business_id == business_id, Profile.deleted_at.is_(None))
    )).scalar_one_or_none()


async def _employee(session: AsyncSession, business_id: uuid.UUID, eid: Any, card: Card | None) -> Employee | None:
    if eid:
        try:
            ident = uuid.UUID(str(eid))
        except ValueError:
            return None
        return (await session.execute(
            select(Employee).where(Employee.id == ident, Employee.business_id == business_id)
        )).scalar_one_or_none()
    if card is not None and card.employee_id:
        return card.employee
    return None


def profile_url(business: Business, profile: Profile) -> str:
    if profile.type == "business":
        return business_public_url(business)
    return business_public_url(business, profile.slug)


async def employee_profile_slug(session: AsyncSession, employee: Employee) -> str:
    slug = (await session.execute(
        select(Profile.slug).where(Profile.employee_id == employee.id, Profile.deleted_at.is_(None)).limit(1)
    )).scalar_one_or_none()
    return slug or employee.slug


def _vcard_escape(value: str | None) -> str:
    # A bare CR is a line break for many vCard parsers: fold every newline flavour into an escaped "\n" so a
    # user-controlled value can't inject extra vCard properties.
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def vcard_for(business: Business, employee: Employee | None = None) -> str:
    lines = ["BEGIN:VCARD", "VERSION:3.0"]
    if employee is not None:
        lines.append(f"N:{_vcard_escape(employee.last_name)};{_vcard_escape(employee.first_name)};;;")
        lines.append(f"FN:{_vcard_escape(employee.full_name)}")
        lines.append(f"ORG:{_vcard_escape(business.name)}")
        if employee.position:
            lines.append(f"TITLE:{_vcard_escape(employee.position)}")
        if employee.phone:
            lines.append(f"TEL;TYPE=CELL:{_vcard_escape(employee.phone)}")
        if employee.email:
            lines.append(f"EMAIL;TYPE=WORK:{_vcard_escape(employee.email)}")
        lines.append(f"URL:{business_public_url(business, employee.slug)}")
    else:
        lines.append(f"N:{_vcard_escape(business.name)};;;;")
        lines.append(f"FN:{_vcard_escape(business.name)}")
        lines.append(f"ORG:{_vcard_escape(business.name)}")
        if business.phone:
            lines.append(f"TEL;TYPE=WORK:{_vcard_escape(business.phone)}")
        if business.email:
            lines.append(f"EMAIL;TYPE=WORK:{_vcard_escape(business.email)}")
        if business.address:
            lines.append(f"ADR;TYPE=WORK:;;{_vcard_escape(business.address)};;;;")
        lines.append(f"URL:{business.website or business_public_url(business)}")
    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"


def _clean_ussd(value: Any) -> str:
    return re.sub(r"[\s-]", "", str(value or ""))


def ussd_options(cfg: dict[str, Any]) -> list[tuple[str, str]]:
    """[(label, code)]: the main code first, then the "Name = code" lines."""
    opts = [(cfg.get("button_label") or "Dial", _clean_ussd(cfg.get("code")))]
    for ln in str(cfg.get("more_codes") or "").splitlines():
        name, _, value = ln.rpartition("=")
        if name.strip() and USSD_RE.match(_clean_ussd(value)):
            opts.append((name.strip(), _clean_ussd(value)))
    return [o for o in opts if o[1]][:MAX_USSD_OPTIONS]


def ussd_href(code: str) -> str:
    # "#" must be escaped or the dialer sees a URL fragment and drops it.
    return "tel:" + code.replace("#", "%23")


def _ussd_page(business: Business, options: list[tuple[str, str]]) -> str:
    name = html.escape(business.name)
    single = len(options) == 1
    buttons = "".join(
        f"<div class=o><a class=b href='{html.escape(ussd_href(code))}'>{html.escape(label)}</a>"
        f"<button type=button class=k data-c='{html.escape(code)}'><span>{html.escape(code)}</span> · Copy</button></div>"
        for label, code in options
    )
    # Android opens the dialer from a tel: link; iOS refuses USSD characters in links, so offer copy + a hint.
    script = (
        "<script>document.querySelectorAll('.k').forEach(function(b){b.onclick=function(){var c=b.dataset.c;"
        "(navigator.clipboard?navigator.clipboard.writeText(c):Promise.reject()).then(function(){b.lastChild.textContent=' · Copied'},"
        "function(){prompt('Copy this code',c)})}});"
        + (f"if(/Android/i.test(navigator.userAgent))location.href={json.dumps(ussd_href(options[0][1]))};" if single else "")
        + "if(/iPhone|iPad|iPod/i.test(navigator.userAgent))document.getElementById('ios').hidden=false;</script>"
    )
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>Dial · {name}</title><style>body{{font-family:system-ui,sans-serif;background:#0f0a0a;color:#fff;"
        "display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}"
        ".c{text-align:center;padding:24px;width:100%;max-width:380px}.o{margin-top:18px}"
        ".b{display:block;padding:15px 24px;border-radius:999px;background:#b91c1c;color:#fff;text-decoration:none;font-size:18px;font-weight:600}"
        ".k{margin-top:8px;background:none;border:0;color:#d4d4d8;font-size:15px;cursor:pointer}.k span{font-family:ui-monospace,monospace;color:#fff}"
        "p{color:#d4d4d8}#ios{font-size:14px;color:#a1a1aa;margin-top:22px}</style></head>"
        f"<body><div class=c><h1>{name}</h1><p>{'Tap to dial' if single else 'Choose what to dial'}</p>{buttons}"
        "<p id=ios hidden>On iPhone, copy the code, open the Phone app and paste it in the keypad.</p></div>"
        f"{script}</body></html>"
    )


def _call_page(business: Business, phone: str) -> str:
    tel = "tel:" + re.sub(r"[^0-9+]", "", phone)
    return _button_page(business, phone, tel, "Call now")


def _button_page(business: Business, detail: str, href: str, cta: str, auto: bool = False) -> str:
    name = html.escape(business.name)
    script = f"<script>location.href={json.dumps(href)}</script>" if auto else ""
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(cta)} · {name}</title><style>body{{font-family:system-ui,sans-serif;background:#0f0a0a;color:#fff;"
        "display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}}"
        ".c{text-align:center;padding:24px}a{display:inline-block;margin-top:16px;padding:14px 28px;"
        "border-radius:999px;background:#b91c1c;color:#fff;text-decoration:none;font-size:18px}</style></head>"
        f"<body><div class=c><h1>{name}</h1><p>{html.escape(detail)}</p>"
        f"<a href='{html.escape(href)}'>{html.escape(cta)}</a></div>{script}</body></html>"
    )


async def resolve(
    session: AsyncSession, business: Business, card: Card | None, action: dict[str, Any] | None = None,
) -> Resolution:
    action = action or effective_action(card, business)
    type_ = action.get("type", "business_profile")
    cfg = action.get("config") or {}
    label = action.get("label")
    web = settings.public_web_url

    if type_ in ("website", "custom_url", "social"):
        return Resolution(type_, "redirect", cfg.get("url"), label)
    if type_ == "business_profile":
        return Resolution(type_, "redirect", business_public_url(business), label)
    if type_ == "employee_profile":
        emp = await _employee(session, business.id, cfg.get("employee_id"), card)
        if emp is None:
            return Resolution(type_, "redirect", business_public_url(business), label)
        return Resolution(type_, "redirect", business_public_url(business, await employee_profile_slug(session, emp)),
                          label)
    if type_ in ("profile", "digital_menu", "product_info"):
        prof = await _profile(session, business.id, cfg.get("profile_id"))
        if prof is not None:
            return Resolution(type_, "redirect", profile_url(business, prof), label)
        return Resolution(type_, "redirect", cfg.get("url") or business_public_url(business), label)
    if type_ == "share_contact":
        emp = await _employee(session, business.id, cfg.get("employee_id"), card)
        if emp is not None and emp.status == "active":
            url = f"{settings.public_api_url}/api/v1/public/b/{business.slug}/{await employee_profile_slug(session, emp)}/vcard"
            return Resolution(type_, "vcard", url, label, vcard=vcard_for(business, emp))
        return Resolution(type_, "vcard", f"{settings.public_api_url}/api/v1/public/b/{business.slug}/vcard", label,
                          vcard=vcard_for(business))
    if type_ == "whatsapp":
        digits = re.sub(r"[^0-9]", "", cfg.get("phone") or "")
        url = f"https://wa.me/{digits}"
        if cfg.get("message"):
            url += "?" + urlencode({"text": cfg["message"]})
        return Resolution(type_, "redirect", url, label)
    if type_ == "phone_call":
        phone = cfg.get("phone") or ""
        return Resolution(type_, "page", "tel:" + re.sub(r"[^0-9+]", "", phone), label,
                          page_html=_call_page(business, phone))
    if type_ == "ussd":
        options = ussd_options(cfg)
        return Resolution(type_, "page", ussd_href(options[0][1]) if options else None, label,
                          page_html=_ussd_page(business, options))
    if type_ == "email":
        params = {k: cfg[k] for k in ("subject", "body") if cfg.get(k)}
        url = "mailto:" + quote(cfg.get("to") or "", safe="@")
        if params:
            url += "?" + urlencode(params, quote_via=quote)
        # A page (not a 302): several browsers/in-app webviews ignore redirects to mailto:.
        return Resolution(type_, "page", url, label,
                          page_html=_button_page(business, cfg.get("to") or "", url, "Send email", auto=True))
    if type_ == "maps":
        query = cfg.get("query") or (f"{cfg.get('lat')},{cfg.get('lng')}" if cfg.get("lat") is not None else "")
        return Resolution(type_, "redirect", "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": query}),
                          label)
    if type_ in PAGE_ACTIONS:
        prof = await _profile(session, business.id, cfg.get("profile_id"))
        if prof is not None:
            return Resolution(type_, "redirect", profile_url(business, prof), label)
        return Resolution(type_, "redirect", cfg.get("url") or business_public_url(business), label)
    if type_ == "wifi" and cfg.get("profile_id"):
        prof = await _profile(session, business.id, cfg.get("profile_id"))
        return Resolution(type_, "redirect", profile_url(business, prof) if prof else business_public_url(business),
                          label)
    if type_ == "wifi":
        url = f"{web}/w/{card.public_code}" if card is not None else None
        return Resolution(type_, "page", url, label, extra={"wifi": cfg})
    if type_ == "developer_webhook":
        then_action = cfg.get("then") or default_action()
        then = await resolve(session, business, card, then_action)
        app_id = uuid.UUID(cfg["application_id"]) if cfg.get("application_id") else None
        return Resolution(type_, "webhook", then.url, label, webhook_application_id=app_id, then=then)
    return Resolution("business_profile", "redirect", business_public_url(business), label)


def wifi_qr_string(cfg: dict[str, Any]) -> str:
    def esc(v: str) -> str:
        return re.sub(r'([\\;,:"])', r"\\\1", v)

    sec = cfg.get("security", "WPA")
    parts = [f"T:{'nopass' if sec == 'nopass' else sec}", f"S:{esc(cfg.get('ssid', ''))}"]
    if sec != "nopass" and cfg.get("password"):
        parts.append(f"P:{esc(cfg['password'])}")
    if cfg.get("hidden"):
        parts.append("H:true")
    return "WIFI:" + ";".join(parts) + ";;"
