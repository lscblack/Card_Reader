from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import ClientDep, CurrentUser, SessionDep, platform_only
from app.core.errors import not_found
from app.models import ApiKey, Application
from app.schemas.resources import ApiKeyCreatedOut, ApiKeyCreateIn, ApiKeyOut
from app.services import audit
from app.services.applications import authorize_application, get_owned_application, new_api_key
from app.services.serializers import api_key_out

router = APIRouter(prefix="/api-keys", tags=["API keys"], dependencies=platform_only)


@router.get("", response_model=list[ApiKeyOut], summary="List API keys")
async def list_api_keys(
    user: CurrentUser, session: SessionDep, application_id: uuid.UUID | None = Query(default=None)
) -> list[ApiKeyOut]:
    stmt = (
        select(ApiKey)
        .join(Application, Application.id == ApiKey.application_id)
        .where(Application.deleted_at.is_(None))
        .order_by(ApiKey.created_at.desc())
    )
    if application_id is not None:
        # Business applications are listed for members with api.view (§B8).
        await get_owned_application(session, user, application_id, permission="api.view")
        stmt = stmt.where(ApiKey.application_id == application_id)
    else:
        stmt = stmt.where(ApiKey.owner_id == user.id, Application.business_id.is_(None))
    keys = (await session.execute(stmt)).scalars().unique()
    return [api_key_out(k) for k in keys]


@router.post(
    "",
    status_code=201,
    response_model=ApiKeyCreatedOut,
    summary="Create an API key",
    description="The `plaintext` key is returned **once**; only its SHA-256 hash is stored.",
)
async def create_api_key(
    body: ApiKeyCreateIn, user: CurrentUser, session: SessionDep, client: ClientDep
) -> ApiKeyCreatedOut:
    app = await get_owned_application(session, user, body.application_id)
    key, plaintext = new_api_key(app, body.name)
    session.add(key)
    await session.flush()
    audit.record(session, action="api_key.create", user_id=user.id, client=client,
                 resource_type="api_key", resource_id=key.id,
                 metadata={"application_id": str(app.id), "name": key.name, "prefix": key.prefix})
    await session.commit()
    return ApiKeyCreatedOut(api_key=api_key_out(key), plaintext=plaintext)


@router.post("/{key_id}/revoke", response_model=ApiKeyOut, summary="Revoke an API key (immediate)")
async def revoke_api_key(key_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep) -> ApiKeyOut:
    key = (await session.execute(select(ApiKey).where(ApiKey.id == key_id))).scalar_one_or_none()
    if key is None:
        raise not_found("API key")
    await authorize_application(session, user, key.application, "api.manage")
    if key.revoked_at is None:
        key.revoked_at = datetime.now(UTC)
        audit.record(session, action="api_key.revoke", user_id=user.id, client=client,
                     resource_type="api_key", resource_id=key.id,
                     metadata={"application_id": str(key.application_id), "prefix": key.prefix})
        await session.commit()
    return api_key_out(key)
