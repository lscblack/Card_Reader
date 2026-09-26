"""Branding (Part 3 §1): admin-controlled product name, logos, fonts and accent colours.

Stored in `platform_settings` under key "branding"; cached ≤ 30 s per process (refreshed immediately on change).
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, validation_error

KEY = "branding"
CACHE_TTL_SECONDS = 30.0
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# Backgrounds the dashboard/emails render accents on (light and dark themes).
THEME_BG_LIGHT = "#FFFFFF"
THEME_BG_DARK = "#0B0B0F"
MIN_CONTRAST = 3.0

FONTS: list[dict[str, Any]] = [
    {"family": "Inter", "category": "sans", "google": True, "weights": [400, 500, 600, 700, 800]},
    {"family": "Manrope", "category": "sans", "google": True, "weights": [400, 500, 600, 700, 800]},
    {"family": "Plus Jakarta Sans", "category": "sans", "google": True, "weights": [400, 500, 600, 700, 800]},
    {"family": "DM Sans", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Outfit", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Sora", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Space Grotesk", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "IBM Plex Sans", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Poppins", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Figtree", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Lexend", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Urbanist", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Work Sans", "category": "sans", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Nunito Sans", "category": "sans", "google": True, "weights": [400, 600, 700]},
    {"family": "Playfair Display", "category": "serif", "google": True, "weights": [400, 600, 700]},
    {"family": "Fraunces", "category": "serif", "google": True, "weights": [400, 600, 700]},
    {"family": "Merriweather", "category": "serif", "google": True, "weights": [400, 700]},
    {"family": "Lora", "category": "serif", "google": True, "weights": [400, 500, 600, 700]},
    {"family": "Bricolage Grotesque", "category": "display", "google": True, "weights": [400, 600, 700, 800]},
    {"family": "Syne", "category": "display", "google": True, "weights": [400, 600, 700, 800]},
    {"family": "JetBrains Mono", "category": "mono", "google": True, "weights": [400, 500, 700]},
    {"family": "IBM Plex Mono", "category": "mono", "google": True, "weights": [400, 500, 700]},
    {"family": "Fira Code", "category": "mono", "google": True, "weights": [400, 500, 700]},
    {"family": "Source Code Pro", "category": "mono", "google": True, "weights": [400, 500, 700]},
]
FONT_MAP = {f["family"]: f for f in FONTS}

DEFAULTS: dict[str, Any] = {
    "product_name": "nexTap",
    "tagline": "NFC detection → Card ID → Secure delivery.",
    "logo_path": None,
    "logo_dark_path": None,
    "favicon_path": None,
    "fonts": {"heading": "Inter", "body": "Inter", "mono": "JetBrains Mono"},
    "theme": {"accent_light": "#B91C1C", "accent_dark": "#E5484D", "default_mode": "dark"},
    "support_email": None,
    "company_address": None,
    "social_links": [],
    "updated_at": None,
}
VARIANTS = {"logo": "logo_path", "logo_dark": "logo_dark_path", "favicon": "favicon_path"}

_stored: dict[str, Any] = {}
_loaded_at = float("-inf")
_lock: asyncio.Lock | None = None


# ── Colour maths (WCAG 2.x) ─────────────────────────────────────────────────
def _channel(c: float) -> float:
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_color: str) -> float:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast_ratio(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


# ── Storage / cache ────────────────────────────────────────────────────────
def merged(stored: dict[str, Any] | None = None) -> dict[str, Any]:
    data = copy.deepcopy(DEFAULTS)
    src = _stored if stored is None else stored
    for key, value in src.items():
        if key in ("fonts", "theme") and isinstance(value, dict):
            data[key].update(value)
        elif key in data:
            data[key] = value
    if not data["support_email"]:
        from app.core.config import settings

        data["support_email"] = settings.EMAIL_SENDER_EMAIL
    return data


def public(data: dict[str, Any] | None = None) -> dict[str, Any]:
    from app.services.business import media_url

    d = merged() if data is None else data
    return {
        "product_name": d["product_name"],
        "tagline": d["tagline"],
        "logo_url": media_url(d["logo_path"]),
        "logo_dark_url": media_url(d["logo_dark_path"]),
        "favicon_url": media_url(d["favicon_path"]),
        "fonts": dict(d["fonts"]),
        "theme": dict(d["theme"]),
        "support_email": d["support_email"],
        "company_address": d["company_address"],
        "social_links": list(d["social_links"] or []),
        "updated_at": d["updated_at"],
    }


def etag(payload: dict[str, Any]) -> str:
    return '"' + hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:32] + '"'


def set_cache(stored: dict[str, Any]) -> None:
    global _stored, _loaded_at
    _stored = dict(stored)
    _loaded_at = time.monotonic()


async def reload() -> None:
    from app.db.session import SessionLocal
    from app.models import PlatformSetting

    async with SessionLocal() as session:
        row = await session.get(PlatformSetting, KEY)
    set_cache(dict(row.value) if row else {})


async def ensure_fresh() -> None:
    global _lock, _loaded_at
    if time.monotonic() - _loaded_at < CACHE_TTL_SECONDS:
        return
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        if time.monotonic() - _loaded_at < CACHE_TTL_SECONDS:
            return
        try:
            await reload()
        except Exception:
            _loaded_at = time.monotonic()


async def current() -> dict[str, Any]:
    await ensure_fresh()
    return merged()


async def save(session: AsyncSession, changes: dict[str, Any], user_id: uuid.UUID | None) -> dict[str, Any]:
    from app.models import PlatformSetting

    row = await session.get(PlatformSetting, KEY)
    data = dict(row.value) if row else {}
    for key, value in changes.items():
        if key in ("fonts", "theme") and isinstance(value, dict):
            data[key] = {**(data.get(key) or {}), **value}
        else:
            data[key] = value
    data["updated_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    if row is None:
        session.add(PlatformSetting(key=KEY, value=data, updated_by=user_id))
    else:
        row.value = data
        row.updated_by = user_id
    await session.commit()
    set_cache(data)
    return merged(data)


# ── Validation ─────────────────────────────────────────────────────────────
def validate_patch(body: dict[str, Any]) -> dict[str, Any]:
    """Validates a partial Branding update; returns the storable changes."""
    out: dict[str, Any] = {}
    if "product_name" in body:
        name = str(body["product_name"] or "").strip()
        if not 1 <= len(name) <= 60:
            raise validation_error("body.product_name", "1-60 characters")
        out["product_name"] = name
    if "tagline" in body:
        tagline = (body["tagline"] or "").strip()
        if len(tagline) > 160:
            raise validation_error("body.tagline", "at most 160 characters")
        out["tagline"] = tagline or None
    if "support_email" in body:
        email = (body["support_email"] or "").strip()
        if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise validation_error("body.support_email", "a valid email address is required")
        out["support_email"] = email or None
    if "company_address" in body:
        addr = (body["company_address"] or "").strip()
        if len(addr) > 300:
            raise validation_error("body.company_address", "at most 300 characters")
        out["company_address"] = addr or None
    if "social_links" in body:
        links = body["social_links"] or []
        if not isinstance(links, list) or len(links) > 10:
            raise validation_error("body.social_links", "at most 10 links")
        clean = []
        for i, link in enumerate(links):
            url = str((link or {}).get("url") or "")
            platform = str((link or {}).get("platform") or "").strip().lower()[:32]
            if not platform or not re.match(r"^https://[^\s]+$", url) or len(url) > 500:
                raise validation_error(f"body.social_links.{i}", "platform and an https URL are required")
            clean.append({"platform": platform, "url": url})
        out["social_links"] = clean
    if "fonts" in body:
        fonts = body["fonts"] or {}
        if not isinstance(fonts, dict):
            raise validation_error("body.fonts", "must be an object {heading, body, mono}")
        clean_fonts = {}
        for role in ("heading", "body", "mono"):
            if role in fonts:
                family = fonts[role]
                entry = FONT_MAP.get(family)
                if entry is None:
                    raise validation_error(f"body.fonts.{role}", "font not in the curated list (see /meta/fonts)")
                if role == "mono" and entry["category"] != "mono":
                    raise validation_error("body.fonts.mono", "must be a monospace font")
                clean_fonts[role] = family
        out["fonts"] = clean_fonts
    if "theme" in body:
        theme = body["theme"] or {}
        if not isinstance(theme, dict):
            raise validation_error("body.theme", "must be an object")
        clean_theme: dict[str, Any] = {}
        for key, bg, label in (("accent_light", THEME_BG_LIGHT, "light"), ("accent_dark", THEME_BG_DARK, "dark")):
            if key in theme:
                value = str(theme[key] or "")
                if not HEX_RE.match(value):
                    raise validation_error(f"body.theme.{key}", "must be a hex colour like #B91C1C")
                ratio = contrast_ratio(value, bg)
                if ratio < MIN_CONTRAST:
                    raise AppError(
                        422, "branding_low_contrast",
                        f"{key} has a contrast of {ratio:.2f}:1 against the {label} background (minimum 3:1)",
                        [{"field": f"body.theme.{key}", "message": f"contrast {ratio:.2f}:1 < 3:1 on {bg}",
                          "contrast": round(ratio, 2), "background": bg}],
                    )
                clean_theme[key] = value.upper()
        if "default_mode" in theme:
            if theme["default_mode"] not in ("dark", "light", "system"):
                raise validation_error("body.theme.default_mode", "one of dark, light, system")
            clean_theme["default_mode"] = theme["default_mode"]
        out["theme"] = clean_theme
    return out
