"""One browser + one phone per account (web sessions, phone sessions) and the sign-in challenge step.

A sign-in either completes at once, or returns a *challenge*: an emailed 6-digit code (when LOGIN_OTP_REQUIRED) and/or
a confirmation that another device will be signed out. Confirming the challenge signs the other device out
(reason ``replaced``) and signs this one in.
"""

from __future__ import annotations

import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.core.security import sha256_hex
from app.core.useragent import browser, device_type
from app.models import LoginChallenge, PersonalSession, User, WebSession
from app.services.request_logs import ip_hash

RESEND_AFTER = timedelta(seconds=30)


def new_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    shown = name[:2] if len(name) > 2 else name[:1]
    return f"{shown}{'•' * max(1, min(6, len(name) - len(shown)))}@{domain}"


def browser_label(ua: str | None) -> str:
    os_name = {"ios": "iPhone", "android": "Android", "desktop": "Computer"}.get(device_type(ua), "Device")
    b = browser(ua)
    return f"{b[:1].upper()}{b[1:]} on {os_name}" if b and b.lower() != "other" else os_name


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


# ── web sessions ─────────────────────────────────────────────────────────────
async def active_web_session(session: AsyncSession, user_id: uuid.UUID) -> WebSession | None:
    return (await session.execute(
        select(WebSession).where(WebSession.user_id == user_id, WebSession.revoked_at.is_(None))
        .order_by(WebSession.created_at.desc()).limit(1)
    )).scalar_one_or_none()


async def revoke_web_sessions(session: AsyncSession, user_id: uuid.UUID, reason: str,
                              keep: uuid.UUID | None = None) -> None:
    stmt = update(WebSession).where(WebSession.user_id == user_id, WebSession.revoked_at.is_(None))
    if keep is not None:
        stmt = stmt.where(WebSession.id != keep)
    await session.execute(stmt.values(revoked_at=datetime.now(UTC), revoked_reason=reason))


async def create_web_session(session: AsyncSession, user: User, *, ua: str | None, ip: str | None, via: str,
                             client_id: str | None) -> WebSession:
    """The new browser session; every other browser of this user is signed out ("replaced")."""
    await revoke_web_sessions(session, user.id, "replaced")
    row = WebSession(user_id=user.id, device_name=browser_label(ua), user_agent=(ua or "")[:400] or None,
                     ip_hash=ip_hash(ip), via=via, last_seen_at=datetime.now(UTC),
                     client_id=(client_id or None))
    session.add(row)
    await session.flush()
    return row


def same_browser(existing: WebSession | None, client_id: str | None) -> bool:
    return bool(existing is not None and client_id and existing.client_id
                and hmac.compare_digest(existing.client_id, client_id))


def web_session_out(row: WebSession) -> dict[str, Any]:
    return {"id": str(row.id), "kind": "web", "device_name": row.device_name, "via": row.via,
            "created_at": _iso(row.created_at), "last_seen_at": _iso(row.last_seen_at)}


# ── phone sessions ───────────────────────────────────────────────────────────
async def active_phone_session(session: AsyncSession, user_id: uuid.UUID) -> PersonalSession | None:
    return (await session.execute(
        select(PersonalSession).where(PersonalSession.user_id == user_id, PersonalSession.revoked_at.is_(None),
                                      PersonalSession.internal.is_(False))
        .order_by(PersonalSession.created_at.desc()).limit(1)
    )).scalar_one_or_none()


async def revoke_phone_sessions(session: AsyncSession, user_id: uuid.UUID, reason: str) -> None:
    await session.execute(update(PersonalSession).where(
        PersonalSession.user_id == user_id, PersonalSession.revoked_at.is_(None), PersonalSession.internal.is_(False)
    ).values(revoked_at=datetime.now(UTC), revoked_reason=reason))


def phone_session_out(row: PersonalSession) -> dict[str, Any]:
    return {"id": str(row.id), "kind": "mobile", "device_name": row.device_name, "created_at": _iso(row.created_at),
            "last_seen_at": _iso(row.last_seen_at)}


