from __future__ import annotations

import uuid

from fastapi import APIRouter, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, ClientDep, PaginationDep, SessionDep
from app.core.errors import AppError, not_found, validation_error
from app.models import AllowedOrigin, Application, Device, NfcEvent, User
from app.schemas.auth import AdminStatsOut, AdminUserUpdateIn, UserOut
from app.schemas.common import Page
from app.schemas.resources import AllowedOriginCreateIn, AllowedOriginOut, AllowedOriginsOut
from app.services import audit, origins
from app.services.serializers import user_out

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/users", response_model=Page[UserOut], summary="List all users")
async def list_users(admin: AdminUser, session: SessionDep, pagination: PaginationDep) -> Page[UserOut]:
    total = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    users = (
        await session.execute(
            select(User).order_by(User.created_at.desc(), User.id)
            .offset(pagination.offset).limit(pagination.page_size)
        )
    ).scalars()
    return Page[UserOut](
        items=[user_out(u) for u in users], total=total, page=pagination.page, page_size=pagination.page_size
    )


@router.patch("/users/{user_id}", response_model=UserOut, summary="Activate / deactivate a user")
async def update_user(
    user_id: uuid.UUID, body: AdminUserUpdateIn, admin: AdminUser, session: SessionDep, client: ClientDep
) -> UserOut:
    user = await session.get(User, user_id)
    if user is None:
        raise not_found("User")
    if user.id == admin.id and not body.is_active:
        raise AppError(400, "cannot_deactivate_self", "You cannot deactivate your own account")
    user.is_active = body.is_active
    audit.record(session, action="admin.user_update", user_id=admin.id, client=client,
                 resource_type="user", resource_id=user.id, metadata={"is_active": body.is_active})
    await session.commit()
    return user_out(user)


@router.get("/stats", response_model=AdminStatsOut, summary="Platform statistics")
async def stats(admin: AdminUser, session: SessionDep) -> AdminStatsOut:
    async def count(stmt) -> int:  # type: ignore[no-untyped-def]
        return int((await session.execute(stmt)).scalar_one())

    return AdminStatsOut(
        users=await count(select(func.count()).select_from(User)),
        applications=await count(
            select(func.count()).select_from(Application).where(Application.deleted_at.is_(None))
        ),
        devices=await count(
            select(func.count()).select_from(Device).where(Device.deleted_at.is_(None), Device.status == "active")
        ),
        events_total=await count(select(func.count()).select_from(NfcEvent)),
    )


# ── Allowed CORS origins (contract 7.2) ──────────────────────────────────
@router.get(
    "/allowed-origins",
    response_model=AllowedOriginsOut,
    summary="Allowed browser origins (env + database)",
    description="`env` comes from `CORS_ORIGINS` and is read-only; `items` are managed here.",
)
async def list_allowed_origins(admin: AdminUser, session: SessionDep) -> AllowedOriginsOut:
    rows = await session.execute(
        select(AllowedOrigin, User.email)
        .outerjoin(User, User.id == AllowedOrigin.created_by)
        .order_by(AllowedOrigin.created_at)
    )
    items = [
        AllowedOriginOut.model_validate(r).model_copy(update={"created_by_email": email}) for r, email in rows
    ]
    return AllowedOriginsOut(env=origins.env_origins(), items=items)


@router.post("/allowed-origins", status_code=201, response_model=AllowedOriginOut, summary="Allow a browser origin")
async def create_allowed_origin(
    body: AllowedOriginCreateIn, admin: AdminUser, session: SessionDep, client: ClientDep
) -> AllowedOriginOut:
    try:
        origin = origins.normalize_origin(body.origin)
    except ValueError as exc:
        raise validation_error("body.origin", str(exc)) from exc
    exists = (await session.execute(select(AllowedOrigin.id).where(AllowedOrigin.origin == origin))).first()
    if exists or origin in origins.env_origins():
        raise AppError(409, "origin_exists", f"{origin} is already allowed")
    row = AllowedOrigin(origin=origin, note=(body.note or "").strip() or None, created_by=admin.id)
    session.add(row)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise AppError(409, "origin_exists", f"{origin} is already allowed")
    audit.record(session, action="allowed_origin.create", user_id=admin.id, client=client,
                 resource_type="allowed_origin", resource_id=row.id, metadata={"origin": origin})
    await session.commit()
    await origins.reload()  # effective immediately in this process
    return AllowedOriginOut.model_validate(row).model_copy(update={"created_by_email": admin.email})


@router.delete("/allowed-origins/{origin_id}", status_code=204, summary="Remove an allowed browser origin")
async def delete_allowed_origin(
    origin_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep
) -> Response:
    row = await session.get(AllowedOrigin, origin_id)
    if row is None:
        raise not_found("Allowed origin")
    audit.record(session, action="allowed_origin.delete", user_id=admin.id, client=client,
                 resource_type="allowed_origin", resource_id=row.id, metadata={"origin": row.origin})
    await session.delete(row)
    await session.commit()
    await origins.reload()
    return Response(status_code=204)
