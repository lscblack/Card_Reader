"""Application / API key helpers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, not_found, validation_error
from app.core.security import (
    api_key_display_prefix,
    encrypt_secret,
    generate_api_key,
    sha256_hex,
)
from app.models import ApiKey, Application, Device, User
from app.services.url_validation import InvalidEndpointURL, validate_endpoint_url


async def get_owned_application(
    session: AsyncSession, user: User, application_id: uuid.UUID, *, for_update: bool = False,
    permission: str = "api.manage",
) -> Application:
    """Developer-owned apps: owner only. Business apps (§B8): active member with `permission`."""
    stmt = select(Application).where(Application.id == application_id, Application.deleted_at.is_(None))
    if for_update:
        stmt = stmt.with_for_update(of=Application)
    app = (await session.execute(stmt)).scalar_one_or_none()
    if app is None:
        raise not_found("Application")
    await authorize_application(session, user, app, permission)
    return app


async def authorize_application(session: AsyncSession, user: User, app: Application, permission: str) -> None:
    if app.business_id is None:
        if app.owner_id != user.id:
            raise not_found("Application")
        return
    from app.models import Business, BusinessMember
    from app.services.permissions import permissions_for

    member = (await session.execute(
        select(BusinessMember).where(BusinessMember.business_id == app.business_id,
                                     BusinessMember.user_id == user.id, BusinessMember.status == "active")
    )).scalar_one_or_none()
    business = await session.get(Business, app.business_id)
    if member is None or business is None or business.deleted_at is not None:
        raise not_found("Application")
    if permission not in permissions_for(member.role, member.extra_permissions):
        raise AppError(403, "insufficient_permissions", f"Your role does not allow this action ({permission})",
                       {"required": permission})


def developer_app_ids(user_id: uuid.UUID):  # type: ignore[no-untyped-def]
    """Subquery: the developer's own (non-business) application ids — used by developer listings."""
    return select(Application.id).where(Application.owner_id == user_id, Application.business_id.is_(None))


async def check_endpoint_url(url: str | None, field: str = "body.url") -> str | None:
    if url is None or url.strip() == "":
        return None
    try:
        return await validate_endpoint_url(url)
    except InvalidEndpointURL as exc:
        raise validation_error(field, str(exc)) from exc


def set_webhook_secret(app: Application, secret: str) -> None:
    app.webhook_secret_encrypted = encrypt_secret(secret)
    app.webhook_secret_last4 = secret[-4:]
    app.webhook_secret_rotated_at = datetime.now(UTC)


def new_api_key(app: Application, name: str) -> tuple[ApiKey, str]:
    plaintext = generate_api_key()
    key = ApiKey(
        application_id=app.id,
        owner_id=app.owner_id,
        name=name.strip() or "Default key",
        key_hash=sha256_hex(plaintext),
        prefix=api_key_display_prefix(plaintext),
        last4=plaintext[-4:],
    )
    key.application = app
    return key, plaintext


async def revoke_application_credentials(session: AsyncSession, app: Application) -> None:
    now = datetime.now(UTC)
    await session.execute(
        update(ApiKey)
        .where(ApiKey.application_id == app.id, ApiKey.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    await session.execute(
        update(Device)
        .where(Device.application_id == app.id, Device.status == "active")
        .values(status="revoked", revoked_at=now)
    )
