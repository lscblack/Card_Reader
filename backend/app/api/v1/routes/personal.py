"""Part 4: personal accounts — sessions, QR login, digital cards, exchanges, contacts, activity, public card page."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, File, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import Field
from sqlalchemy import Date, cast, func, or_, select, update

from app.api.deps import ClientDep, PaginationDep, PersonalAuth, SessionDep
from app.core.config import settings
from app.core.errors import AppError, not_found, validation_error
from app.core.rate_limit import client_ip, hit
from app.core.security import sha256_hex, verify_password
from app.core.countries import normalize_country
from app.core.useragent import is_bot
from app.models import (
    CardTemplate,
    Contact,
    DigitalCard,
    DigitalCardInvite,
    PersonalActivity,
    PersonalLoginCode,
    PersonalSession,
    User,
)
from app.schemas.common import Schema
from app.services import audit, auth_sessions, card_invites, media, notifications, personal
from app.services import email as email_service
from app.services.request_logs import set_actor
from app.services.serializers import user_out

router = APIRouter(prefix="/personal", tags=["Personal (digital cards)"])
public_router = APIRouter(prefix="/public/p", tags=["Public"])

LOGIN_CODE_TTL = timedelta(minutes=5)
EXCHANGE_QR_TTL = timedelta(minutes=10)


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


# ══ Sessions & QR login ════════════════════════════════════════════════════
class DeviceFields(Schema):
    device_name: str = Field(default="Phone", min_length=1, max_length=100)
    platform: str = Field(default="android", max_length=32)
    model: str | None = Field(default=None, max_length=100)
    os_version: str | None = Field(default=None, max_length=64)
    app_version: str | None = Field(default=None, max_length=32)
    installation_id: str | None = Field(default=None, min_length=8, max_length=64)


class SessionCreateIn(DeviceFields):
    email: str | None = Field(default=None, max_length=320)
    password: str | None = Field(default=None, max_length=128)
    login_code: str | None = Field(default=None, max_length=64)
    # Passwordless: POST /personal/email-code first, then send its challenge id + the emailed code here.
    email_code_challenge_id: uuid.UUID | None = None
    email_code: str | None = Field(default=None, max_length=12)


class PhoneConfirmIn(Schema):
    challenge_id: uuid.UUID
    code: str | None = Field(default=None, max_length=12)


class PhoneChallengeIn(Schema):
    challenge_id: uuid.UUID


class PhoneEmailCodeIn(Schema):
    email: str = Field(max_length=320)


async def _cards_of(session: SessionDep, user_id: uuid.UUID) -> list[DigitalCard]:
    return list((await session.execute(select(DigitalCard).where(DigitalCard.user_id == user_id,
                                                                 DigitalCard.deleted_at.is_(None))
                                        .order_by(DigitalCard.is_primary.desc(), DigitalCard.created_at))
                 ).scalars().unique())


async def _sign_phone_in(session: SessionDep, user: User, device: dict[str, Any], *, via: str,
                         client: ClientDep, request: Request, login_code_id: Any = None) -> dict[str, Any]:
    """Creates the phone session; any other phone of the account is signed out ("replaced") — one phone per account."""
    now = datetime.now(UTC)
    if device.get("installation_id"):  # this same phone signing in again
        await session.execute(update(PersonalSession).where(
            PersonalSession.user_id == user.id, PersonalSession.installation_id == device["installation_id"],
            PersonalSession.revoked_at.is_(None)).values(revoked_at=now, revoked_reason="relogin"))
    await auth_sessions.revoke_phone_sessions(session, user.id, "replaced")
    row, token, secret = await personal.create_session(session, user, device)
    if login_code_id is not None:
        await session.execute(update(PersonalLoginCode).where(PersonalLoginCode.id == login_code_id)
                              .values(session_id=row.id))
    user.last_login_at = now
    user.login_count = (user.login_count or 0) + 1
    set_actor(request, "personal_session", row.id, user_id=user.id)
    audit.record(session, action="personal.session_create", user_id=user.id, client=client,
                 resource_type="personal_session", resource_id=row.id,
                 metadata={"device_name": row.device_name, "via": via})
    await session.commit()
    user = (await session.execute(select(User).where(User.id == user.id)
                                  .execution_options(populate_existing=True))).scalar_one()
    return {"status": "ok", "session_token": token, "session": personal.session_out(row),
            "user": user_out(user).model_dump(mode="json"), "share_key": {"key_id": row.key_id, "secret": secret},
            "cards": [personal.card_out(c) for c in await _cards_of(session, user.id)]}


@router.post("/sessions", status_code=201, summary="Sign the app in (email + password, emailed code or QR login code)",
             description="`201 {status: ok}` returns a `nfcs_` session token (shown once) and the share key. One phone "
                         "per account: when another phone is signed in — or an emailed code is required (production) — "
                         "the answer is `202 {status: confirm, challenge_id, otp_required, existing_session}`; finish "
                         "with `POST /personal/sessions/confirm`. The same `installation_id` signing in again needs no "
                         "confirmation.")
async def create_session(body: SessionCreateIn, session: SessionDep, client: ClientDep, request: Request,
                         response: Response, background: BackgroundTasks) -> dict[str, Any]:
    now = datetime.now(UTC)
    user: User | None = None
    code_row = None
    via = "password"
    if body.login_code:
        code_row = (await session.execute(
            update(PersonalLoginCode).where(PersonalLoginCode.code_hash == sha256_hex(body.login_code),
                                            PersonalLoginCode.used_at.is_(None), PersonalLoginCode.expires_at > now)
            .values(used_at=now).returning(PersonalLoginCode.id, PersonalLoginCode.user_id))).first()
        if code_row is None:
            raise AppError(401, "invalid_login_code", "This login code is invalid, used or expired")
        user = await session.get(User, code_row[1])
        via = "login_code"
    elif body.email_code_challenge_id:
        ch = await auth_sessions.load_challenge(session, body.email_code_challenge_id, kind="mobile",
                                                purposes=("email_code",))
        if ch.user_id is None:
            ch.attempts += 1
            await session.commit()
            raise AppError(401, "invalid_login_code", "This code is invalid or has expired — request a new one")
        await auth_sessions.check_code(session, ch, body.email_code)
        ch.used_at = now
        user = await session.get(User, ch.user_id)
        via = "email_code"
    elif body.email and body.password:
        from app.api.v1.routes.auth import ensure_login_allowed
        from app.core.rate_limit import clear_login_failures, record_login_failure

        email = body.email.strip().lower()
        await ensure_login_allowed(email)
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        ok = await run_in_threadpool(verify_password, body.password, user.password_hash if user else None)
        if user is None or not ok:
            await record_login_failure(email)
            raise AppError(401, "invalid_credentials", "Invalid email or password")
        await clear_login_failures(email)
    else:
        raise validation_error("body", "provide email + password, an emailed code, or login_code")
    if user is None or not user.is_active:
        raise AppError(403, "account_disabled", "This account has been disabled")
    if user.account_type != "personal":
        raise AppError(403, "personal_account_required", "Sign in with a personal (digital card) account")
    device = body.model_dump(include=set(DeviceFields.model_fields))
    existing = await auth_sessions.active_phone_session(session, user.id)
    same_phone = bool(existing and body.installation_id and existing.installation_id == body.installation_id)
    otp = settings.login_otp_required and via == "password"
    if not otp and (existing is None or same_phone):
        return await _sign_phone_in(session, user, device, via=via, client=client, request=request,
                                    login_code_id=code_row[0] if code_row else None)
    ch, code = await auth_sessions.start_challenge(
        session, user, kind="mobile", purpose="login", via=via, otp_required=otp,
        payload={"device": device, "login_code_id": str(code_row[0]) if code_row else None})
    await session.commit()
    if code:
        background.add_task(email_service.send_login_code, user.email, user.full_name, code,
                            device_name=device.get("device_name"),
                            signs_out=existing.device_name if existing and not same_phone else None)
    response.status_code = 202
    return auth_sessions.challenge_out(ch, user, auth_sessions.phone_session_out(existing)
                                       if existing and not same_phone else None, code)


@router.post("/sessions/confirm", status_code=201, summary="Finish a phone sign-in step (code / sign out the other phone)")
async def confirm_session(body: PhoneConfirmIn, session: SessionDep, client: ClientDep, request: Request) -> dict[str, Any]:
    ch = await auth_sessions.load_challenge(session, body.challenge_id, kind="mobile", purposes=("login",))
    await auth_sessions.check_code(session, ch, body.code)
    user = await session.get(User, ch.user_id) if ch.user_id else None
    if user is None or not user.is_active:
        raise AppError(403, "account_disabled", "This account has been disabled")
    ch.used_at = datetime.now(UTC)
    code_id = ch.payload.get("login_code_id")
    return await _sign_phone_in(session, user, dict(ch.payload.get("device") or {}), via=ch.via, client=client,
                                request=request, login_code_id=uuid.UUID(code_id) if code_id else None)


@router.post("/sessions/resend", summary="Email a new sign-in code for a pending phone sign-in")
async def resend_session_code(body: PhoneChallengeIn, session: SessionDep, background: BackgroundTasks) -> dict[str, Any]:
    ch = await auth_sessions.load_challenge(session, body.challenge_id, kind="mobile", purposes=("login", "email_code"))
    user = await session.get(User, ch.user_id) if ch.user_id else None
    code = await auth_sessions.resend_code(session, ch)
    await session.commit()
    if user is not None and user.is_active:
        background.add_task(email_service.send_login_code, user.email, user.full_name, code)
    out: dict[str, Any] = {"status": "sent"}
    if email_service.expose_dev_links():
        out["dev_code"] = code
    return out


@router.post("/email-code", summary="Passwordless phone sign-in: email a 6-digit code",
             description="Same answer whether or not the account exists. Then `POST /personal/sessions` with "
                         "`email_code_challenge_id` + `email_code`.")
async def phone_email_code(body: PhoneEmailCodeIn, session: SessionDep, background: BackgroundTasks) -> dict[str, Any]:
    from app.api.v1.routes.auth import ensure_login_allowed

    email = body.email.strip().lower()
    await ensure_login_allowed(email)
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    target = user if user is not None and user.is_active and user.account_type == "personal" else None
    ch, code = await auth_sessions.start_challenge(session, target, kind="mobile", purpose="email_code",
                                                   via="email_code", otp_required=True)
    await session.commit()
    if target is not None and code:
        background.add_task(email_service.send_login_code, target.email, target.full_name, code)
    out: dict[str, Any] = {"challenge_id": str(ch.id), "sent_to": auth_sessions.mask_email(email)}
    if code and target is not None and email_service.expose_dev_links():
        out["dev_code"] = code
    return out


class AccountUpdateIn(Schema):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    country: str | None = Field(default=None, max_length=2)
    phone: str | None = Field(default=None, max_length=40)


@router.get("/account", summary="The signed-in account (name, email, country, photo)")
async def get_account(ctx: PersonalAuth) -> dict[str, Any]:
    return user_out(ctx.user).model_dump(mode="json")


@router.patch("/account", summary="Update name, country or phone (country can be changed, never cleared)")
async def update_account(body: AccountUpdateIn, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    data = body.model_dump(exclude_unset=True)
    if "country" in data:
        try:
            country = normalize_country(data["country"])
        except ValueError as exc:
            raise validation_error("body.country", str(exc)) from None
        if country is None:
            raise validation_error("body.country", "country is required and cannot be cleared")
        ctx.user.country = country
    if data.get("full_name"):
        ctx.user.full_name = data["full_name"].strip()
    if "phone" in data:
        ctx.user.phone = (data["phone"] or "").strip() or None
    await session.commit()
    return user_out(ctx.user).model_dump(mode="json")


@router.post("/account/avatar", summary="Upload a profile photo (optional; resized to 256×256)")
async def upload_account_avatar(ctx: PersonalAuth, session: SessionDep, file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(settings.MEDIA_MAX_UPLOAD_BYTES + 1)
    path = await run_in_threadpool(media.save_avatar, data, str(ctx.user.id))
    old, ctx.user.avatar_path = ctx.user.avatar_path, path
    await session.commit()
    media.delete_file(old)
    return user_out(ctx.user).model_dump(mode="json")


@router.delete("/account/avatar", summary="Remove the profile photo")
async def delete_account_avatar(ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    old, ctx.user.avatar_path = ctx.user.avatar_path, None
    await session.commit()
    media.delete_file(old)
    return user_out(ctx.user).model_dump(mode="json")


@router.get("/sessions", summary="Signed-in phones")
async def list_sessions(ctx: PersonalAuth, session: SessionDep) -> list[dict[str, Any]]:
    rows = (await session.execute(select(PersonalSession).where(
        PersonalSession.user_id == ctx.user.id, PersonalSession.internal.is_(False))
        .order_by(PersonalSession.created_at.desc()))).scalars()
    return [personal.session_out(r) | {"current": bool(ctx.session and r.id == ctx.session.id)} for r in rows]


@router.post("/sessions/current/heartbeat", summary="App heartbeat (session auth)")
async def heartbeat(ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    if ctx.session is None:
        raise AppError(401, "invalid_session_token", "A session token (nfcs_) is required")
    ctx.session.last_seen_at = datetime.now(UTC)
    await session.commit()
    return {"status": "active", "server_time": _iso(datetime.now(UTC))}


@router.delete("/sessions/{session_id}", status_code=204, summary="Sign a phone out (its share key stops validating)")
async def revoke_session(session_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep, client: ClientDep) -> Response:
    row = await session.get(PersonalSession, session_id)
    if row is None or row.user_id != ctx.user.id or row.internal:
        raise not_found("Session")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        audit.record(session, action="personal.session_revoke", user_id=ctx.user.id, client=client,
                     resource_type="personal_session", resource_id=row.id)
        await session.commit()
    return Response(status_code=204)


@router.post("/login-codes", status_code=201, summary="QR code to sign the phone in (5 min, single use)")
async def create_login_code(ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    code = personal.login_code()
    row = PersonalLoginCode(user_id=ctx.user.id, code_hash=sha256_hex(code),
                            expires_at=datetime.now(UTC) + LOGIN_CODE_TTL)
    session.add(row)
    await session.commit()
    server = quote((settings.DEVICE_SERVER_URL or settings.API_BASE_URL).rstrip("/"), safe="")
    return {"id": str(row.id), "code": code, "expires_at": _iso(row.expires_at),
            "qr_payload": f"nfcterminal://login?v=1&server={server}&code={code}"}


@router.get("/login-codes/{code_id}", summary="Login code status (poll)")
async def login_code_status(code_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    row = await session.get(PersonalLoginCode, code_id)
    if row is None or row.user_id != ctx.user.id:
        raise not_found("Login code")
    status = "used" if row.used_at else ("expired" if row.expires_at <= datetime.now(UTC) else "pending")
    sess = await session.get(PersonalSession, row.session_id) if row.session_id else None
    return {"id": str(row.id), "status": status, "session": personal.session_out(sess) if sess else None}


# ══ Templates ══════════════════════════════════════════════════════════════
@router.get("/design-presets", summary="Palettes and font pairs for the card editor (public)")
async def design_presets(request: Request) -> JSONResponse:
    from app.services.card_design_v2 import FONT_PAIRS, PALETTES

    set_actor(request, "public")
    return JSONResponse(content={"palettes": PALETTES, "font_pairs": FONT_PAIRS},
                        headers={"Cache-Control": "public, max-age=3600"})


@router.get("/templates", summary="Card templates (public): design v1 layouts and v2 shape templates")
async def templates(session: SessionDep, request: Request) -> list[dict[str, Any]]:
    set_actor(request, "public")
    rows = (await session.execute(select(CardTemplate).order_by(CardTemplate.sort_order))).scalars()
    return [personal.template_out(t) for t in rows]


# ══ Cards ══════════════════════════════════════════════════════════════════
class CardIn(Schema):
    label: str = Field(default="Personal", min_length=1, max_length=60)
    template_id: str | None = Field(default=None, max_length=32)
    design: dict[str, Any] | None = None
    fields: dict[str, Any] | None = None
    visibility: dict[str, str] | None = None
    share_settings: dict[str, bool] | None = None
    arrangement: dict[str, Any] | None = None  # Part 5 §2 (v2 templates)
    sides_enabled: list[str] | None = Field(default=None, max_length=2)


class CardPatch(Schema):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    template_id: str | None = Field(default=None, max_length=32)
    design: dict[str, Any] | None = None
    fields: dict[str, Any] | None = None
    visibility: dict[str, str] | None = None
    share_settings: dict[str, bool] | None = None
    status: Literal["active", "inactive"] | None = None
    slug: str | None = Field(default=None, min_length=3, max_length=80)
    arrangement: dict[str, Any] | None = None
    sides_enabled: list[str] | None = Field(default=None, max_length=2)


async def _card(session: SessionDep, user_id: uuid.UUID, card_id: uuid.UUID) -> DigitalCard:
    card = (await session.execute(select(DigitalCard).where(DigitalCard.id == card_id, DigitalCard.user_id == user_id,
                                                            DigitalCard.deleted_at.is_(None)))).scalar_one_or_none()
    if card is None:
        raise not_found("Card")
    return card


async def refresh_live_contacts(session: SessionDep, card: DigitalCard) -> None:
    """Contacts connected to this card get a fresh snapshot (respecting the level they're entitled to)."""
    rows = (await session.execute(select(Contact).where(Contact.counterpart_card_id == card.id,
                                                        Contact.live.is_(True)))).scalars().all()
    for c in rows:
        c.card = personal.snapshot(card, c.access_level)


@router.get("/cards", summary="My digital cards")
async def list_cards(ctx: PersonalAuth, session: SessionDep) -> list[dict[str, Any]]:
    return [personal.card_out(c) for c in await _cards_of(session, ctx.user.id)]


@router.post("/cards", status_code=201, summary="Create a card")
async def create_card(body: CardIn, ctx: PersonalAuth, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    await personal.ensure_card_limit(session, ctx.user.id)
    card = await personal.new_card(session, ctx.user, label=body.label.strip(), template_id=body.template_id,
                                   fields=body.fields, design=body.design, visibility=body.visibility,
                                   share=body.share_settings, arrangement=body.arrangement,
                                   sides_enabled=body.sides_enabled)
    audit.record(session, action="digital_card.create", user_id=ctx.user.id, client=client,
                 resource_type="digital_card", resource_id=card.id)
    await session.commit()
    return personal.card_out(await _card(session, ctx.user.id, card.id))


@router.get("/cards/{card_id}", summary="Get a card")
async def get_card(card_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    return personal.card_out(await _card(session, ctx.user.id, card_id))


def _locked(card: DigitalCard, field: str) -> AppError:
    return AppError(403, "field_locked", f"'{field}' is managed by {card.business.name if card.business else 'the business'}",
                    {"field": field})


@router.patch("/cards/{card_id}", summary="Update a card")
async def update_card(card_id: uuid.UUID, body: CardPatch, ctx: PersonalAuth, session: SessionDep,
                      client: ClientDep) -> dict[str, Any]:
    card = await _card(session, ctx.user.id, card_id)
    data = body.model_dump(exclude_unset=True)
    if body.fields is not None:
        clean = personal.validate_fields(body.fields)
        for key, value in clean.items():
            if key in (card.locked_fields or []) and value != (card.fields or {}).get(key):
                raise _locked(card, key)
        card.fields = {**(card.fields or {}), **clean}
    if card.template_locked and ((body.template_id and body.template_id != card.template_id) or body.design):
        raise _locked(card, "template" if body.template_id else "design")
    if body.template_id is not None and body.template_id != card.template_id:
        template = await personal.get_template(session, body.template_id)
        # Field values are kept; the arrangement is remapped onto the new zones unless one is given (Part 5 §2).
        personal.apply_template_v2(card, template, arrangement=body.arrangement, sides_enabled=body.sides_enabled)
        card.template_id = template.id
        card.template = template
        card.design = personal.validate_design(body.design or {}, template.default_design)
    else:
        if body.design is not None:
            card.design = personal.validate_design(body.design, card.design or {})
        if body.arrangement is not None or body.sides_enabled is not None:
            personal.apply_template_v2(card, card.template, arrangement=body.arrangement,
                                       sides_enabled=body.sides_enabled, switching=False)
    if body.visibility is not None:
        card.visibility = personal.validate_visibility(body.visibility, card.visibility or personal.DEFAULT_VISIBILITY)
    if body.share_settings is not None:
        card.share_settings = personal.validate_share(body.share_settings, card.share_settings or personal.DEFAULT_SHARE)
    if body.label:
        card.label = body.label.strip()
    if body.status is not None:
        card.status = body.status
    if body.slug is not None:
        from app.services.business import slugify

        slug = slugify(body.slug, 80)
        if len(slug) < 3:
            raise validation_error("body.slug", "at least 3 letters/digits")
        if slug != card.slug:
            if (await session.execute(select(DigitalCard.id).where(DigitalCard.slug == slug))).first():
                raise AppError(409, "slug_taken", "This link is already taken")
            card.slug = slug
    card.updated_at = datetime.now(UTC)
    await refresh_live_contacts(session, card)
    audit.record(session, action="digital_card.update", user_id=ctx.user.id, client=client,
                 resource_type="digital_card", resource_id=card.id, metadata={"fields": sorted(data)})
    await session.commit()
    return personal.card_out(card)


@router.delete("/cards/{card_id}", status_code=204, summary="Delete a card")
async def delete_card(card_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep, client: ClientDep) -> Response:
    card = await _card(session, ctx.user.id, card_id)
    card.deleted_at, card.status = datetime.now(UTC), "inactive"
    await session.execute(update(Contact).where(Contact.counterpart_card_id == card.id).values(live=False))
    if card.is_primary:
        card.is_primary = False
        other = next((c for c in await _cards_of(session, ctx.user.id) if c.id != card.id), None)
        if other is not None:
            other.is_primary = True
    audit.record(session, action="digital_card.delete", user_id=ctx.user.id, client=client,
                 resource_type="digital_card", resource_id=card.id)
    await session.commit()
    return Response(status_code=204)


@router.post("/cards/{card_id}/primary", summary="Make this the card the phone shares")
async def set_primary(card_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    card = await _card(session, ctx.user.id, card_id)
    await session.execute(update(DigitalCard).where(DigitalCard.user_id == ctx.user.id, DigitalCard.id != card.id)
                          .values(is_primary=False))
    card.is_primary = True
    await session.commit()
    return personal.card_out(card)


@router.post("/cards/{card_id}/rotate-share-id", summary="Rotate the share id (old tokens and QR codes stop working)")
async def rotate_share_id(card_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    card = await _card(session, ctx.user.id, card_id)
    card.share_id = uuid.uuid4()
    audit.record(session, action="digital_card.rotate_share_id", user_id=ctx.user.id, client=client,
                 resource_type="digital_card", resource_id=card.id)
    await session.commit()
    return personal.card_out(card)


@router.post("/cards/{card_id}/duplicate", status_code=201, summary="Duplicate a card")
async def duplicate_card(card_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    src = await _card(session, ctx.user.id, card_id)
    await personal.ensure_card_limit(session, ctx.user.id)
    card = await personal.new_card(session, ctx.user, label=f"{src.label} copy"[:60], template_id=src.template_id,
                                   fields=dict(src.fields or {}), design=dict(src.design or {}),
                                   visibility=dict(src.visibility or {}), share=dict(src.share_settings or {}),
                                   arrangement=src.arrangement, sides_enabled=list(src.sides_enabled or ["front"]))
    card.photo_path, card.cover_path, card.logo_path = src.photo_path, src.cover_path, src.logo_path
    await session.commit()
    return personal.card_out(await _card(session, ctx.user.id, card.id))


IMAGE_SIZES = {"photo": ((512, 512), True), "cover": ((1200, 630), True), "logo": ((512, 512), False)}


@router.post("/cards/{card_id}/images", summary="Upload photo / cover / logo (PNG/JPEG/WebP ≤ 3 MB, re-encoded)")
async def upload_image(card_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep,
                       kind: Literal["photo", "cover", "logo"] = Query(...), file: UploadFile = File(...)) -> dict[str, Any]:
    card = await _card(session, ctx.user.id, card_id)
    if kind in (card.locked_fields or []):
        raise _locked(card, kind)
    data = await file.read(3 * 1024 * 1024 + 1)
    size, crop = IMAGE_SIZES[kind]
    path = await run_in_threadpool(media.save_resized, data, f"cards/{card.id}", kind, size, crop,
                                   max_bytes=3 * 1024 * 1024)
    old = getattr(card, f"{kind}_path")
    setattr(card, f"{kind}_path", path)
    await refresh_live_contacts(session, card)
    await session.commit()
    if old and not (card.business and card.business.logo_path == old):
        media.delete_file(old)
    return personal.card_out(card)


@router.delete("/cards/{card_id}/images", summary="Remove photo / cover / logo")
async def delete_image(card_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep,
                       kind: Literal["photo", "cover", "logo"] = Query(...)) -> dict[str, Any]:
    card = await _card(session, ctx.user.id, card_id)
    if kind in (card.locked_fields or []):
        raise _locked(card, kind)
    setattr(card, f"{kind}_path", None)
    await refresh_live_contacts(session, card)
    await session.commit()
    return personal.card_out(card)


@router.get("/cards/{card_id}/exchange-qr", summary="QR payload for exchanging without NFC (10 min)")
async def exchange_qr(card_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    card = await _card(session, ctx.user.id, card_id)
    key = ctx.session or await personal.server_key(session, ctx.user)
    token = personal.mint_token(key, card)
    await session.commit()
    return {"qr_payload": f"nfcterminal://card?v=1&t={token}", "token": token,
            "expires_at": _iso(datetime.now(UTC) + EXCHANGE_QR_TTL)}


# ══ Exchanges ══════════════════════════════════════════════════════════════
class ExchangeIn(Schema):
    token: str = Field(min_length=10, max_length=128)
    via: Literal["nfc", "qr"] = "nfc"


async def _primary(session: SessionDep, user_id: uuid.UUID) -> DigitalCard | None:
    cards = [c for c in await _cards_of(session, user_id) if personal.effective_status(c) == "active"]
    return next((c for c in cards if c.is_primary), cards[0] if cards else None)


async def _upsert_contact(session: SessionDep, owner_id: uuid.UUID, owner_card: DigitalCard | None,
                          other: DigitalCard, level: str, source: str) -> tuple[Contact, bool]:
    existing = (await session.execute(select(Contact).where(Contact.owner_id == owner_id,
                                                            Contact.counterpart_card_id == other.id))
                ).scalars().first()
    now = datetime.now(UTC)
    if existing is not None:
        if level == "contacts" or existing.access_level != "contacts":
            existing.access_level = level
        existing.card = personal.snapshot(other, existing.access_level)
        existing.live, existing.met_at, existing.updated_at = True, now, now
        return existing, True
    contact = Contact(owner_id=owner_id, owner_card_id=owner_card.id if owner_card else None, source=source,
                      counterpart_user_id=other.user_id, counterpart_card_id=other.id,
                      card=personal.snapshot(other, level), access_level=level, live=True, tags=[], favorite=False,
                      met_at=now)
    session.add(contact)
    return contact, False


async def _bump(session: SessionDep, card_id: uuid.UUID, counter: str) -> None:
    """Atomic `counter = counter + 1` in SQL (a Python read-modify-write loses concurrent increments)."""
    await personal.bump_counter(session, card_id, counter)


def contact_out(c: Contact) -> dict[str, Any]:
    return {"id": str(c.id), "source": c.source,
            "counterpart_user_id": str(c.counterpart_user_id) if c.counterpart_user_id else None,
            "counterpart_card_id": str(c.counterpart_card_id) if c.counterpart_card_id else None,
            "card": c.card, "live": c.live, "notes": c.notes, "tags": list(c.tags or []), "favorite": c.favorite,
            "met_at": _iso(c.met_at), "created_at": _iso(c.created_at), "updated_at": _iso(c.updated_at)}


@router.post("/exchanges", status_code=201, summary="Exchange cards using a scanned token (NFC or QR)",
             description="Mutual when the other person's `auto_exchange` is on (both get each other's public + "
                         "contacts fields); otherwise one-way with public fields only. Repeats update the contacts.")
async def exchange(body: ExchangeIn, ctx: PersonalAuth, session: SessionDep, client: ClientDep,
                   request: Request) -> dict[str, Any]:
    resolved = await personal.resolve_token(session, body.token)
    other = resolved.card
    if other.user_id == ctx.user.id:
        raise AppError(409, "self_exchange", "You can't exchange cards with yourself")
    me_card = await _primary(session, ctx.user.id)
    mutual = personal.share_setting(other, "auto_exchange") and me_card is not None
    source = "qr_exchange" if body.via == "qr" else "nfc_exchange"
    existing = (await session.execute(select(Contact.id).where(Contact.owner_id == ctx.user.id,
                                                               Contact.counterpart_card_id == other.id))).first()
    if not existing:
        await personal.ensure_contact_limit(session, ctx.user.id)
    contact, already = await _upsert_contact(session, ctx.user.id, me_card, other,
                                             "contacts" if mutual else "public", source)
    await _bump(session, other.id, "exchanges")
    my_name = (me_card.fields or {}).get("full_name") if me_card else ctx.user.full_name
    their_name = (other.fields or {}).get("full_name") or "someone"
    personal.record_activity(session, other.user_id, other.id, "exchange", f"{my_name or 'Someone'} received your card",
                             body.via, counterpart_name=my_name, mutual=mutual)
    if me_card is not None:
        personal.record_activity(session, ctx.user.id, me_card.id, "exchange", f"You received {their_name}'s card",
                                 body.via, counterpart_name=their_name, mutual=mutual)
    if mutual:
        assert me_card is not None
        room, _ = await personal.contacts_room(session, other.user_id)
        has_back = (await session.execute(select(Contact.id).where(Contact.owner_id == other.user_id,
                                                                   Contact.counterpart_card_id == me_card.id))).first()
        if room or has_back:
            await _upsert_contact(session, other.user_id, other, me_card, "contacts", source)
        await _bump(session, me_card.id, "exchanges")
        notifications.notify(session, [other.user_id], type_="personal.exchange",
                             title=f"You exchanged cards with {my_name or 'someone'}",
                             body="Their card was added to your contacts.", link="/me/contacts", severity="info")
    audit.record(session, action="personal.exchange", user_id=ctx.user.id, client=client, resource_type="digital_card",
                 resource_id=other.id, metadata={"mutual": mutual, "via": body.via})
    await session.commit()
    await session.refresh(contact)
    return {"contact": contact_out(contact), "mutual": mutual, "already_connected": already}


# ══ Contacts ═══════════════════════════════════════════════════════════════
class ContactIn(Schema):
    fields: dict[str, Any]
    notes: str | None = Field(default=None, max_length=5000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    favorite: bool = False


class ContactPatch(Schema):
    notes: str | None = Field(default=None, max_length=5000)
    tags: list[str] | None = Field(default=None, max_length=30)
    favorite: bool | None = None
    fields: dict[str, Any] | None = None  # manual contacts only


def _contacts_conds(user_id: uuid.UUID, q: str | None, tag: str | None, source: str | None,
                    favorite: bool | None) -> list:  # type: ignore[type-arg]
    conds = [Contact.owner_id == user_id]
    if q:
        conds.append(or_(Contact.card["fields"].astext.ilike(f"%{q.strip()}%"), Contact.notes.ilike(f"%{q.strip()}%")))
    if tag:
        conds.append(Contact.tags.contains([tag]))
    if source:
        conds.append(Contact.source == source)
    if favorite is not None:
        conds.append(Contact.favorite.is_(favorite))
    return conds


@router.get("/contacts", summary="My contacts")
async def list_contacts(ctx: PersonalAuth, session: SessionDep, pagination: PaginationDep,
                        q: str | None = Query(default=None, max_length=100), tag: str | None = None,
                        source: Literal["nfc_exchange", "qr_exchange", "web_lead", "manual"] | None = None,
                        favorite: bool | None = None) -> dict[str, Any]:
    conds = _contacts_conds(ctx.user.id, q, tag, source, favorite)
    total = (await session.execute(select(func.count()).select_from(Contact).where(*conds))).scalar_one()
    rows = (await session.execute(select(Contact).where(*conds).order_by(Contact.updated_at.desc(), Contact.id)
                                  .offset(pagination.offset).limit(pagination.page_size))).scalars()
    return {"items": [contact_out(c) for c in rows], "total": total, "page": pagination.page,
            "page_size": pagination.page_size}


@router.post("/contacts", status_code=201, summary="Add a contact manually")
async def create_contact(body: ContactIn, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    await personal.ensure_contact_limit(session, ctx.user.id)
    fields = personal.validate_fields(body.fields)
    if not fields.get("full_name"):
        raise validation_error("body.fields.full_name", "full_name is required")
    c = Contact(owner_id=ctx.user.id, source="manual", card={"fields": fields}, access_level="contacts", live=False,
                notes=body.notes, tags=[t.strip()[:40] for t in body.tags if t.strip()], favorite=body.favorite,
                met_at=datetime.now(UTC))
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return contact_out(c)


def _vcard(fields: dict[str, Any], photo_url: str | None = None, note: str | None = None) -> str:
    from app.services.actions import _vcard_escape as esc

    name = fields.get("full_name") or "Contact"
    parts = name.split(" ", 1)
    lines = ["BEGIN:VCARD", "VERSION:3.0", f"N:{esc(parts[-1] if len(parts) > 1 else '')};{esc(parts[0])};;;",
             f"FN:{esc(name)}"]
    if fields.get("company"):
        lines.append(f"ORG:{esc(fields['company'])}" + (f";{esc(fields['department'])}" if fields.get("department") else ""))
    if fields.get("job_title"):
        lines.append(f"TITLE:{esc(fields['job_title'])}")
    for p in fields.get("phones") or []:
        lines.append(f"TEL;TYPE={esc((p.get('label') or 'CELL').upper())}:{esc(p['value'])}")
    for e in fields.get("emails") or []:
        lines.append(f"EMAIL;TYPE=INTERNET:{esc(e['value'])}")
    for w in (fields.get("websites") or []) + (fields.get("custom_links") or []):
        lines.append(f"URL:{esc(w['url'])}")
    for s in fields.get("socials") or []:
        lines.append(f"X-SOCIALPROFILE;TYPE={esc(s.get('platform', 'other'))}:{esc(s['url'])}")
    if fields.get("address"):
        lines.append(f"ADR;TYPE=WORK:;;{esc(fields['address'])};;;;")
    if photo_url:
        lines.append(f"PHOTO;VALUE=URI:{photo_url}")
    bits = [b for b in (fields.get("headline"), note) if b]
    if bits:
        lines.append(f"NOTE:{esc(' — '.join(bits))}")
    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"


def _vcard_response(text: str, filename: str) -> Response:
    return Response(content=text, media_type="text/vcard; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})


@router.get("/contacts/export.vcf", summary="Export all contacts (vCard)")
async def export_vcf(ctx: PersonalAuth, session: SessionDep) -> Response:
    rows = (await session.execute(select(Contact).where(Contact.owner_id == ctx.user.id)
                                  .order_by(Contact.created_at))).scalars()
    return _vcard_response("".join(_vcard(c.card.get("fields") or {}, c.card.get("photo_url"), c.notes) for c in rows),
                           "contacts.vcf")


@router.get("/contacts/export.csv", summary="Export all contacts (CSV)")
async def export_csv(ctx: PersonalAuth, session: SessionDep) -> Response:
    rows = (await session.execute(select(Contact).where(Contact.owner_id == ctx.user.id)
                                  .order_by(Contact.created_at))).scalars()
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["full_name", "company", "job_title", "emails", "phones", "websites", "source", "tags", "notes",
                "met_at"])
    for c in rows:
        f = c.card.get("fields") or {}

        def cell(v: Any) -> str:
            s = str(v or "")
            return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s  # CSV-injection guard

        w.writerow([cell(f.get("full_name")), cell(f.get("company")), cell(f.get("job_title")),
                    cell("; ".join(e["value"] for e in f.get("emails") or [])),
                    cell("; ".join(p["value"] for p in f.get("phones") or [])),
                    cell("; ".join(x["url"] for x in f.get("websites") or [])), c.source,
                    cell("; ".join(c.tags or [])), cell(c.notes), _iso(c.met_at)])
    return Response(content=out.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="contacts.csv"', "Cache-Control": "no-store"})


async def _contact(session: SessionDep, user_id: uuid.UUID, contact_id: uuid.UUID) -> Contact:
    c = await session.get(Contact, contact_id)
    if c is None or c.owner_id != user_id:
        raise not_found("Contact")
    return c


@router.get("/contacts/{contact_id}", summary="One contact")
async def get_contact(contact_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    return contact_out(await _contact(session, ctx.user.id, contact_id))


@router.patch("/contacts/{contact_id}", summary="Notes, tags, favourite (fields for manual contacts)")
async def update_contact(contact_id: uuid.UUID, body: ContactPatch, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    c = await _contact(session, ctx.user.id, contact_id)
    data = body.model_dump(exclude_unset=True)
    if "notes" in data:
        c.notes = body.notes
    if body.tags is not None:
        c.tags = [t.strip()[:40] for t in body.tags if t.strip()]
    if body.favorite is not None:
        c.favorite = body.favorite
    if body.fields is not None:
        if c.source != "manual":
            raise validation_error("body.fields", "only manual contacts can be edited")
        c.card = {**c.card, "fields": {**(c.card.get("fields") or {}), **personal.validate_fields(body.fields)}}
    c.updated_at = datetime.now(UTC)
    await session.commit()
    return contact_out(c)


@router.delete("/contacts/{contact_id}", status_code=204, summary="Delete a contact")
async def delete_contact(contact_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> Response:
    c = await _contact(session, ctx.user.id, contact_id)
    await session.delete(c)
    await session.commit()
    return Response(status_code=204)


@router.get("/contacts/{contact_id}/vcard", summary="Contact as vCard")
async def contact_vcard(contact_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> Response:
    c = await _contact(session, ctx.user.id, contact_id)
    fields = c.card.get("fields") or {}
    return _vcard_response(_vcard(fields, c.card.get("photo_url"), c.notes),
                           f"{(fields.get('full_name') or 'contact').replace(' ', '_')}.vcf")


# ══ Activity & stats ═══════════════════════════════════════════════════════
@router.get("/activity", summary="Views, taps, exchanges, leads timeline")
async def activity(ctx: PersonalAuth, session: SessionDep, pagination: PaginationDep,
                   card_id: uuid.UUID | None = None) -> dict[str, Any]:
    conds = [PersonalActivity.user_id == ctx.user.id]
    if card_id:
        conds.append(PersonalActivity.card_id == card_id)
    total = (await session.execute(select(func.count()).select_from(PersonalActivity).where(*conds))).scalar_one()
    rows = (await session.execute(select(PersonalActivity, DigitalCard.label)
                                  .outerjoin(DigitalCard, DigitalCard.id == PersonalActivity.card_id).where(*conds)
                                  .order_by(PersonalActivity.created_at.desc(), PersonalActivity.id)
                                  .offset(pagination.offset).limit(pagination.page_size))).all()
    return {"items": [{"id": str(a.id), "type": a.type, "card_id": str(a.card_id) if a.card_id else None,
                       "card_label": label, "source": a.source if a.source in ("nfc", "qr", "link") else None,
                       "counterpart_name": (a.detail or {}).get("counterpart_name"), "detail": a.title,
                       "created_at": _iso(a.created_at)} for a, label in rows],
            "total": total, "page": pagination.page, "page_size": pagination.page_size}


@router.get("/stats", summary="Totals, timeline and sources")
async def stats(ctx: PersonalAuth, session: SessionDep,
                range: Literal["7d", "30d", "90d"] = Query(default="30d")) -> dict[str, Any]:
    days = {"7d": 7, "30d": 30, "90d": 90}[range]
    since = datetime.now(UTC) - timedelta(days=days)
    base = [PersonalActivity.user_id == ctx.user.id, PersonalActivity.created_at >= since]
    totals = dict((await session.execute(select(PersonalActivity.type, func.count()).where(*base)
                                         .group_by(PersonalActivity.type))).all())
    day = cast(PersonalActivity.created_at, Date)
    rows = (await session.execute(select(day, PersonalActivity.type, func.count()).where(*base)
                                  .group_by(day, PersonalActivity.type))).all()
    by_day: dict[date, dict[str, int]] = {}
    for d, t, n in rows:
        by_day.setdefault(d, {})[t] = int(n)
    today = datetime.now(UTC).date()
    timeline = []
    for i in _range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        v = by_day.get(d, {})
        timeline.append({"date": d.isoformat(), "views": v.get("view", 0), "nfc_taps": v.get("nfc_tap", 0)
                         + v.get("terminal_read", 0), "exchanges": v.get("exchange", 0), "leads": v.get("lead", 0)})
    sources = (await session.execute(select(PersonalActivity.source, func.count()).where(*base)
                                     .group_by(PersonalActivity.source))).all()
    return {"range": range,
            "totals": {"views": int(totals.get("view", 0)),
                       "nfc_taps": int(totals.get("nfc_tap", 0)) + int(totals.get("terminal_read", 0)),
                       "exchanges": int(totals.get("exchange", 0)), "leads": int(totals.get("lead", 0))},
            "timeline": timeline,
            "by_source": [{"source": s or "other", "count": int(n)} for s, n in sources]}


# ══ Business invites (§6) ══════════════════════════════════════════════════
def invite_out(inv: DigitalCardInvite) -> dict[str, Any]:
    from app.services.business import media_url

    return {"id": str(inv.id), "business": {"id": str(inv.business_id), "name": inv.business.name,
                                            "logo_url": media_url(inv.business.logo_path),
                                            "verified": inv.business.verified},
            "email": inv.email, "status": inv.status_at(datetime.now(UTC)), "expires_at": _iso(inv.expires_at),
            "created_at": _iso(inv.created_at), "card_id": str(inv.card_id) if inv.card_id else None}


@router.get("/business-invites", summary="Digital-card invitations from businesses",
            description="Matched on the account email, so only listed once that email is verified (empty otherwise).")
async def business_invites(ctx: PersonalAuth, session: SessionDep) -> list[dict[str, Any]]:
    if not ctx.user.email_verified:
        return []
    rows = (await session.execute(select(DigitalCardInvite).where(
        func.lower(DigitalCardInvite.email) == ctx.user.email.lower()).order_by(DigitalCardInvite.created_at.desc())
    )).scalars()
    return [invite_out(i) for i in rows]


async def _my_invite(session: SessionDep, ctx: PersonalAuth, invite_id: uuid.UUID) -> DigitalCardInvite:
    inv = (await session.execute(select(DigitalCardInvite).where(DigitalCardInvite.id == invite_id)
                                 .with_for_update(of=DigitalCardInvite))).scalar_one_or_none()
    if inv is None or inv.email.lower() != ctx.user.email.lower():
        raise not_found("Invitation")
    if not ctx.user.email_verified:
        # Email verification is non-blocking at sign-up: without it anyone could register someone else's address
        # and take over a business-issued card. (Registering with the emailed invite token proves possession.)
        raise AppError(403, "email_not_verified", "Verify your email address to answer this invitation")
    return inv


@router.post("/business-invites/{invite_id}/accept", summary="Accept → business-linked card on this account")
async def accept_invite(invite_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    inv = await _my_invite(session, ctx, invite_id)
    card = await card_invites.accept(session, inv, ctx.user, client)
    await session.commit()
    return personal.card_out(await _card(session, ctx.user.id, card.id))


@router.post("/business-invites/{invite_id}/decline", summary="Decline an invitation")
async def decline_invite(invite_id: uuid.UUID, ctx: PersonalAuth, session: SessionDep) -> dict[str, Any]:
    inv = await _my_invite(session, ctx, invite_id)
    if inv.status_at(datetime.now(UTC)) != "pending":
        raise AppError(410, "card_invite_unavailable", "This card invitation is no longer available")
    inv.declined_at = datetime.now(UTC)
    await session.commit()
    return invite_out(inv)


# ══ Public card page (§2) ══════════════════════════════════════════════════
async def _public_card(session: SessionDep, slug: str) -> tuple[DigitalCard, User]:
    card = (await session.execute(select(DigitalCard).where(DigitalCard.slug == slug.lower(),
                                                            DigitalCard.deleted_at.is_(None)))).scalar_one_or_none()
    owner = await session.get(User, card.user_id) if card else None
    if card is None or owner is None or not owner.is_active or personal.effective_status(card) != "active" \
            or not personal.share_setting(card, "web_page_enabled"):
        raise AppError(404, "card_unavailable", "This card isn't available")
    return card, owner


@public_router.get("/{slug}", summary="Public digital card page (public fields only)")
async def public_card(slug: str, session: SessionDep, request: Request,
                      via: Literal["nfc", "qr", "link"] = Query(default="link")) -> JSONResponse:
    set_actor(request, "public")
    card, _ = await _public_card(session, slug)
    template = await session.get(CardTemplate, card.template_id)
    if not is_bot(request.headers.get("user-agent")):
        await session.execute(update(DigitalCard).where(DigitalCard.id == card.id).values(
            views=DigitalCard.views + 1, nfc_taps=DigitalCard.nfc_taps + (1 if via == "nfc" else 0)))
        personal.record_activity(session, card.user_id, card.id, "nfc_tap" if via == "nfc" else "view",
                                 "Someone tapped your card" if via == "nfc" else "Someone viewed your card", via)
        await session.commit()
    snap = personal.snapshot(card, "public")
    return JSONResponse(content={
        "card": {"id": str(card.id), "slug": card.slug, "design": snap["design"],
                 "template": personal.template_out(template) if template else None, "fields": snap["fields"],
                 "photo_url": snap["photo_url"], "cover_url": snap["cover_url"], "logo_url": snap["logo_url"],
                 "business": snap["business"], "public_url": snap["public_url"],
                 # Part 5: everything the v2 renderer needs (fields above are already visibility-filtered)
                 "design_version": snap["design_version"], "sides_enabled": snap["sides_enabled"],
                 "arrangement": snap["arrangement"], "expired": snap["expired"]},
        "lead_capture_enabled": personal.share_setting(card, "lead_capture_enabled"),
        "vcard_url": f"{settings.public_api_url}/api/v1/public/p/{card.slug}/vcard",
    }, headers={"Cache-Control": "no-store"})


@public_router.get("/{slug}/vcard", summary="Public card as vCard (public fields only)")
async def public_card_vcard(slug: str, session: SessionDep, request: Request) -> Response:
    set_actor(request, "public")
    card, _ = await _public_card(session, slug)
    snap = personal.snapshot(card, "public")
    return _vcard_response(_vcard(snap["fields"], snap["photo_url"]), f"{card.slug}.vcf")


class LeadIn(Schema):
    full_name: str = Field(min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    company: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=2000)
    website: str | None = Field(default=None, max_length=500, description="Honeypot — must be empty")


@public_router.post("/{slug}/leads", status_code=201, summary="Share your details with the card owner")
async def create_lead(slug: str, body: LeadIn, session: SessionDep, request: Request) -> dict[str, Any]:
    set_actor(request, "public")
    card, _ = await _public_card(session, slug)
    if not personal.share_setting(card, "lead_capture_enabled"):
        raise AppError(404, "card_unavailable", "Lead capture is turned off for this card")
    limit = await hit(f"lead:{client_ip(request)}:{card.id}", 5, 600)
    if limit is not None and not limit.allowed:
        raise AppError(429, "rate_limited", "Too many submissions, try again later", {"retry_after": limit.retry_after},
                       headers={"Retry-After": str(limit.retry_after)})
    if body.website:  # honeypot: pretend success, store nothing
        return {"status": "received"}
    if body.email and "@" not in body.email:
        raise validation_error("body.email", "invalid email")
    if not body.email and not body.phone:
        raise validation_error("body.email", "an email or a phone number is required")
    fields: dict[str, Any] = {"full_name": body.full_name.strip()}
    if body.company:
        fields["company"] = body.company.strip()
    if body.email:
        fields["emails"] = [{"label": "Email", "value": body.email.strip()}]
    if body.phone:
        fields["phones"] = [{"label": "Phone", "value": body.phone.strip()}]
    session.add(Contact(owner_id=card.user_id, owner_card_id=card.id, source="web_lead", card={"fields": fields},
                        access_level="contacts", live=False, notes=body.message, tags=["lead"], favorite=False,
                        met_at=datetime.now(UTC)))
    await _bump(session, card.id, "leads")
    personal.record_activity(session, card.user_id, card.id, "lead", f"{fields['full_name']} shared their details",
                             "link", counterpart_name=fields["full_name"])
    notifications.notify(session, [card.user_id], type_="personal.lead", title=f"New lead: {fields['full_name']}",
                         body=body.message[:200] if body.message else None, link="/me/contacts", severity="success")
    await session.commit()
    return {"status": "received"}



_range = range
