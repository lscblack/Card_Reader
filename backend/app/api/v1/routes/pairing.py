"""Dashboard side of QR pairing codes (contract 7.3)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Response
from sqlalchemy import select

from app.api.deps import ClientDep, CurrentUser, SessionDep, platform_only
from app.core.errors import AppError, not_found
from app.models import Device, PairingCode, User
from app.services.applications import authorize_application
from app.schemas.resources import PairingCodeStatusOut
from app.services import audit
from app.services.serializers import device_out

router = APIRouter(prefix="/pairing-codes", tags=["Applications"], dependencies=platform_only)


async def _owned(session: SessionDep, user: User, code_id: uuid.UUID) -> PairingCode:
    row = (await session.execute(select(PairingCode).where(PairingCode.id == code_id))).scalar_one_or_none()
    if row is None:
        raise not_found("Pairing code")
    try:
        await authorize_application(session, user, row.application, "devices.manage")
    except AppError as exc:
        if exc.code == "not_found":
            raise not_found("Pairing code") from None
        raise
    return row


@router.get(
    "/{code_id}",
    response_model=PairingCodeStatusOut,
    summary="Pairing code status (poll to show 'Paired')",
)
async def get_pairing_code(code_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> PairingCodeStatusOut:
    row = await _owned(session, user, code_id)
    device = await session.get(Device, row.device_id) if row.device_id else None
    return PairingCodeStatusOut(
        id=row.id,
        application_id=row.application_id,
        status=row.status_at(datetime.now(UTC)),  # type: ignore[arg-type]
        expires_at=row.expires_at,
        used_at=row.used_at,
        device=device_out(device) if device is not None else None,
    )


@router.post("/{code_id}/cancel", status_code=204, summary="Cancel a pairing code (marks it expired)")
async def cancel_pairing_code(
    code_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep
) -> Response:
    row = await _owned(session, user, code_id)
    if row.used_at is None and row.cancelled_at is None:
        row.cancelled_at = datetime.now(UTC)
        audit.record(session, action="pairing_code.cancel", user_id=user.id, client=client,
                     resource_type="pairing_code", resource_id=row.id,
                     metadata={"application_id": str(row.application_id)})
        await session.commit()
    return Response(status_code=204)
