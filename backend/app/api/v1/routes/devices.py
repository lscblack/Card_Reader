"""Dashboard device management."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Query, Response
from sqlalchemy import select

from app.api.deps import ClientDep, CurrentUser, SessionDep, platform_only
from app.core.errors import AppError, not_found
from app.models import Device, User
from app.schemas.resources import DeviceOut, DeviceRenameIn
from app.services import audit
from app.services.applications import authorize_application, developer_app_ids, get_owned_application
from app.services.serializers import device_out
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/devices", tags=["Devices"], dependencies=platform_only)


async def _get_owned_device(
    session: AsyncSession, user: User, device_id: uuid.UUID, permission: str = "devices.manage"
) -> Device:
    device = (
        await session.execute(select(Device).where(Device.id == device_id, Device.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if device is None:
        raise not_found("Device")
    try:
        await authorize_application(session, user, device.application, permission)
    except AppError as exc:
        if exc.code == "not_found":
            raise not_found("Device") from None
        raise
    return device


@router.get("", response_model=list[DeviceOut], summary="List devices")
async def list_devices(
    user: CurrentUser,
    session: SessionDep,
    application_id: uuid.UUID | None = Query(default=None),
    status: Literal["active", "revoked"] | None = Query(default=None),
) -> list[DeviceOut]:
    stmt = select(Device).where(Device.deleted_at.is_(None)).order_by(Device.created_at.desc())
    if application_id is not None:
        await get_owned_application(session, user, application_id, permission="business.view")
        stmt = stmt.where(Device.application_id == application_id)
    else:
        stmt = stmt.where(Device.owner_id == user.id, Device.application_id.in_(developer_app_ids(user.id)))
    if status is not None:
        stmt = stmt.where(Device.status == status)
    return [device_out(d) for d in (await session.execute(stmt)).scalars().unique()]


@router.get("/{device_id}", response_model=DeviceOut, summary="Get a device")
async def get_device(device_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> DeviceOut:
    return device_out(await _get_owned_device(session, user, device_id, "business.view"))


@router.patch("/{device_id}", response_model=DeviceOut, summary="Rename a device")
async def rename_device(
    device_id: uuid.UUID, body: DeviceRenameIn, user: CurrentUser, session: SessionDep, client: ClientDep
) -> DeviceOut:
    device = await _get_owned_device(session, user, device_id)
    old = device.name
    device.name = body.name.strip() or device.name
    audit.record(session, action="device.rename", user_id=user.id, client=client,
                 resource_type="device", resource_id=device.id, metadata={"from": old, "to": device.name})
    await session.commit()
    return device_out(device)


@router.post("/{device_id}/revoke", response_model=DeviceOut, summary="Revoke a device (token stops working immediately)")
async def revoke_device(device_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep) -> DeviceOut:
    device = await _get_owned_device(session, user, device_id)
    if device.status != "revoked":
        device.status = "revoked"
        device.revoked_at = datetime.now(UTC)
        audit.record(session, action="device.revoke", user_id=user.id, client=client,
                     resource_type="device", resource_id=device.id, metadata={"name": device.name})
        await session.commit()
    return device_out(device)


@router.delete("/{device_id}", status_code=204, summary="Delete a device")
async def delete_device(device_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep) -> Response:
    device = await _get_owned_device(session, user, device_id)
    now = datetime.now(UTC)
    device.status = "revoked"
    device.revoked_at = device.revoked_at or now
    device.deleted_at = now  # soft delete: its event history is kept
    audit.record(session, action="device.delete", user_id=user.id, client=client,
                 resource_type="device", resource_id=device.id, metadata={"name": device.name})
    await session.commit()
    return Response(status_code=204)