# ── challenges ───────────────────────────────────────────────────────────────
async def start_challenge(session: AsyncSession, user: User | None, *, kind: str, purpose: str, via: str,
                          otp_required: bool, payload: dict[str, Any] | None = None,
                          webauthn_challenge: str | None = None) -> tuple[LoginChallenge, str | None]:
    """Returns (challenge, code to email or None). Older pending challenges of the same kind are cancelled."""
    now = datetime.now(UTC)
    if user is not None:
        await session.execute(update(LoginChallenge).where(
            LoginChallenge.user_id == user.id, LoginChallenge.kind == kind, LoginChallenge.purpose == purpose,
            LoginChallenge.used_at.is_(None)).values(used_at=now))
    code = new_code() if otp_required else None
    row = LoginChallenge(user_id=user.id if user else None, kind=kind, purpose=purpose, via=via,
                         otp_required=otp_required, code_hash=sha256_hex(code) if code else None,
                         webauthn_challenge=webauthn_challenge, payload=payload or {},
                         expires_at=now + timedelta(minutes=settings.LOGIN_CODE_TTL_MINUTES))
    session.add(row)
    await session.flush()
    return row, code


def _invalid() -> AppError:
    return AppError(401, "invalid_login_code", "This code is invalid or has expired — request a new one")


async def load_challenge(session: AsyncSession, challenge_id: uuid.UUID, *, kind: str,
                         purposes: tuple[str, ...]) -> LoginChallenge:
    row = (await session.execute(select(LoginChallenge).where(LoginChallenge.id == challenge_id)
                                 .with_for_update())).scalar_one_or_none()
    if (row is None or row.kind != kind or row.purpose not in purposes or row.used_at is not None
            or row.expires_at <= datetime.now(UTC)):
        raise AppError(400, "login_challenge_expired", "This sign-in step has expired — please sign in again")
    return row


async def check_code(session: AsyncSession, row: LoginChallenge, code: str | None) -> None:
    """Verifies the emailed code (if the challenge needs one). Too many wrong tries burn the challenge."""
    if not row.otp_required:
        return
    if row.attempts >= settings.LOGIN_CODE_MAX_ATTEMPTS:
        raise AppError(429, "too_many_attempts", "Too many wrong codes — please sign in again")
    given = (code or "").strip().replace(" ", "")
    if not given or row.code_hash is None or not hmac.compare_digest(row.code_hash, sha256_hex(given)):
        row.attempts += 1
        if row.attempts >= settings.LOGIN_CODE_MAX_ATTEMPTS:
            row.used_at = datetime.now(UTC)
        await session.commit()
        raise _invalid()


async def resend_code(session: AsyncSession, row: LoginChallenge) -> str:
    if not row.otp_required:
        raise AppError(409, "code_not_required", "This sign-in step doesn't need a code")
    if datetime.now(UTC) - row.created_at < RESEND_AFTER and row.attempts == 0 and row.payload.get("resent_at"):
        raise AppError(429, "rate_limited", "Please wait a few seconds before asking for another code")
    code = new_code()
    row.code_hash = sha256_hex(code)
    row.attempts = 0
    row.expires_at = datetime.now(UTC) + timedelta(minutes=settings.LOGIN_CODE_TTL_MINUTES)
    row.payload = {**row.payload, "resent_at": _iso(datetime.now(UTC))}
    return code


def challenge_out(row: LoginChallenge, user: User | None, existing: dict[str, Any] | None,
                  code: str | None) -> dict[str, Any]:
    """The "confirm" answer of a sign-in: what the next screen must ask for."""
    from app.services import email

    out: dict[str, Any] = {
        "status": "confirm",
        "challenge_id": str(row.id),
        "otp_required": row.otp_required,
        "otp_sent_to": mask_email(user.email) if (row.otp_required and user is not None) else None,
        "existing_session": existing,
        "expires_at": _iso(row.expires_at),
    }
    if code and email.expose_dev_links():
        out["dev_code"] = code  # development with email off only; never in production
    return out
