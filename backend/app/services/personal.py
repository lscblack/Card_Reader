"""Part 4 core: templates, card defaults/validation, visibility filtering, sessions and token resolution."""

from __future__ import annotations

import base64
import re
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, validation_error
from app.core.security import decrypt_secret, encrypt_secret, random_urlsafe, sha256_hex
from app.models import CardTemplate, DigitalCard, PersonalActivity, PersonalSession, Plan, Subscription, User
from app.services import card_tokens
from app.services.business import media_url, slugify

SESSION_PREFIX = "nfcs_"
LOGIN_CODE_PREFIX = "nfcl_"
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# ── Templates (data-driven, identical on web + mobile) ─────────────────────
TEMPLATES: list[dict[str, Any]] = [
    {"id": "classic", "name": "Classic", "layout": "left", "premium": False,
     "description": "Timeless left-aligned layout with a round photo and a clean divider.",
     "default_design": {"primary": "#111827", "background": "#FFFFFF", "text": "#111827", "accent": "#B91C1C",
                        "background_style": "solid", "pattern": None, "font": "serif", "corner_radius": 12,
                        "show_qr": True},
     "supports": {"photo": True, "cover": False, "logo": True}},
    {"id": "modern", "name": "Modern", "layout": "centered", "premium": False,
     "description": "Centred photo, bold name and a row of quick actions.",
     "default_design": {"primary": "#B91C1C", "background": "#0B0B0F", "text": "#F4F4F5", "accent": "#E5484D",
                        "background_style": "solid", "pattern": None, "font": "sans", "corner_radius": 20,
                        "show_qr": True},
     "supports": {"photo": True, "cover": False, "logo": True}},
    {"id": "minimal", "name": "Minimal", "layout": "centered", "premium": False,
     "description": "Lots of white space, thin typography, no distractions.",
     "default_design": {"primary": "#18181B", "background": "#FAFAFA", "text": "#18181B", "accent": "#52525B",
                        "background_style": "solid", "pattern": None, "font": "sans", "corner_radius": 4,
                        "show_qr": False},
     "supports": {"photo": True, "cover": False, "logo": False}},
    {"id": "gradient", "name": "Gradient", "layout": "centered", "premium": False,
     "description": "Vibrant two-tone gradient background with white text.",
     "default_design": {"primary": "#7F1D1D", "background": "#DC2626", "text": "#FFFFFF", "accent": "#FCA5A5",
                        "background_style": "gradient", "pattern": None, "font": "display", "corner_radius": 24,
                        "show_qr": True},
     "supports": {"photo": True, "cover": False, "logo": True}},
    {"id": "glass", "name": "Glass", "layout": "banner", "premium": True,
     "description": "Frosted-glass panel over your cover image.",
     "default_design": {"primary": "#1F2937", "background": "#111827", "text": "#F9FAFB", "accent": "#F87171",
                        "background_style": "glass", "pattern": None, "font": "sans", "corner_radius": 28,
                        "show_qr": True},
     "supports": {"photo": True, "cover": True, "logo": True}},
    {"id": "bold", "name": "Bold", "layout": "left", "premium": False,
     "description": "Big type and strong accent colour for maximum impact.",
     "default_design": {"primary": "#B91C1C", "background": "#FEF2F2", "text": "#450A0A", "accent": "#B91C1C",
                        "background_style": "pattern", "pattern": "dots", "font": "display", "corner_radius": 8,
                        "show_qr": True},
     "supports": {"photo": True, "cover": False, "logo": True}},
    {"id": "split", "name": "Split", "layout": "split", "premium": False,
     "description": "Coloured panel with photo and name, details on the other side.",
     "default_design": {"primary": "#991B1B", "background": "#FFFFFF", "text": "#1F2937", "accent": "#B91C1C",
                        "background_style": "solid", "pattern": None, "font": "sans", "corner_radius": 16,
                        "show_qr": True},
     "supports": {"photo": True, "cover": False, "logo": True}},
    {"id": "photo_hero", "name": "Photo hero", "layout": "hero_photo", "premium": True,
     "description": "Full-width photo with a gradient overlay and your name on top.",
     "default_design": {"primary": "#000000", "background": "#0A0A0A", "text": "#FFFFFF", "accent": "#EF4444",
                        "background_style": "solid", "pattern": None, "font": "sans", "corner_radius": 20,
                        "show_qr": True},
     "supports": {"photo": True, "cover": True, "logo": False}},
    {"id": "business", "name": "Business card", "layout": "compact", "premium": False,
     "description": "Classic 1.75:1 business-card ratio with logo and QR code.",
     "default_design": {"primary": "#111827", "background": "#FFFFFF", "text": "#111827", "accent": "#B91C1C",
                        "background_style": "solid", "pattern": None, "font": "sans", "corner_radius": 10,
                        "show_qr": True},
     "supports": {"photo": False, "cover": False, "logo": True}},
]

