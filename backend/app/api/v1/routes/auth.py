from __future__ import annotations

from datetime import UTC, datetime, timedelta

import uuid

from fastapi import APIRouter, BackgroundTasks, File, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import ClientDep, CurrentUser, SessionDep
from app.core.config import settings
from app.core.errors import AppError, validation_error
from app.core.rate_limit import clear_login_failures, login_blocked, record_login_failure
from app.core.security import (
    create_access_token,
    generate_reset_token,
    hash_password,
    sha256_hex,
    verify_password,
)
from app.models import (
    Business,
    BusinessInvitation,
    EmailVerificationToken,
    PasswordResetToken,
    PersonalSession,
    User,
)
from app.schemas.business import VerifyEmailIn
from app.schemas.auth import (
    ChallengeIdIn,
    ChangePasswordIn,
    EmailCodeStartIn,
    EmailCodeStartOut,
    ForgotPasswordIn,
    LoginConfirmIn,
    LoginIn,
    LoginOut,
    RegisterIn,
    ResetPasswordIn,
    TokenOut,
    UpdateMeIn,
    UserOut,
)
from app.services import audit, auth_sessions, email, media, platform_settings
from app.services import business as business_service
from app.services import sandbox as sandbox_service
from app.services import team as team_service
from app.services import plans as plan_service
from app.services.serializers import user_out

router = APIRouter(prefix="/auth", tags=["Auth"])


def _token_response(user: User, web_session_id: uuid.UUID) -> TokenOut:
    token, expires_in = create_access_token(user.id, user.role, web_session_id)
    return TokenOut(access_token=token, expires_in=expires_in, user=user_out(user))


def client_id_of(request: Request, value: str | None) -> str | None:
    """The browser's stable id: from the body, else the `X-Client-Id` header the web app sends on every request."""
    cid = value or request.headers.get("x-client-id")
    return cid[:64] if cid and len(cid) >= 8 else None


def _ua_ip(request: Request, client: ClientDep) -> tuple[str | None, str | None]:
    return request.headers.get("user-agent"), client.ip


async def _complete_web_login(session: SessionDep, user: User, request: Request, client: ClientDep, *, via: str,
                              client_id: str | None) -> dict[str, object]:
    """Signs this browser in (every other browser of the account is signed out) and records the login."""
    ua, ip = _ua_ip(request, client)
    row = await auth_sessions.create_web_session(session, user, ua=ua, ip=ip, via=via, client_id=client_id)
    user.last_login_at = datetime.now(UTC)
    user.login_count = (user.login_count or 0) + 1
    audit.record(session, action="user.login", user_id=user.id, client=client, resource_type="user",
                 resource_id=user.id, metadata={"via": via, "session_id": str(row.id)})
    await session.commit()
    user = await load_user(session, user.id)
    return _token_response(user, row.id).model_dump(mode="json")


async def web_sign_in(session: SessionDep, user: User, request: Request, client: ClientDep,
                      background: BackgroundTasks, *, via: str, client_id: str | None, strong: bool) -> dict[str, object]:
    """Password (`strong=False`) needs the emailed code when LOGIN_OTP_REQUIRED; email codes and passkeys already
    proved it. Another live browser → a confirmation step first (unless it's this same browser signing in again)."""
    if not user.is_active:
        raise AppError(403, "account_disabled", "This account has been disabled")
    existing = await auth_sessions.active_web_session(session, user.id)
    otp = settings.login_otp_required and not strong
    if not otp and (existing is None or auth_sessions.same_browser(existing, client_id)):
        return await _complete_web_login(session, user, request, client, via=via, client_id=client_id)
    row, code = await auth_sessions.start_challenge(session, user, kind="web", purpose="login", via=via,
                                                    otp_required=otp, payload={"client_id": client_id})
    await session.commit()
    ua, _ = _ua_ip(request, client)
    if code:
        background.add_task(email.send_login_code, user.email, user.full_name, code,
                            device_name=auth_sessions.browser_label(ua),
                            signs_out=existing.device_name if existing else None)
    return auth_sessions.challenge_out(row, user, auth_sessions.web_session_out(existing) if existing else None, code)


