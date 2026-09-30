"""Stripe keys: set by an admin (Admin → Payments, stored encrypted in ``platform_settings``) or, as a fallback,
by the ``STRIPE_*`` environment variables. An admin can also switch online payments off without removing keys."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decrypt_secret, encrypt_secret
from app.models import PlatformSetting

KEY = "payments"


@dataclass(frozen=True)
class StripeConfig:
    enabled: bool
    secret_key: str
    publishable_key: str
    webhook_secret: str
    source: str  # "admin" | "env" | "none"

    @property
    def mode(self) -> str | None:
        if not self.secret_key:
            return None
        return "test" if self.secret_key.startswith(("sk_test_", "rk_test_")) else "live"


def _dec(value: Any) -> str:
    return decrypt_secret(value) if isinstance(value, str) and value else ""


async def _stored(session: AsyncSession) -> dict[str, Any]:
    row = await session.get(PlatformSetting, KEY)
    return dict(row.value) if row else {}


async def load(session: AsyncSession) -> StripeConfig:
    v = await _stored(session)
    secret = _dec(v.get("secret_key_enc")) or settings.STRIPE_SECRET_KEY
    publishable = v.get("publishable_key") or settings.STRIPE_PUBLISHABLE_KEY
    webhook = _dec(v.get("webhook_secret_enc")) or settings.STRIPE_WEBHOOK_SECRET
    source = "admin" if v.get("secret_key_enc") else "env" if settings.STRIPE_SECRET_KEY else "none"
    switched_on = bool(v.get("enabled", True))
    return StripeConfig(enabled=switched_on and bool(secret and publishable), secret_key=secret,
                        publishable_key=publishable, webhook_secret=webhook, source=source)


def _hint(secret: str) -> str | None:
    return f"{secret[:8]}…{secret[-4:]}" if secret else None


async def admin_view(session: AsyncSession) -> dict[str, Any]:
    v = await _stored(session)
    cfg = await load(session)
    return {
        "enabled": cfg.enabled,
        "switched_on": bool(v.get("enabled", True)),
        "mode": cfg.mode,
        "source": cfg.source,
        "publishable_key": cfg.publishable_key or None,
        "secret_key_hint": _hint(cfg.secret_key),
        "webhook_secret_set": bool(cfg.webhook_secret),
        "webhook_url": f"{settings.API_BASE_URL.rstrip('/')}/api/v1/billing/stripe/webhook",
    }


async def save(session: AsyncSession, patch: dict[str, Any], user_id: uuid.UUID) -> None:
    """``patch`` keys: enabled, secret_key, publishable_key, webhook_secret ("" clears a key)."""
    row = await session.get(PlatformSetting, KEY)
    v = dict(row.value) if row else {}
    if "enabled" in patch:
        v["enabled"] = bool(patch["enabled"])
    if "publishable_key" in patch:
        v["publishable_key"] = patch["publishable_key"] or None
    for name in ("secret_key", "webhook_secret"):
        if name in patch:
            v[f"{name}_enc"] = encrypt_secret(patch[name]) if patch[name] else None
    if row is None:
        session.add(PlatformSetting(key=KEY, value=v, updated_by=user_id))
    else:
        row.value, row.updated_by = v, user_id