DEFAULT_TEMPLATE = "modern"
FIELD_KEYS = ("full_name", "pronouns", "headline", "job_title", "company", "department", "bio", "phones", "emails",
              "websites", "address", "socials", "custom_links")
VISIBILITY_KEYS = (*FIELD_KEYS, "photo", "cover", "logo")
DEFAULT_VISIBILITY: dict[str, str] = {
    "full_name": "public", "pronouns": "public", "headline": "public", "job_title": "public", "company": "public",
    "department": "public", "bio": "public", "photo": "public", "cover": "public", "logo": "public",
    "socials": "public", "websites": "public", "custom_links": "public",
    "phones": "contacts", "emails": "contacts", "address": "hidden",
}
DEFAULT_SHARE = {"auto_exchange": True, "web_page_enabled": True, "lead_capture_enabled": True,
                 "nfc_sharing_enabled": True}
LEVELS = {"public": 0, "contacts": 1, "hidden": 2}
BACKGROUND_STYLES = ("solid", "gradient", "glass", "pattern")
FONTS = ("sans", "serif", "mono", "display")


def template_out(t: CardTemplate) -> dict[str, Any]:
    return {"id": t.id, "name": t.name, "description": t.description, "layout": t.layout,
            "default_design": t.default_design, "supports": t.supports, "premium": t.premium}