async def load_user(session: SessionDep, user_id: uuid.UUID) -> User:
    """Reload with eager memberships (needed after creating/altering memberships)."""
    return (await session.execute(
        select(User).where(User.id == user_id).execution_options(populate_existing=True)
    )).scalar_one()


async def issue_verification(session: SessionDep, user: User) -> str:
    now = datetime.now(UTC)
    await session.execute(
        update(EmailVerificationToken)
        .where(EmailVerificationToken.user_id == user.id, EmailVerificationToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = generate_reset_token()
    session.add(EmailVerificationToken(
        user_id=user.id, token_hash=sha256_hex(token),
        expires_at=now + timedelta(hours=settings.EMAIL_VERIFICATION_EXPIRE_HOURS),
    ))
    return token


@router.post(
    "/register",
    status_code=201,
    response_model=TokenOut,
    summary="Create an account (developer or business)",
    description=(
        "`account_type` defaults to `developer` (unchanged behaviour). `business` requires the `business` object and "
        "atomically creates the workspace, owner membership, business profile and the default *Business Terminal* "
        "application. `invite_token` joins an existing business instead. In development with email disabled the "
        "response includes `dev_verification_url`."
    ),
)
async def register(
    body: RegisterIn, session: SessionDep, client: ClientDep, request: Request, background: BackgroundTasks
) -> TokenOut:
    invitation = None
    account_type = body.account_type
    if body.card_invite_token and not body.card_invite:
        body.card_invite = body.card_invite_token
    if body.invite_token:
        invitation = (await session.execute(
            select(BusinessInvitation).where(BusinessInvitation.token_hash == sha256_hex(body.invite_token))
            .with_for_update(of=BusinessInvitation)
        )).scalar_one_or_none()
        if invitation is None or invitation.status_at(datetime.now(UTC)) != "pending":
            raise AppError(410, "invitation_unavailable", "This invitation is invalid, expired or already used")
        if invitation.email.lower() != body.email:
            raise AppError(403, "invitation_email_mismatch", "Register with the email address that was invited")
        account_type = "business"
    else:
        enabled = platform_settings.effective()["signups_enabled"]
        if body.card_invite:
            account_type = "personal"
        if not enabled.get(account_type, True):
            raise AppError(403, "signups_disabled", f"New {account_type} sign-ups are currently disabled")
        if account_type == "business":
            if body.business is None:
                raise validation_error("body.business", "business details are required for a business account")
            if not await business_service.valid_category(session, body.business.category):
                raise validation_error("body.business.category", "unknown category (see /meta/business-categories)")

    country = body.country or (body.business.country.upper() if body.business is not None else None)
    if not country:
        raise validation_error("body.country", "country is required")
    exists = (await session.execute(select(User.id).where(User.email == body.email))).first()
    if exists:
        raise AppError(409, "email_taken", "An account with this email already exists")
    user = User(
        email=body.email,
        password_hash=await run_in_threadpool(hash_password, body.password),
        full_name=body.full_name,
        role="developer",
        is_active=True,
        account_type=account_type,
        phone=(body.phone or "").strip() or None,
        country=country,
        email_verified=invitation is not None,  # the invitation link proved the address
        email_verified_at=datetime.now(UTC) if invitation is not None else None,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise AppError(409, "email_taken", "An account with this email already exists")
    if account_type == "personal":
        await plan_service.create_subscription(session, user, "personal_free")
    else:
        await plan_service.create_free_subscription(session, user)
    audit.record(session, action="user.register", user_id=user.id, client=client,
                 resource_type="user", resource_id=user.id, metadata={"account_type": account_type})
    if invitation is not None:
        await team_service.accept_invitation(session, invitation, user, client)
    elif account_type == "personal":
        # Part 4 §1: a first digital card (template "modern") from the user's name/email; optional card invite (§6).
        from app.services import card_invites, personal

        if body.card_invite:
            invite = await card_invites.by_token(session, sha256_hex(body.card_invite))
            if invite is None:
                raise AppError(410, "card_invite_unavailable", "This card invitation is no longer available")
            await card_invites.accept(session, invite, user, client)
            user.email_verified, user.email_verified_at = True, datetime.now(UTC)
        else:
            fields = {"full_name": user.full_name, "emails": [{"label": "Email", "value": user.email}]}
            if user.phone:
                fields["phones"] = [{"label": "Mobile", "value": user.phone}]
            await personal.new_card(session, user, fields=fields)
    elif account_type == "business":
        assert body.business is not None
        business = await business_service.create_workspace(session, user, body.business.model_dump())
        audit.record(session, action="business.create", user_id=user.id, client=client,
                     resource_type="business", resource_id=business.id, metadata={"name": business.name})
        request.state.business_id = business.id
    else:
        session.add(sandbox_service.new_endpoint(user.id, "Default sandbox"))
    token = None if user.email_verified else await issue_verification(session, user)
    ua = request.headers.get("user-agent")
    web = await auth_sessions.create_web_session(session, user, ua=ua, ip=client.ip, via="register",
                                                 client_id=client_id_of(request, body.client_id))
    await session.commit()
    user = await load_user(session, user.id)
    if token:
        background.add_task(email.send_verification, user.email, user.full_name, token)
    out = _token_response(user, web.id)
    if token and email.expose_dev_links():
        out.dev_verification_url = email.verification_link(token)
    return out


@router.post("/verify-email", status_code=204, summary="Verify the account email with the emailed token")
async def verify_email(
    body: VerifyEmailIn, session: SessionDep, client: ClientDep, background: BackgroundTasks
) -> Response:
    now = datetime.now(UTC)
    row = (await session.execute(
        select(EmailVerificationToken).where(EmailVerificationToken.token_hash == sha256_hex(body.token))
        .with_for_update()
    )).scalar_one_or_none()
    if row is None or row.used_at is not None or row.expires_at <= now:
        raise AppError(400, "invalid_verification_token", "This verification link is invalid or has expired")
    user = await session.get(User, row.user_id)
    if user is None:
        raise AppError(400, "invalid_verification_token", "This verification link is invalid or has expired")
    row.used_at = now
    first_time = not user.email_verified
    await mark_email_verified(session, user, now)
    audit.record(session, action="user.email_verified", user_id=user.id, client=client,
                 resource_type="user", resource_id=user.id)
    await session.commit()
    if first_time:
        background.add_task(email.send_welcome, user.email, user.full_name, user.account_type)
    return Response(status_code=204, background=background)


async def mark_email_verified(session: SessionDep, user: User, now: datetime) -> None:
    """Verifies the user and the business workspaces they created (unverified businesses show a neutral page)."""
    user.email_verified = True
    user.email_verified_at = user.email_verified_at or now
    await session.execute(
        update(Business).where(Business.created_by == user.id, Business.verified_at.is_(None)).values(verified_at=now)
    )


@router.post("/resend-verification", status_code=202, summary="Send a new verification email")
async def resend_verification(user: CurrentUser, session: SessionDep, background: BackgroundTasks) -> JSONResponse:
    body: dict[str, str | None] = {"dev_verification_url": None}
    if not user.email_verified:
        token = await issue_verification(session, user)
        await session.commit()
        background.add_task(email.send_verification, user.email, user.full_name, token)
        if email.expose_dev_links():
            body["dev_verification_url"] = email.verification_link(token)
    return JSONResponse(status_code=202, content=body, background=background)


async def ensure_login_allowed(email: str) -> None:
    """Per-email brute-force guard (in addition to the per-IP auth bucket): too many recent failures → 429."""
    wait = await login_blocked(email)
    if wait is not None:
        raise AppError(429, "rate_limited", "Too many failed sign-in attempts for this account, try again later",
                       {"retry_after": wait}, headers={"Retry-After": str(wait)})


@router.post("/login", response_model=LoginOut, response_model_exclude_none=True,
             summary="Sign in (email + password)",
             description="`status: ok` → signed in. `status: confirm` → an emailed code is needed (production) and/or "
                         "another browser will be signed out: finish with `POST /auth/login/confirm`. One browser per "
                         "account; the same browser (`client_id`) signing in again needs no confirmation.")
async def login(body: LoginIn, session: SessionDep, client: ClientDep, request: Request,
                background: BackgroundTasks) -> dict[str, object]:
    await ensure_login_allowed(body.email)
    user = (await session.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    ok = await run_in_threadpool(verify_password, body.password, user.password_hash if user else None)
    if user is None or not ok:
        await record_login_failure(body.email)
        raise AppError(401, "invalid_credentials", "Invalid email or password")
    await clear_login_failures(body.email)
    return await web_sign_in(session, user, request, client, background, via="password",
                             client_id=client_id_of(request, body.client_id), strong=False)


@router.post("/login/confirm", response_model=LoginOut, response_model_exclude_none=True,
             summary="Finish a sign-in step (emailed code and/or sign out the other browser)")
async def login_confirm(body: LoginConfirmIn, session: SessionDep, client: ClientDep, request: Request) -> dict[str, object]:
    row = await auth_sessions.load_challenge(session, body.challenge_id, kind="web", purposes=("login",))
    await auth_sessions.check_code(session, row, body.code)
    user = await session.get(User, row.user_id) if row.user_id else None
    if user is None or not user.is_active:
        raise AppError(403, "account_disabled", "This account has been disabled")
    row.used_at = datetime.now(UTC)
    return await _complete_web_login(session, user, request, client, via=row.via,
                                     client_id=row.payload.get("client_id"))


@router.post("/login/resend", summary="Email a new sign-in code for a pending step")
async def login_resend(body: ChallengeIdIn, session: SessionDep, request: Request, client: ClientDep,
                       background: BackgroundTasks) -> dict[str, object]:
    row = await auth_sessions.load_challenge(session, body.challenge_id, kind="web", purposes=("login", "email_code"))
    user = await session.get(User, row.user_id) if row.user_id else None
    code = await auth_sessions.resend_code(session, row)
    await session.commit()
    if user is not None and user.is_active:
        background.add_task(email.send_login_code, user.email, user.full_name, code,
                            device_name=auth_sessions.browser_label(request.headers.get("user-agent")))
    out: dict[str, object] = {"status": "sent", "expires_at": auth_sessions._iso(row.expires_at)}
    if email.expose_dev_links():
        out["dev_code"] = code
    return out


@router.post("/email-code", response_model=EmailCodeStartOut, response_model_exclude_none=True,
             summary="Sign in without a password: email a 6-digit code",
             description="Always answers the same way (no account enumeration); the code only works for an existing, "
                         "active account. Finish with `POST /auth/email-code/verify`.")
async def email_code_start(body: EmailCodeStartIn, session: SessionDep, request: Request,
                           background: BackgroundTasks) -> dict[str, object]:
    await ensure_login_allowed(body.email)
    user = (await session.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    target = user if user is not None and user.is_active else None
    row, code = await auth_sessions.start_challenge(session, target, kind="web", purpose="email_code",
                                                    via="email_code", otp_required=True,
                                                    payload={"client_id": client_id_of(request, body.client_id)})
    await session.commit()
    if target is not None and code:
        background.add_task(email.send_login_code, target.email, target.full_name, code,
                            device_name=auth_sessions.browser_label(request.headers.get("user-agent")))
    out: dict[str, object] = {"challenge_id": str(row.id), "sent_to": auth_sessions.mask_email(body.email),
                              "expires_at": auth_sessions._iso(row.expires_at)}
    if code and target is not None and email.expose_dev_links():
        out["dev_code"] = code
    return out


@router.post("/email-code/verify", response_model=LoginOut, response_model_exclude_none=True,
             summary="Finish an email-code sign-in (may still ask to confirm signing out another browser)")
async def email_code_verify(body: LoginConfirmIn, session: SessionDep, client: ClientDep, request: Request,
                            background: BackgroundTasks) -> dict[str, object]:
    row = await auth_sessions.load_challenge(session, body.challenge_id, kind="web", purposes=("email_code",))
    if row.user_id is None:
        row.attempts += 1
        await session.commit()
        raise AppError(401, "invalid_login_code", "This code is invalid or has expired — request a new one")
    await auth_sessions.check_code(session, row, body.code)
    user = await session.get(User, row.user_id)
    if user is None:
        raise AppError(401, "invalid_login_code", "This code is invalid or has expired — request a new one")
    row.used_at = datetime.now(UTC)
    if not user.email_verified:  # the code reached the inbox: that proves the address
        await mark_email_verified(session, user, datetime.now(UTC))
    return await web_sign_in(session, user, request, client, background, via="email_code",
                             client_id=row.payload.get("client_id"), strong=True)


@router.post("/logout", status_code=204, summary="Sign this browser out")
async def logout(user: CurrentUser, session: SessionDep, request: Request) -> Response:
    sid = getattr(request.state, "web_session_id", None)
    if sid is not None:
        await auth_sessions.revoke_web_sessions(session, user.id, "logout")
        await session.commit()
    return Response(status_code=204)


@router.get("/sessions", summary="Where this account is signed in (one browser + one phone)")
async def my_sessions(user: CurrentUser, session: SessionDep, request: Request) -> dict[str, object]:
    web = await auth_sessions.active_web_session(session, user.id)
    phone = await auth_sessions.active_phone_session(session, user.id)
    return {
        "web": auth_sessions.web_session_out(web) | {"current": web.id == getattr(request.state, "web_session_id", None)}
        if web else None,
        "mobile": auth_sessions.phone_session_out(phone) if phone else None,
    }


@router.delete("/sessions/mobile", status_code=204, summary="Sign the phone out from the web")
async def sign_out_phone(user: CurrentUser, session: SessionDep, client: ClientDep) -> Response:
    await auth_sessions.revoke_phone_sessions(session, user.id, "logout")
    audit.record(session, action="personal.session_revoke", user_id=user.id, client=client,
                 resource_type="user", resource_id=user.id, metadata={"from": "web"})
    await session.commit()
    return Response(status_code=204)


@router.get("/me", response_model=UserOut, summary="Current user")
async def me(user: CurrentUser) -> UserOut:
    return user_out(user)


@router.patch("/me", response_model=UserOut, summary="Update profile")
async def update_me(body: UpdateMeIn, user: CurrentUser, session: SessionDep) -> UserOut:
    apply_profile(user, body.model_dump(exclude_unset=True))
    await session.commit()
    return user_out(user)


def apply_profile(user: User, data: dict) -> None:  # type: ignore[type-arg]
    """Profile fields shared by PATCH /auth/me and PATCH /admin/accounts/{id} (Part 3 §4)."""
    if data.get("full_name"):
        user.full_name = str(data["full_name"]).strip()
    for field in ("phone", "company", "job_title"):
        if field in data:
            value = (data[field] or "").strip()
            setattr(user, field, value or None)
    if "country" in data:
        user.country = data["country"] or None


MAX_PREFERENCES_BYTES = 8 * 1024


def merge_patch(target: dict, patch: dict) -> dict:  # type: ignore[type-arg]
    """RFC 7396 JSON merge patch (null removes a key)."""
    out = dict(target)
    for key, value in patch.items():
        if value is None:
            out.pop(key, None)
        elif isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge_patch(out[key], value)
        else:
            out[key] = value
    return out


@router.patch("/me/preferences", response_model=UserOut, summary="Merge-patch UI preferences (≤ 8 KB)",
              description="e.g. `{\"tours_completed\": [\"developer.dashboard\"], \"tours_dismissed\": false}`; "
                          "`null` removes a key.")
async def update_preferences(request: Request, user: CurrentUser, session: SessionDep) -> UserOut:
    import json

    patch = await request.json()
    if not isinstance(patch, dict):
        raise validation_error("body", "a JSON object is required")
    merged = merge_patch(dict(user.preferences or {}), patch)
    if len(json.dumps(merged).encode()) > MAX_PREFERENCES_BYTES:
        raise validation_error("body", "preferences must be at most 8 KB")
    tours = merged.get("tours_completed")
    if tours is not None and (not isinstance(tours, list) or not all(isinstance(t, str) for t in tours)):
        raise validation_error("body.tours_completed", "must be a list of tour ids")
    if "tours_dismissed" in merged and not isinstance(merged["tours_dismissed"], bool):
        raise validation_error("body.tours_dismissed", "must be a boolean")
    user.preferences = merged
    await session.commit()
    return user_out(user)


@router.post("/me/avatar", response_model=UserOut, summary="Upload an avatar (resized to 256×256)")
async def upload_avatar(user: CurrentUser, session: SessionDep, file: UploadFile = File(...)) -> UserOut:
    data = await file.read(settings.MEDIA_MAX_UPLOAD_BYTES + 1)
    path = await run_in_threadpool(media.save_avatar, data, str(user.id))
    old, user.avatar_path = user.avatar_path, path
    await session.commit()
    media.delete_file(old)
    return user_out(user)


@router.delete("/me/avatar", response_model=UserOut, summary="Remove the avatar")
async def delete_avatar(user: CurrentUser, session: SessionDep) -> UserOut:
    old, user.avatar_path = user.avatar_path, None
    await session.commit()
    media.delete_file(old)
    return user_out(user)


async def revoke_personal_sessions(session: SessionDep, user: User, now: datetime) -> None:
    """A new password signs every phone out too (mobile `nfcs_` sessions and their share keys), like JWTs."""
    await session.execute(
        update(PersonalSession)
        .where(PersonalSession.user_id == user.id, PersonalSession.revoked_at.is_(None))
        .values(revoked_at=now, revoked_reason="password")
    )
    await auth_sessions.revoke_web_sessions(session, user.id, "password")


@router.post("/change-password", status_code=204, summary="Change password (invalidates existing JWTs)")
async def change_password(
    body: ChangePasswordIn, user: CurrentUser, session: SessionDep, client: ClientDep, background: BackgroundTasks
) -> Response:
    if not await run_in_threadpool(verify_password, body.current_password, user.password_hash):
        raise AppError(400, "invalid_password", "Current password is incorrect")
    user.password_hash = await run_in_threadpool(hash_password, body.new_password)
    user.password_changed_at = datetime.now(UTC)
    await revoke_personal_sessions(session, user, user.password_changed_at)
    audit.record(session, action="user.password_change", user_id=user.id, client=client,
                 resource_type="user", resource_id=user.id)
    await session.commit()
    background.add_task(email.send_password_changed, user.email, user.full_name)
    return Response(status_code=204, background=background)


@router.post(
    "/forgot-password",
    status_code=202,
    summary="Request a password reset email",
    description="Always returns 202 whether or not the email exists (no user enumeration).",
)
async def forgot_password(
    body: ForgotPasswordIn, session: SessionDep, client: ClientDep, background: BackgroundTasks
) -> Response:
    user = (await session.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if user is not None and user.is_active:
        now = datetime.now(UTC)
        # Invalidate earlier outstanding tokens.
        await session.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
            .values(used_at=now)
        )
        token = generate_reset_token()
        session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=sha256_hex(token),
                expires_at=now + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
                requested_ip=client.ip,
            )
        )
        audit.record(session, action="user.password_reset_request", user_id=user.id, client=client,
                     resource_type="user", resource_id=user.id)
        await session.commit()
        background.add_task(email.send_password_reset, user.email, user.full_name, token)
    return Response(status_code=202)


@router.post("/reset-password", status_code=204, summary="Reset password with an emailed token")
async def reset_password(
    body: ResetPasswordIn, session: SessionDep, client: ClientDep, background: BackgroundTasks
) -> Response:
    now = datetime.now(UTC)
    row = (
        await session.execute(
            select(PasswordResetToken)
            .where(PasswordResetToken.token_hash == sha256_hex(body.token))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.used_at is not None or row.expires_at <= now:
        raise AppError(400, "invalid_reset_token", "This reset link is invalid or has expired")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise AppError(400, "invalid_reset_token", "This reset link is invalid or has expired")
    row.used_at = now
    user.password_hash = await run_in_threadpool(hash_password, body.new_password)
    user.password_changed_at = now
    await revoke_personal_sessions(session, user, now)
    audit.record(session, action="user.password_reset", user_id=user.id, client=client,
                 resource_type="user", resource_id=user.id)
    await session.commit()
    background.add_task(email.send_password_changed, user.email, user.full_name)
    return Response(status_code=204, background=background)

