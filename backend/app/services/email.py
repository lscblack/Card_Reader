"""Transactional & admin email (Part 3 §3): branded templates, SMTP delivery with retries, email_logs.

Every email is rendered from `app/templates/email/*` and logged in `email_logs`. Stored HTML/text never contains
one-time links (replaced with "[link removed]"). Admin campaigns are queued and sent by the worker (throttled).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any
from urllib.parse import urlencode

import aiosmtplib
from sqlalchemy import select

from app.core.config import settings
from app.services import email_templates

logger = logging.getLogger("app.email")

MAX_STORED_BYTES = 200 * 1024
MAX_ATTEMPTS = 3  # first try + 2 retries
RETRY_DELAY_SECONDS = 0.5


# ── Links ─────────────────────────────────────────────────────────────────
def reset_link(token: str) -> str:
    sep = "&" if "?" in settings.PASSWORD_RESET_URL else "?"
    return f"{settings.PASSWORD_RESET_URL}{sep}{urlencode({'token': token})}"


def expose_dev_links() -> bool:
    """Dev-only: responses include verification/invite URLs when email is disabled (never in production)."""
    return settings.is_development and not settings.EMAIL_ENABLED


def verification_link(token: str) -> str:
    return f"{settings.public_web_url}/verify-email?{urlencode({'token': token})}"


def invitation_link(token: str) -> str:
    return f"{settings.public_web_url}/invite/{token}"


# ── SMTP ───────────────────────────────────────────────────────────────────
def build_message(to_email: str, rendered: email_templates.Rendered, product_name: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = rendered.subject
    msg["From"] = formataddr((settings.EMAIL_SENDER_NAME or product_name, settings.EMAIL_SENDER_EMAIL))
    msg["To"] = to_email
    msg["Message-ID"] = make_msgid(domain=settings.EMAIL_SENDER_EMAIL.split("@")[-1] or None)
    msg.set_content(rendered.text)
    msg.add_alternative(rendered.html, subtype="html")
    return msg


async def send_email(msg: EmailMessage) -> None:
    port = settings.EMAIL_SMTP_PORT
    await aiosmtplib.send(
        msg,
        hostname=settings.EMAIL_SMTP_SERVER,
        port=port,
        username=settings.EMAIL_LOGIN or None,
        password=settings.EMAIL_SENDER_PASSWORD or None,
        use_tls=port == 465,
        start_tls=port == 587,
        timeout=15,
    )


def _truncate(value: str) -> str:
    raw = value.encode("utf-8")
    return value if len(raw) <= MAX_STORED_BYTES else raw[:MAX_STORED_BYTES].decode("utf-8", "ignore")


async def _send_with_retries(msg: EmailMessage, attempts: int = MAX_ATTEMPTS) -> str | None:
    """Returns None on success or the last error class name."""
    error = None
    for attempt in range(1, attempts + 1):
        try:
            await send_email(msg)
            return None
        except Exception as exc:
            error = f"{exc.__class__.__name__}: {str(exc)[:200]}"
            if attempt < attempts:
                await asyncio.sleep(RETRY_DELAY_SECONDS * attempt)
    return error


async def deliver_templated(
    template: str,
    to_email: str,
    context: dict[str, Any],
    *,
    user_id: uuid.UUID | None = None,
    sent_by: uuid.UUID | None = None,
    secrets: list[str] | None = None,
    subject: str | None = None,
) -> uuid.UUID | None:
    """Renders, sends (with retries) and logs one transactional email. Never raises."""
    from app.db.session import SessionLocal
    from app.models import EmailLog, User
    from app.services import branding

    try:
        brand = await branding.current()
        rendered = email_templates.render(template, context, brand, subject)
        secrets = [s for s in (secrets or []) if s]
        async with SessionLocal() as session:
            if user_id is None:
                user_id = (await session.execute(select(User.id).where(User.email == to_email.lower()))).scalar()
            log = EmailLog(
                to_email=to_email, user_id=user_id, template=template, subject=rendered.subject, status="queued",
                sent_by=sent_by, attempts=0,
                html=_truncate(email_templates.redact(rendered.html, secrets)),
                text_body=_truncate(email_templates.redact(rendered.text, secrets)),
            )
            session.add(log)
            await session.flush()
            if not settings.EMAIL_ENABLED:
                log.status = "logged"
                if settings.is_development:
                    logger.info("EMAIL_ENABLED=false: %s email for %s%s", template, to_email,
                                f": {secrets[0]}" if secrets else "")
                else:
                    logger.info("EMAIL_ENABLED=false: would send a %s email to %s", template, to_email)
            else:
                error = await _send_with_retries(build_message(to_email, rendered, brand["product_name"]))
                log.attempts = MAX_ATTEMPTS if error else 1
                log.status = "failed" if error else "sent"
                log.error = error
                log.sent_at = datetime.now(UTC) if not error else None
                if error:
                    logger.error("Failed to send %s email: %s", template, error.split(":")[0])
            await session.commit()
            return log.id
    except Exception:
        logger.exception("Email %s could not be processed", template)
        return None


# ── Transactional emails (signatures kept from Part 1/2) ────────────────────
async def send_password_reset(to_email: str, full_name: str, token: str) -> None:
    link = reset_link(token)
    await deliver_templated("password_reset", to_email, {
        "recipient_name": full_name or None, "action_url": link,
        "expires_minutes": settings.PASSWORD_RESET_EXPIRE_MINUTES}, secrets=[link])


async def send_verification(to_email: str, full_name: str, token: str) -> None:
    link = verification_link(token)
    await deliver_templated("verify_email", to_email, {
        "recipient_name": full_name or None, "email": to_email, "action_url": link,
        "expires_hours": settings.EMAIL_VERIFICATION_EXPIRE_HOURS}, secrets=[link])


async def send_invitation(to_email: str, business_name: str, role: str, token: str,
                          inviter_name: str | None = None) -> None:
    link = invitation_link(token)
    await deliver_templated("invitation", to_email, {
        "business_name": business_name, "role": role, "inviter_name": inviter_name, "action_url": link},
        secrets=[link])


async def send_welcome(to_email: str, full_name: str, account_type: str) -> None:
    await deliver_templated("welcome", to_email, {
        "recipient_name": full_name or None, "account_type": account_type,
        "action_url": f"{settings.public_web_url}/dashboard"})


async def send_login_code(to_email: str, full_name: str, code: str, *, device_name: str | None = None,
                          signs_out: str | None = None) -> None:
    await deliver_templated("login_code", to_email, {
        "recipient_name": full_name or None, "code": code, "expires_minutes": settings.LOGIN_CODE_TTL_MINUTES,
        "device_name": device_name, "signs_out": signs_out}, secrets=[code])


async def send_password_changed(to_email: str, full_name: str) -> None:
    await deliver_templated("password_changed", to_email, {
        "recipient_name": full_name or None, "email": to_email,
        "changed_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "reset_url": f"{settings.public_web_url}/forgot-password"})


# ── Admin campaigns (queued; sent by the worker) ────────────────────────────
def render_admin_message(brand: dict[str, Any], subject: str, body_markdown: str, cta: dict[str, str] | None,
                         recipient_name: str | None = None) -> email_templates.Rendered:
    return email_templates.render("admin_message", {"recipient_name": recipient_name, "body_markdown": body_markdown,
                                                    "cta": cta}, brand, subject)


def throttle_batch() -> int:
    per_minute = max(1, settings.EMAIL_THROTTLE_PER_MINUTE)
    return max(1, int(per_minute * settings.DELIVERY_WORKER_POLL_SECONDS / 60) or 1)


async def process_queue(session_factory, batch: int | None = None) -> int:  # type: ignore[no-untyped-def]
    """Sends due queued campaign emails (SKIP LOCKED → safe with several workers). Returns emails processed."""
    from app.models import EmailCampaign, EmailLog

    batch = batch or throttle_batch()
    now = datetime.now(UTC)
    async with session_factory() as session:
        rows = (await session.execute(
            select(EmailLog).where(EmailLog.status == "queued", EmailLog.campaign_id.is_not(None),
                                   (EmailLog.next_attempt_at.is_(None)) | (EmailLog.next_attempt_at <= now))
            .order_by(EmailLog.created_at).limit(batch).with_for_update(skip_locked=True)
        )).scalars().all()
        campaign_ids = {log.campaign_id for log in rows if log.html is None}
        campaigns = {c.id: c for c in (await session.execute(
            select(EmailCampaign).where(EmailCampaign.id.in_(campaign_ids)))).scalars()} if campaign_ids else {}
        for log in rows:
            camp = campaigns.get(log.campaign_id)  # type: ignore[arg-type]
            rendered = email_templates.Rendered(subject=log.subject, html=log.html or (camp.html if camp else "") or "",
                                                text=log.text_body or (camp.text_body if camp else "") or "")
            if not settings.EMAIL_ENABLED:
                log.status, log.attempts = "logged", log.attempts + 1
                continue
            log.attempts += 1
            try:
                await send_email(build_message(log.to_email, rendered, settings.APP_NAME))
                log.status, log.sent_at, log.error = "sent", datetime.now(UTC), None
            except Exception as exc:
                log.error = f"{exc.__class__.__name__}: {str(exc)[:200]}"
                if log.attempts >= MAX_ATTEMPTS:
                    log.status = "failed"
                else:
                    log.next_attempt_at = datetime.now(UTC) + timedelta(seconds=30 * log.attempts)
        await session.commit()
        return len(rows)



async def send_digital_card_invite(to_email: str, business_name: str, employee_name: str, token: str) -> None:
    link = card_invite_link(token)
    await deliver_templated("digital_card_invite", to_email, {
        "business_name": business_name, "employee_name": employee_name, "action_url": link}, secrets=[link])


def card_invite_link(token: str) -> str:
    return f"{settings.public_web_url}/register?card_invite={token}"