# ── Validation ─────────────────────────────────────────────────────────────
def _str(value: Any, field: str, max_len: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise validation_error(f"body.fields.{field}", "must be a string")
    value = value.strip()
    if len(value) > max_len:
        raise validation_error(f"body.fields.{field}", f"at most {max_len} characters")
    return value or None


def _url(value: Any, field: str) -> str:
    if not isinstance(value, str) or not re.match(r"^https?://[^\s]{3,}$", value.strip()) or len(value) > 500:
        raise validation_error(field, "a valid http(s) URL is required")
    return value.strip()


def validate_fields(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    limits = {"full_name": 120, "pronouns": 30, "headline": 160, "job_title": 120, "company": 120,
              "department": 120, "bio": 1000, "address": 300}
    for key, value in data.items():
        if key not in FIELD_KEYS:
            raise validation_error(f"body.fields.{key}", "unknown field")
        if key in limits:
            out[key] = _str(value, key, limits[key])
            continue
        items = value or []
        if not isinstance(items, list) or len(items) > 10:
            raise validation_error(f"body.fields.{key}", "a list of at most 10 items")
        clean = []
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                raise validation_error(f"body.fields.{key}.{i}", "must be an object")
            if key in ("phones", "emails"):
                val = _str(item.get("value"), f"{key}.{i}.value", 160)
                if not val:
                    raise validation_error(f"body.fields.{key}.{i}.value", "value is required")
                if key == "emails" and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", val):
                    raise validation_error(f"body.fields.{key}.{i}.value", "invalid email")
                if key == "phones" and not re.match(r"^\+?[0-9][0-9 ()\-.]{3,24}$", val):
                    raise validation_error(f"body.fields.{key}.{i}.value", "invalid phone number")
                clean.append({"label": _str(item.get("label"), f"{key}.{i}.label", 40) or "", "value": val})
            elif key == "socials":
                platform = _str(item.get("platform"), f"{key}.{i}.platform", 32)
                if not platform:
                    raise validation_error(f"body.fields.{key}.{i}.platform", "platform is required")
                clean.append({"platform": platform.lower(), "url": _url(item.get("url"), f"body.fields.{key}.{i}.url")})
            else:  # websites, custom_links
                clean.append({"label": _str(item.get("label"), f"{key}.{i}.label", 60) or "",
                              "url": _url(item.get("url"), f"body.fields.{key}.{i}.url")})
        out[key] = clean
    return out


def validate_design(data: dict[str, Any], base: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in data.items():
        if key in ("primary", "background", "text", "accent"):
            if not isinstance(value, str) or not HEX_RE.match(value):
                raise validation_error(f"body.design.{key}", "hex colour like #B91C1C")
            out[key] = value.upper()
        elif key == "background_style":
            if value not in BACKGROUND_STYLES:
                raise validation_error("body.design.background_style", f"one of {', '.join(BACKGROUND_STYLES)}")
            out[key] = value
        elif key == "pattern":
            if value is not None and (not isinstance(value, str) or not re.match(r"^[a-z0-9_-]{1,32}$", value)):
                raise validation_error("body.design.pattern", "short identifier or null")
            out[key] = value
        elif key == "font":
            if value not in FONTS:
                raise validation_error("body.design.font", f"one of {', '.join(FONTS)}")
            out[key] = value
        elif key == "corner_radius":
            if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 32:
                raise validation_error("body.design.corner_radius", "integer 0-32")
            out[key] = value
        elif key == "show_qr":
            if not isinstance(value, bool):
                raise validation_error("body.design.show_qr", "boolean")
            out[key] = value
        else:
            raise validation_error(f"body.design.{key}", "unknown design property")
    return out


def validate_visibility(data: dict[str, Any], base: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in data.items():
        if key not in VISIBILITY_KEYS:
            raise validation_error(f"body.visibility.{key}", "unknown field")
        if value not in LEVELS:
            raise validation_error(f"body.visibility.{key}", "public, contacts or hidden")
        out[key] = value
    return out


def validate_share(data: dict[str, Any], base: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in data.items():
        if key not in DEFAULT_SHARE or not isinstance(value, bool):
            raise validation_error(f"body.share_settings.{key}", "unknown setting or not a boolean")
        out[key] = value
    return out


# ── Status & visibility filtering ──────────────────────────────────────────
def effective_status(card: DigitalCard) -> str:
    if card.deleted_at is not None or card.status != "active":
        return "inactive"
    if card.business_id is not None:
        b = card.business
        if b is None or b.deleted_at is not None or b.status != "active":
            return "inactive"
        if card.employee_id is not None and (card.employee is None or card.employee.status != "active"):
            return "inactive"
    return "active"


def filtered_fields(card: DigitalCard, level: str) -> dict[str, Any]:
    """Fields visible at `level` ("public" or "contacts")."""
    vis = {**DEFAULT_VISIBILITY, **(card.visibility or {})}
    allowed = LEVELS[level]
    out: dict[str, Any] = {}
    for key in FIELD_KEYS:
        if LEVELS.get(vis.get(key, "hidden"), 2) <= allowed:
            value = (card.fields or {}).get(key)
            if value not in (None, "", []):
                out[key] = value
    return out


def image_urls(card: DigitalCard, level: str) -> dict[str, str | None]:
    vis = {**DEFAULT_VISIBILITY, **(card.visibility or {})}
    allowed = LEVELS[level]
    return {f"{kind}_url": (media_url(getattr(card, f"{kind}_path")) if LEVELS[vis.get(kind, "public")] <= allowed
                             else None) for kind in ("photo", "cover", "logo")}


def public_url(card: DigitalCard) -> str:
    return f"{settings.public_web_url}/p/{card.slug}"


def business_brief(card: DigitalCard) -> dict[str, Any] | None:
    if card.business is None:
        return None
    return {"name": card.business.name, "logo_url": media_url(card.business.logo_path),
            "verified": card.business.verified}


def snapshot(card: DigitalCard, level: str) -> dict[str, Any]:
    """What a contact (or a terminal/public viewer) is allowed to see of `card`."""
    layout = card.template.layout if card.__dict__.get("template") is not None else None
    return {"card_id": str(card.id), "share_id": str(card.share_id), "template_id": card.template_id,
            "layout": layout, "design": dict(card.design or {}), "fields": filtered_fields(card, level), **image_urls(card, level),
            "public_url": public_url(card), "business": business_brief(card)}


def card_out(card: DigitalCard) -> dict[str, Any]:
    link = None
    if card.business_id is not None:
        link = {"business_id": str(card.business_id), "business_name": card.business.name if card.business else None,
                "employee_id": str(card.employee_id) if card.employee_id else None,
                "locked_fields": list(card.locked_fields or []), "template_locked": card.template_locked,
                "status": effective_status(card)}
    iso = lambda d: d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None  # noqa: E731
    return {
        "id": str(card.id), "share_id": str(card.share_id), "label": card.label, "is_primary": card.is_primary,
        "status": effective_status(card), "slug": card.slug, "public_url": public_url(card),
        "template_id": card.template_id, "design": dict(card.design or {}),
        "photo_url": media_url(card.photo_path), "cover_url": media_url(card.cover_path),
        "logo_url": media_url(card.logo_path),
        "fields": {k: (card.fields or {}).get(k, [] if k in ("phones", "emails", "websites", "socials", "custom_links")
                                               else None) for k in FIELD_KEYS},
        "visibility": {**DEFAULT_VISIBILITY, **(card.visibility or {})},
        "share_settings": {**DEFAULT_SHARE, **(card.share_settings or {})},
        "business_link": link,
        "stats": {"views": card.views, "nfc_taps": card.nfc_taps, "exchanges": card.exchanges, "leads": card.leads},
        "created_at": iso(card.created_at), "updated_at": iso(card.updated_at),
    }


def share_setting(card: DigitalCard, key: str) -> bool:
    return bool({**DEFAULT_SHARE, **(card.share_settings or {})}[key])


# ── Cards: creation helpers ────────────────────────────────────────────────
async def unique_card_slug(session: AsyncSession, name: str) -> str:
    base = (slugify(name, 60) or "card")[:60]
    for _ in range(20):
        candidate = f"{base}-{secrets.token_hex(2)}"
        if not (await session.execute(select(DigitalCard.id).where(DigitalCard.slug == candidate))).first():
            return candidate
    return f"{base}-{secrets.token_hex(6)}"


async def get_template(session: AsyncSession, template_id: str | None) -> CardTemplate:
    t = await session.get(CardTemplate, template_id or DEFAULT_TEMPLATE)
    if t is None:
        raise validation_error("body.template_id", "unknown template (see /personal/templates)")
    return t


async def new_card(session: AsyncSession, user: User, *, label: str = "Personal", template_id: str | None = None,
                   fields: dict[str, Any] | None = None, design: dict[str, Any] | None = None,
                   visibility: dict[str, Any] | None = None, share: dict[str, Any] | None = None) -> DigitalCard:
    template = await get_template(session, template_id)
    fields = fields if fields is not None else {"full_name": user.full_name,
                                                "emails": [{"label": "Email", "value": user.email}]}
    has_primary = (await session.execute(select(DigitalCard.id).where(
        DigitalCard.user_id == user.id, DigitalCard.is_primary.is_(True), DigitalCard.deleted_at.is_(None)))).first()
    defaults = (user.preferences or {}).get("personal_defaults") or {}
    if visibility is None and isinstance(defaults.get("visibility"), dict):
        visibility = {k: v for k, v in defaults["visibility"].items() if k in VISIBILITY_KEYS and v in LEVELS}
    if share is None and isinstance(defaults.get("share_settings"), dict):
        share = {k: v for k, v in defaults["share_settings"].items() if k in DEFAULT_SHARE and isinstance(v, bool)}
    card = DigitalCard(
        user_id=user.id, share_id=uuid.uuid4(), label=label, is_primary=not has_primary, status="active",
        slug=await unique_card_slug(session, fields.get("full_name") or user.full_name or "card"),
        template_id=template.id, design=validate_design(design or {}, template.default_design),
        fields=validate_fields(fields), visibility=validate_visibility(visibility or {}, DEFAULT_VISIBILITY),
        share_settings=validate_share(share or {}, DEFAULT_SHARE), locked_fields=[], template_locked=False,
        views=0, nfc_taps=0, exchanges=0, leads=0,
    )
    card.template = template
    session.add(card)
    await session.flush()
    return card


# ── Plans ──────────────────────────────────────────────────────────────────
async def personal_plan(session: AsyncSession, user_id: uuid.UUID) -> Plan:
    plan = (await session.execute(select(Plan).join(Subscription, Subscription.plan_id == Plan.id)
                                  .where(Subscription.user_id == user_id))).scalar_one_or_none()
    if plan is None or plan.audience != "personal":
        plan = (await session.execute(select(Plan).where(Plan.code == "personal_free"))).scalar_one()
    return plan


async def ensure_card_limit(session: AsyncSession, user_id: uuid.UUID) -> None:
    plan = await personal_plan(session, user_id)
    if plan.max_cards is None:
        return
    count = (await session.execute(select(func.count()).select_from(DigitalCard).where(
        DigitalCard.user_id == user_id, DigitalCard.deleted_at.is_(None),
        DigitalCard.business_id.is_(None)))).scalar_one()
    if count >= plan.max_cards:
        raise AppError(402, "plan_limit_reached", f"Your {plan.name} plan allows {plan.max_cards} cards.",
                       {"limit": "cards", "max": plan.max_cards, "current": int(count)})


async def contacts_room(session: AsyncSession, user_id: uuid.UUID) -> tuple[bool, Plan]:
    from app.models import Contact

    plan = await personal_plan(session, user_id)
    if plan.max_contacts is None:
        return True, plan
    count = (await session.execute(select(func.count()).select_from(Contact).where(
        Contact.owner_id == user_id))).scalar_one()
    return count < plan.max_contacts, plan


async def ensure_contact_limit(session: AsyncSession, user_id: uuid.UUID) -> None:
    ok, plan = await contacts_room(session, user_id)
    if not ok:
        raise AppError(402, "plan_limit_reached", f"Your {plan.name} plan allows {plan.max_contacts} contacts.",
                       {"limit": "contacts", "max": plan.max_contacts})


# ── Sessions & share keys ──────────────────────────────────────────────────
async def create_session(session: AsyncSession, user: User, device: dict[str, Any], internal: bool = False
                         ) -> tuple[PersonalSession, str, str]:
    """Returns (row, session_token, share secret base64url)."""
    token = SESSION_PREFIX + random_urlsafe(48)
    secret = secrets.token_bytes(32)
    secret_b64 = card_tokens.b64url_encode(secret)
    key_id = 0
    for _ in range(20):
        key_id = secrets.randbelow(2**32 - 2) + 1
        if not (await session.execute(select(PersonalSession.id).where(PersonalSession.key_id == key_id))).first():
            break
    row = PersonalSession(
        user_id=user.id, token_hash=sha256_hex(token), key_id=key_id, share_secret_encrypted=encrypt_secret(secret_b64),
        device_name=(device.get("device_name") or "Phone")[:100], platform=(device.get("platform") or "android")[:32],
        model=device.get("model"), os_version=device.get("os_version"), app_version=device.get("app_version"),
        installation_id=device.get("installation_id"), internal=internal, last_seen_at=datetime.now(UTC),
    )
    session.add(row)
    await session.flush()
    return row, token, secret_b64


def session_secret(row: PersonalSession) -> bytes:
    return base64.urlsafe_b64decode(decrypt_secret(row.share_secret_encrypted) + "==")


def session_out(row: PersonalSession) -> dict[str, Any]:
    iso = lambda d: d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None  # noqa: E731
    return {"id": str(row.id), "device_name": row.device_name, "platform": row.platform, "model": row.model,
            "app_version": row.app_version, "created_at": iso(row.created_at), "last_seen_at": iso(row.last_seen_at),
            "revoked_at": iso(row.revoked_at)}


async def server_key(session: AsyncSession, user: User) -> PersonalSession:
    """Server-side share key used for web-generated exchange QR codes (one internal session per user)."""
    row = (await session.execute(select(PersonalSession).where(
        PersonalSession.user_id == user.id, PersonalSession.internal.is_(True),
        PersonalSession.revoked_at.is_(None)))).scalar_one_or_none()
    if row is None:
        row, _, _ = await create_session(session, user, {"device_name": "Web QR", "platform": "web"}, internal=True)
    return row


def mint_token(row: PersonalSession, card: DigitalCard, issued_at: int | None = None) -> str:
    return card_tokens.encode(session_secret(row), card.share_id, row.key_id, issued_at or int(time.time()))


# ── Token resolution ───────────────────────────────────────────────────────
@dataclass
class Resolved:
    card: DigitalCard
    session: PersonalSession
    owner: User


async def resolve_token(session: AsyncSession, token: str, *, now: int | None = None,
                        require: str = "nfc_sharing_enabled") -> Resolved:
    """Validates a share token (§3). Raises AppError invalid_card_token / card_token_expired / card_unavailable."""
    try:
        parsed = card_tokens.parse(token)
    except card_tokens.TokenError as exc:
        raise AppError(422, "invalid_card_token", str(exc)) from None
    card = (await session.execute(select(DigitalCard).where(DigitalCard.share_id == parsed.share_id,
                                                            DigitalCard.deleted_at.is_(None)))).scalar_one_or_none()
    if card is None:
        raise AppError(422, "invalid_card_token", "unknown card (the link may have been rotated)")
    row = (await session.execute(select(PersonalSession).where(PersonalSession.key_id == parsed.key_id))
           ).scalar_one_or_none()
    if row is None or row.revoked_at is not None or row.user_id != card.user_id:
        raise AppError(422, "invalid_card_token", "unknown or revoked share key")
    if not card_tokens.verify_mac(parsed, session_secret(row)):
        raise AppError(422, "invalid_card_token", "bad signature")
    try:
        card_tokens.check_time(parsed, now if now is not None else int(time.time()))
    except card_tokens.TokenError as exc:
        status = 410 if exc.code == "card_token_expired" else 422
        raise AppError(status, exc.code, str(exc)) from None
    owner = await session.get(User, card.user_id)
    if owner is None or not owner.is_active or effective_status(card) != "active" or \
            (require and not share_setting(card, require)):
        raise AppError(404, "card_unavailable", "This card isn't available")
    return Resolved(card, row, owner)


def record_activity(session: AsyncSession, user_id: uuid.UUID, card_id: uuid.UUID | None, type_: str, title: str,
                    source: str | None = None, counterpart_name: str | None = None, **detail: Any) -> None:
    if counterpart_name:
        detail["counterpart_name"] = counterpart_name
    session.add(PersonalActivity(user_id=user_id, card_id=card_id, type=type_, source=source, title=title[:200],
                                 detail=detail))


def login_code() -> str:
    return LOGIN_CODE_PREFIX + random_urlsafe(32)
