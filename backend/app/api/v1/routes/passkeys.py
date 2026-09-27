"""Passkeys (WebAuthn): add one while signed in, then sign in with it — no password, no emailed code."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, Request, Response
from sqlalchemy import select
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.api.deps import ClientDep, CurrentUser, SessionDep
from app.core.config import settings
from app.core.errors import AppError
from app.models import Passkey, User
from app.schemas.auth import LoginOut, PasskeyVerifyIn
from app.schemas.common import Schema
from app.services import audit, auth_sessions

router = APIRouter(prefix="/auth/passkeys", tags=["Auth"])
MAX_PASSKEYS = 10


class PasskeyLoginStartIn(Schema):
    client_id: str | None = None


def _rp(request: Request) -> tuple[str, str]:
    """(rp_id, origin): the page's own origin when it's an allowed one (localhost and the public site both work)."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin and origin in settings.webauthn_origins:
        return urlsplit(origin).hostname or settings.webauthn_rp_id, origin
    return settings.webauthn_rp_id, settings.public_web_url.rstrip("/")


def _out(p: Passkey) -> dict[str, Any]:
    iso = lambda d: d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None  # noqa: E731
    return {"id": str(p.id), "name": p.name, "created_at": iso(p.created_at), "last_used_at": iso(p.last_used_at)}


def _invalid(what: str) -> AppError:
    return AppError(400, "passkey_invalid", f"The passkey {what} could not be verified — try again")


@router.get("", summary="Your passkeys")
async def list_passkeys(user: CurrentUser, session: SessionDep) -> list[dict[str, Any]]:
    rows = (await session.execute(select(Passkey).where(Passkey.user_id == user.id)
                                  .order_by(Passkey.created_at))).scalars()
    return [_out(p) for p in rows]


@router.post("/register/options", summary="Start adding a passkey (signed in)")
async def register_options(user: CurrentUser, session: SessionDep, request: Request) -> dict[str, Any]:
    existing = (await session.execute(select(Passkey).where(Passkey.user_id == user.id))).scalars().all()
    if len(existing) >= MAX_PASSKEYS:
        raise AppError(409, "passkey_limit", f"You can keep up to {MAX_PASSKEYS} passkeys; remove one first")
    rp_id, _ = _rp(request)
    options = generate_registration_options(
        rp_id=rp_id, rp_name=settings.WEBAUTHN_RP_NAME or settings.APP_NAME, user_id=user.id.bytes,
        user_name=user.email, user_display_name=user.full_name or user.email,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.PREFERRED),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(p.credential_id)) for p in existing],
    )
    row, _ = await auth_sessions.start_challenge(
        session, user, kind="web", purpose="passkey", via="passkey", otp_required=False,
        payload={"ceremony": "register"}, webauthn_challenge=bytes_to_base64url(options.challenge))
    await session.commit()
    return {"challenge_id": str(row.id), "options": json.loads(options_to_json(options))}


@router.post("/register/verify", status_code=201, summary="Finish adding a passkey")
async def register_verify(body: PasskeyVerifyIn, user: CurrentUser, session: SessionDep, request: Request,
                          client: ClientDep) -> dict[str, Any]:
    row = await auth_sessions.load_challenge(session, body.challenge_id, kind="web", purposes=("passkey",))
    if row.user_id != user.id or row.payload.get("ceremony") != "register" or not row.webauthn_challenge:
        raise AppError(400, "login_challenge_expired", "This passkey step has expired — start again")
    rp_id, origin = _rp(request)
    try:
        v = verify_registration_response(credential=body.credential,
                                         expected_challenge=base64url_to_bytes(row.webauthn_challenge),
                                         expected_rp_id=rp_id, expected_origin=[origin, *settings.webauthn_origins])
    except Exception as exc:  # malformed input raises several parser errors besides InvalidRegistrationResponse
        raise _invalid("registration") from exc
    row.used_at = datetime.now(UTC)
    transports = (body.credential.get("response") or {}).get("transports") or []
    name = (body.name or "").strip()[:80] or auth_sessions.browser_label(request.headers.get("user-agent"))
    passkey = Passkey(user_id=user.id, credential_id=bytes_to_base64url(v.credential_id),
                      public_key=v.credential_public_key, sign_count=v.sign_count,
                      transports=[t for t in transports if isinstance(t, str)][:8], name=name)
    session.add(passkey)
    audit.record(session, action="user.passkey_add", user_id=user.id, client=client, resource_type="user",
                 resource_id=user.id, metadata={"name": name})
    await session.commit()
    return _out(passkey)


