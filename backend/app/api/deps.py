"""Shared FastAPI dependencies: DB session, auth (JWT / API key / device token), pagination."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import jwt
from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.core.rate_limit import client_ip
from app.core.security import (
    DEVICE_TOKEN_PREFIX,
    constant_time_equals,
    decode_access_token,
    sha256_hex,
)
from app.db.session import get_session
from app.models import ApiKey, Application, Business, BusinessMember, Device, PairingCode, User
from app.services.audit import ClientInfo
from app.services.permissions import permissions_for
from app.services.request_logs import set_actor

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_LAST_USED_RESOLUTION = timedelta(seconds=30)

jwt_scheme = HTTPBearer(
    scheme_name="DashboardJWT",
    description="Dashboard JWT from `POST /auth/login` (`Authorization: Bearer <jwt>`).",
    auto_error=False,
)
api_key_scheme = HTTPBearer(
    scheme_name="ApiKey",
    description="Application API key (`Authorization: Bearer nfc_...`). Only used for device registration.",
    auto_error=False,
)
device_scheme = HTTPBearer(
    scheme_name="DeviceToken",
    description="Device token returned by `/device/register` (`Authorization: Bearer nfcd_...`).",
    auto_error=False,
)


def get_client_info(request: Request) -> ClientInfo:
    return ClientInfo(ip=client_ip(request), user_agent=request.headers.get("user-agent"))


ClientDep = Annotated[ClientInfo, Depends(get_client_info)]


def _unauthorized(code: str = "unauthorized", message: str = "Authentication required") -> AppError:
    return AppError(401, code, message, headers={"WWW-Authenticate": "Bearer"})


async def _ensure_business_active(session: AsyncSession, app: Application) -> None:
    if app.business_id is None:
        return
    business = await session.get(Business, app.business_id)
    if business is None or business.deleted_at is not None:
        raise _unauthorized("device_revoked", "This business no longer exists")
    if business.status != "active":
        raise AppError(403, "business_suspended", "This business has been suspended")


# ── Dashboard users ──────────────────────────────────────────────────────
async def get_current_user(
    request: Request,
    session: SessionDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(jwt_scheme)],
) -> User:
    if creds is None or not creds.credentials:
        raise _unauthorized()
    try:
        payload = decode_access_token(creds.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.ExpiredSignatureError,):
        raise _unauthorized("token_expired", "Access token has expired")
    except (jwt.PyJWTError, ValueError, KeyError):
        raise _unauthorized("invalid_token", "Invalid access token")
    user = await session.get(User, user_id)
    if user is None:
        raise _unauthorized("invalid_token", "Invalid access token")
    if not user.is_active:
        raise AppError(403, "account_disabled", "This account has been disabled")
    if user.password_changed_at is not None and payload["iat"] < int(user.password_changed_at.timestamp()):
        raise _unauthorized("token_revoked", "Access token is no longer valid; please sign in again")
    set_actor(request, "user", user.id, user_id=user.id)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise AppError(403, "forbidden", "Administrator access required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def account_type_not_allowed(message: str) -> AppError:
    return AppError(403, "account_type_not_allowed", message)


async def require_platform_user(user: CurrentUser) -> User:
    """Developer-platform routes (applications, keys, devices, events, deliveries, sandbox, request logs, usage, live):
    developers and business members (business-owned resources are still authorised per resource via membership).
    Personal (digital card) accounts are refused; admins are allowed everywhere."""
    if user.account_type == "personal" and user.role != "admin":
        raise account_type_not_allowed("Developer features are not available to personal accounts")
    return user


PlatformUser = Annotated[User, Depends(require_platform_user)]
platform_only = [Depends(require_platform_user)]


def ensure_developer_account(user: User) -> None:
    """Creating developer-owned resources (POST /applications, sandbox endpoints without ?business_id):
    business accounts use their workspace (`POST /businesses/{id}/applications`) instead."""
    if user.role == "admin" or user.account_type not in ("personal", "business"):
        return
    raise account_type_not_allowed(
        "Business accounts create applications from their business workspace"
        if user.account_type == "business" else "Developer features are not available to personal accounts")


# ── API keys ─────────────────────────────────────────────────────────────
@dataclass
class ApiKeyContext:
    api_key: ApiKey
    application: Application


async def get_api_key_context(
    request: Request,
    session: SessionDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(api_key_scheme)],
) -> ApiKeyContext:
    token = creds.credentials if creds else ""
    if not token or not token.startswith(settings.API_KEY_PREFIX) or token.startswith(DEVICE_TOKEN_PREFIX):
        raise _unauthorized("invalid_api_key", "A valid API key is required")
    digest = sha256_hex(token)
    key = (await session.execute(select(ApiKey).where(ApiKey.key_hash == digest))).scalar_one_or_none()
    if key is None or not constant_time_equals(key.key_hash, digest):
        raise _unauthorized("invalid_api_key", "Invalid API key")
    if key.revoked_at is not None:
        raise _unauthorized("api_key_revoked", "This API key has been revoked")
    app = key.application
    if app.deleted_at is not None:
        raise _unauthorized("api_key_revoked", "This API key has been revoked")
    if not app.is_active:
        raise AppError(403, "application_disabled", "This application is disabled")
    owner = await session.get(User, app.owner_id)
    if owner is None or not owner.is_active:
        raise AppError(403, "account_disabled", "The account owning this application is disabled")
    set_actor(request, "api_key", key.id, user_id=app.owner_id, application_id=app.id, business_id=app.business_id)
    await _ensure_business_active(session, app)
    now = datetime.now(UTC)
    if key.last_used_at is None or now - key.last_used_at > _LAST_USED_RESOLUTION:
        key.last_used_at = now
        await session.commit()
    return ApiKeyContext(api_key=key, application=app)


ApiKeyAuth = Annotated[ApiKeyContext, Depends(get_api_key_context)]


# ── Device registration: API key or QR pairing code ─────────────────────
PAIRING_PREFIX = "nfcp_"

registration_scheme = HTTPBearer(
    scheme_name="ApiKeyOrPairingCode",
    description="`Authorization: Bearer nfc_...` (API key) or `Bearer nfcp_...` (QR pairing code).",
    auto_error=False,
)


@dataclass
class RegistrationContext:
    application: Application
    api_key: ApiKey | None = None
    pairing_code: PairingCode | None = None


def _invalid_pairing() -> AppError:
    return _unauthorized("invalid_pairing_code", "This pairing code is invalid, used, expired or cancelled")


async def get_registration_context(
    request: Request,
    session: SessionDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(registration_scheme)],
) -> RegistrationContext:
    token = creds.credentials if creds else ""
    if not token.startswith(PAIRING_PREFIX):
        ctx = await get_api_key_context(request, session, creds)
        return RegistrationContext(application=ctx.application, api_key=ctx.api_key)
    digest = sha256_hex(token)
    row = (
        await session.execute(select(PairingCode).where(PairingCode.code_hash == digest))
    ).scalar_one_or_none()
    if row is None or not constant_time_equals(row.code_hash, digest):
        raise _invalid_pairing()
    if row.status_at(datetime.now(UTC)) != "pending":
        raise _invalid_pairing()
    app = row.application
    set_actor(request, "pairing_code", row.id, user_id=app.owner_id, application_id=app.id,
              business_id=app.business_id)
    if app.deleted_at is not None:
        raise _invalid_pairing()
    await _ensure_business_active(session, app)
    if not app.is_active:
        raise AppError(403, "application_disabled", "This application is disabled")
    owner = await session.get(User, app.owner_id)
    if owner is None or not owner.is_active:
        raise AppError(403, "account_disabled", "The account owning this application is disabled")
    return RegistrationContext(application=app, pairing_code=row)


RegistrationAuth = Annotated[RegistrationContext, Depends(get_registration_context)]


# ── Devices ──────────────────────────────────────────────────────────────
async def get_current_device(
    request: Request,
    session: SessionDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(device_scheme)],
) -> Device:
    token = creds.credentials if creds else ""
    if not token or not token.startswith(DEVICE_TOKEN_PREFIX):
        raise _unauthorized("invalid_device_token", "A valid device token is required")
    digest = sha256_hex(token)
    device = (await session.execute(select(Device).where(Device.token_hash == digest))).scalar_one_or_none()
    if device is None or not constant_time_equals(device.token_hash, digest):
        raise _unauthorized("invalid_device_token", "Invalid device token")
    app = device.application
    if device.status != "active" or device.deleted_at is not None or app.deleted_at is not None:
        raise _unauthorized("device_revoked", "This device has been revoked; register it again")
    set_actor(request, "device", device.id, user_id=app.owner_id, application_id=app.id,
              business_id=app.business_id, device_id=device.id)
    if not app.is_active:
        raise AppError(403, "application_disabled", "This application is disabled")
    await _ensure_business_active(session, app)
    now = datetime.now(UTC)
    ip = client_ip(request)
    if device.last_seen_at is None or now - device.last_seen_at > _LAST_USED_RESOLUTION or device.last_ip != ip:
        device.last_seen_at = now
        device.last_ip = ip
        await session.commit()
    return device


CurrentDevice = Annotated[Device, Depends(get_current_device)]


# ── Pagination ───────────────────────────────────────────────────────────
@dataclass
class Pagination:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def get_pagination(
    page: Annotated[int, Query(ge=1, description="1-based page number")] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, description="Items per page (max 100)")] = 20,
) -> Pagination:
    return Pagination(page=page, page_size=page_size)


PaginationDep = Annotated[Pagination, Depends(get_pagination)]


# ── Business workspaces (Part 2 §B1) ─────────────────────────────────────
@dataclass
class BusinessContext:
    business: Business
    member: BusinessMember
    user: User
    permissions: set[str]

    @property
    def role(self) -> str:
        return self.member.role

    def has(self, permission: str) -> bool:
        return permission in self.permissions

    def require(self, permission: str) -> None:
        if permission not in self.permissions:
            raise AppError(403, "insufficient_permissions",
                           f"Your role does not allow this action ({permission})", {"required": permission})


async def load_business_context(
    session: AsyncSession, user: User, business_id: uuid.UUID, request: Request | None = None,
) -> BusinessContext:
    business = await session.get(Business, business_id)
    if business is None or business.deleted_at is not None:
        raise AppError(404, "not_found", "Business not found")
    member = (await session.execute(
        select(BusinessMember).where(BusinessMember.business_id == business_id, BusinessMember.user_id == user.id)
    )).scalar_one_or_none()
    if member is None or member.status != "active":
        raise AppError(403, "not_a_member", "You are not an active member of this business")
    if request is not None:
        request.state.business_id = business.id
    now = datetime.now(UTC)
    if member.last_active_at is None or now - member.last_active_at > timedelta(seconds=60):
        member.last_active_at = now
        await session.commit()
    return BusinessContext(business, member, user, permissions_for(member.role, member.extra_permissions))


def business_permission(permission: str | None = "business.view"):  # type: ignore[no-untyped-def]
    """Reusable dependency: membership of `{business_id}` + the given permission."""

    async def dependency(
        business_id: uuid.UUID, request: Request, user: CurrentUser, session: SessionDep,
    ) -> BusinessContext:
        ctx = await load_business_context(session, user, business_id, request)
        if permission:
            ctx.require(permission)
        return ctx

    return dependency


# ── Personal accounts (Part 4) ───────────────────────────────────────────
personal_scheme = HTTPBearer(
    scheme_name="PersonalSessionOrJWT",
    description="`Authorization: Bearer nfcs_...` (mobile session) or the dashboard JWT.",
    auto_error=False,
)


@dataclass
class PersonalContext:
    user: User
    session: Any  # PersonalSession | None


async def get_personal_context(
    request: Request,
    session: SessionDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(personal_scheme)],
) -> PersonalContext:
    from app.models import PersonalSession

    token = creds.credentials if creds else ""
    row = None
    if token.startswith("nfcs_"):
        digest = sha256_hex(token)
        row = (await session.execute(select(PersonalSession).where(PersonalSession.token_hash == digest))
               ).scalar_one_or_none()
        if row is None or not constant_time_equals(row.token_hash, digest) or row.internal:
            raise _unauthorized("invalid_session_token", "Invalid session token")
        if row.revoked_at is not None:
            raise _unauthorized("invalid_session_token", "This session was signed out")
        user = await session.get(User, row.user_id)
        if user is None:
            raise _unauthorized("invalid_session_token", "Invalid session token")
        if not user.is_active:
            raise AppError(403, "account_disabled", "This account has been disabled")
        set_actor(request, "personal_session", row.id, user_id=user.id)
        now = datetime.now(UTC)
        if row.last_seen_at is None or now - row.last_seen_at > _LAST_USED_RESOLUTION:
            row.last_seen_at = now
            await session.commit()
    else:
        user = await get_current_user(request, session, creds)
    if user.account_type != "personal":
        raise AppError(403, "personal_account_required", "This feature is available to personal accounts")
    return PersonalContext(user=user, session=row)


PersonalAuth = Annotated[PersonalContext, Depends(get_personal_context)]