@router.delete("/{passkey_id}", status_code=204, summary="Remove a passkey")
async def delete_passkey(passkey_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep) -> Response:
    p = await session.get(Passkey, passkey_id)
    if p is None or p.user_id != user.id:
        raise AppError(404, "not_found", "Passkey not found")
    await session.delete(p)
    audit.record(session, action="user.passkey_remove", user_id=user.id, client=client, resource_type="user",
                 resource_id=user.id, metadata={"name": p.name})
    await session.commit()
    return Response(status_code=204)


@router.post("/login/options", summary="Start signing in with a passkey")
async def login_options(body: PasskeyLoginStartIn, session: SessionDep, request: Request) -> dict[str, Any]:
    from app.api.v1.routes.auth import client_id_of

    rp_id, _ = _rp(request)
    options = generate_authentication_options(rp_id=rp_id, user_verification=UserVerificationRequirement.PREFERRED)
    row, _ = await auth_sessions.start_challenge(
        session, None, kind="web", purpose="passkey", via="passkey", otp_required=False,
        payload={"ceremony": "login", "client_id": client_id_of(request, body.client_id)},
        webauthn_challenge=bytes_to_base64url(options.challenge))
    await session.commit()
    return {"challenge_id": str(row.id), "options": json.loads(options_to_json(options))}


@router.post("/login/verify", response_model=LoginOut, response_model_exclude_none=True,
             summary="Finish signing in with a passkey (may still ask to confirm signing out another browser)")
async def login_verify(body: PasskeyVerifyIn, session: SessionDep, request: Request, client: ClientDep,
                       background: BackgroundTasks) -> dict[str, object]:
    from app.api.v1.routes.auth import client_id_of, web_sign_in

    row = await auth_sessions.load_challenge(session, body.challenge_id, kind="web", purposes=("passkey",))
    if row.payload.get("ceremony") != "login" or not row.webauthn_challenge:
        raise AppError(400, "login_challenge_expired", "This passkey step has expired — start again")
    cred_id = str(body.credential.get("rawId") or body.credential.get("id") or "")
    passkey = (await session.execute(select(Passkey).where(Passkey.credential_id == cred_id))).scalar_one_or_none()
    if passkey is None:
        raise AppError(400, "passkey_unknown", "This passkey isn't registered here — sign in another way and add it")
    rp_id, origin = _rp(request)
    try:
        v = verify_authentication_response(
            credential=body.credential, expected_challenge=base64url_to_bytes(row.webauthn_challenge),
            expected_rp_id=rp_id, expected_origin=[origin, *settings.webauthn_origins],
            credential_public_key=passkey.public_key, credential_current_sign_count=passkey.sign_count)
    except Exception as exc:  # malformed input raises several parser errors besides InvalidAuthenticationResponse
        raise _invalid("sign-in") from exc
    row.used_at = datetime.now(UTC)
    passkey.sign_count = v.new_sign_count
    passkey.last_used_at = datetime.now(UTC)
    user = await session.get(User, passkey.user_id)
    assert user is not None
    return await web_sign_in(session, user, request, client, background, via="passkey",
                             client_id=client_id_of(request, body.client_id) or row.payload.get("client_id"),
                             strong=True)
