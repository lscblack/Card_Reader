"""Team members & invitations (Part 2 §B9)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy import select

from app.api.deps import BusinessContext, ClientDep, CurrentUser, SessionDep, business_permission
from app.core.errors import AppError, not_found, validation_error
from app.core.security import generate_reset_token, sha256_hex
from app.models import Business, BusinessInvitation, BusinessMember, User
from app.schemas.business import (
    InvitationIn,
    InvitationOut,
    MemberOut,
    MemberUpdateIn,
    PublicInvitationOut,
)
from app.services import audit, email
from app.services import business as biz
from app.services import team as team_service
from app.services.business_serializers import invitation_out, member_out
from app.services.permissions import GRANTABLE, ROLES

router = APIRouter(prefix="/businesses/{business_id}", tags=["Team"])
public_router = APIRouter(prefix="/invitations", tags=["Team"])

View = Annotated[BusinessContext, Depends(business_permission("business.view"))]
TeamManage = Annotated[BusinessContext, Depends(business_permission("team.manage"))]

INVITE_TTL = timedelta(days=7)


def _check_role_change(ctx: BusinessContext, target_role: str | None, new_role: str | None) -> None:
    """Only owners manage owners; admins manage everyone else."""
    if ctx.role == "owner":
        return
    if target_role == "owner" or new_role == "owner":
        raise AppError(403, "owner_required", "Only owners can manage owners")


@router.get("/members", response_model=list[MemberOut], summary="Team members")
async def list_members(ctx: View, session: SessionDep) -> list[MemberOut]:
    rows = (await session.execute(
        select(BusinessMember, User).join(User, User.id == BusinessMember.user_id)
        .where(BusinessMember.business_id == ctx.business.id).order_by(BusinessMember.joined_at)
    )).all()
    return [member_out(m, u) for m, u in rows]


@router.patch("/members/{member_id}", response_model=MemberOut, summary="Change role / permissions / status")
async def update_member(member_id: uuid.UUID, body: MemberUpdateIn, ctx: TeamManage, session: SessionDep,
                        client: ClientDep) -> MemberOut:
    member = await session.get(BusinessMember, member_id)
    if member is None or member.business_id != ctx.business.id:
        raise not_found("Member")
    if member.user_id == ctx.user.id:
        raise AppError(403, "cannot_edit_own_role", "You cannot change your own role, permissions or status")
    _check_role_change(ctx, member.role, body.role)
    data = body.model_dump(exclude_unset=True)
    demoting_owner = member.role == "owner" and member.status == "active" and (
        (body.role is not None and body.role != "owner") or body.status == "suspended")
    if demoting_owner and await team_service.active_owner_count(session, ctx.business.id) <= 1:
        raise AppError(409, "last_owner", "A business must keep at least one active owner")
    if body.role is not None:
        member.role = body.role
    if body.extra_permissions is not None:
        bad = [p for p in body.extra_permissions if p not in GRANTABLE]
        if bad:
            raise validation_error("body.extra_permissions", f"not grantable: {', '.join(bad)}")
        member.extra_permissions = sorted(set(body.extra_permissions))
    if body.status is not None:
        member.status = body.status
    audit.record(session, action="member.update", user_id=ctx.user.id, client=client, resource_type="member",
                 resource_id=member.id, metadata={k: v for k, v in data.items()})
    await session.commit()
    user = await session.get(User, member.user_id)
    assert user is not None
    return member_out(member, user)


@router.delete("/members/{member_id}", status_code=204, summary="Remove a member (or leave, for yourself)")
async def remove_member(member_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep,
                        business_id: uuid.UUID, request: Request) -> Response:
    from app.api.deps import load_business_context

    ctx = await load_business_context(session, user, business_id, request)
    member = await session.get(BusinessMember, member_id)
    if member is None or member.business_id != business_id:
        raise not_found("Member")
    if member.user_id != user.id:  # leaving yourself needs no permission
        ctx.require("team.manage")
        _check_role_change(ctx, member.role, None)
    if member.role == "owner" and member.status == "active" and \
            await team_service.active_owner_count(session, business_id) <= 1:
        raise AppError(409, "last_owner", "A business must keep at least one active owner")
    audit.record(session, action="member.remove", user_id=user.id, client=client, resource_type="member",
                 resource_id=member.id, metadata={"user_id": str(member.user_id), "role": member.role})
    await session.delete(member)
    await session.commit()
    return Response(status_code=204)


# ── Invitations ─────────────────────────────────────────────────────────
@router.get("/invitations", response_model=list[InvitationOut], summary="Invitations")
async def list_invitations(ctx: TeamManage, session: SessionDep) -> list[InvitationOut]:
    now = datetime.now(UTC)
    rows = (await session.execute(select(BusinessInvitation).where(BusinessInvitation.business_id == ctx.business.id)
                                  .order_by(BusinessInvitation.created_at.desc()))).scalars()
    return [invitation_out(i, now) for i in rows]


async def _send(session: SessionDep, inv: BusinessInvitation, business: Business, background: BackgroundTasks,
                inviter: User | None = None) -> str | None:
    token = generate_reset_token()
    inv.token_hash = sha256_hex(token)
    inv.expires_at = datetime.now(UTC) + INVITE_TTL
    background.add_task(email.send_invitation, inv.email, business.name, inv.role, token,
                        inviter.full_name if inviter else None)
    return email.invitation_link(token) if email.expose_dev_links() else None


@router.post("/invitations", status_code=201, response_model=InvitationOut, summary="Invite someone by email")
async def create_invitation(body: InvitationIn, ctx: TeamManage, session: SessionDep, client: ClientDep,
                            background: BackgroundTasks) -> InvitationOut:
    if body.role not in ROLES:
        raise validation_error("body.role", "unknown role")
    _check_role_change(ctx, None, body.role)
    addr = body.email.strip().lower()
    if "@" not in addr:
        raise validation_error("body.email", "a valid email is required")
    now = datetime.now(UTC)
    already = (await session.execute(
        select(BusinessMember.id).join(User, User.id == BusinessMember.user_id)
        .where(BusinessMember.business_id == ctx.business.id, User.email == addr, BusinessMember.status == "active")
    )).first()
    if already:
        raise AppError(409, "already_member", "This person is already a member")
    pending = (await session.execute(select(BusinessInvitation).where(
        BusinessInvitation.business_id == ctx.business.id, BusinessInvitation.email == addr,
        BusinessInvitation.accepted_at.is_(None), BusinessInvitation.revoked_at.is_(None),
        BusinessInvitation.expires_at > now))).first()
    if pending:
        raise AppError(409, "invitation_exists", "A pending invitation for this email already exists")
    await biz.ensure_business_limit(session, ctx.business, "members")
    inv = BusinessInvitation(business_id=ctx.business.id, email=addr, role=body.role, invited_by=ctx.user.id,
                             token_hash="", expires_at=now)
    dev_url = await _send(session, inv, ctx.business, background, ctx.user)
    session.add(inv)
    await session.flush()
    audit.record(session, action="invitation.create", user_id=ctx.user.id, client=client, resource_type="invitation",
                 resource_id=inv.id, metadata={"email": addr, "role": body.role})
    await session.commit()
    await session.refresh(inv)
    return invitation_out(inv, datetime.now(UTC), dev_url)


async def _get_inv(session: SessionDep, business_id: uuid.UUID, invitation_id: uuid.UUID) -> BusinessInvitation:
    inv = await session.get(BusinessInvitation, invitation_id)
    if inv is None or inv.business_id != business_id:
        raise not_found("Invitation")
    return inv


@router.post("/invitations/{invitation_id}/revoke", response_model=InvitationOut, summary="Revoke an invitation")
async def revoke_invitation(invitation_id: uuid.UUID, ctx: TeamManage, session: SessionDep,
                            client: ClientDep) -> InvitationOut:
    inv = await _get_inv(session, ctx.business.id, invitation_id)
    _check_role_change(ctx, inv.role, None)
    if inv.accepted_at is None and inv.revoked_at is None:
        inv.revoked_at = datetime.now(UTC)
        audit.record(session, action="invitation.revoke", user_id=ctx.user.id, client=client,
                     resource_type="invitation", resource_id=inv.id, metadata={"email": inv.email})
        await session.commit()
    return invitation_out(inv, datetime.now(UTC))


@router.post("/invitations/{invitation_id}/resend", response_model=InvitationOut,
             summary="Resend (new link, expiry reset to 7 days)")
async def resend_invitation(invitation_id: uuid.UUID, ctx: TeamManage, session: SessionDep, client: ClientDep,
                            background: BackgroundTasks) -> InvitationOut:
    inv = await _get_inv(session, ctx.business.id, invitation_id)
    _check_role_change(ctx, inv.role, None)
    if inv.accepted_at is not None or inv.revoked_at is not None:
        raise AppError(410, "invitation_unavailable", "This invitation was already accepted or revoked")
    dev_url = await _send(session, inv, ctx.business, background, ctx.user)
    audit.record(session, action="invitation.resend", user_id=ctx.user.id, client=client,
                 resource_type="invitation", resource_id=inv.id, metadata={"email": inv.email})
    await session.commit()
    return invitation_out(inv, datetime.now(UTC), dev_url)


# ── Public invitation endpoints ─────────────────────────────────────────
async def _by_token(session: SessionDep, token: str, lock: bool = False) -> BusinessInvitation:
    stmt = select(BusinessInvitation).where(BusinessInvitation.token_hash == sha256_hex(token))
    if lock:
        stmt = stmt.with_for_update(of=BusinessInvitation)
    inv = (await session.execute(stmt)).scalar_one_or_none()
    if inv is None:
        raise AppError(410, "invitation_unavailable", "This invitation is invalid or has expired")
    return inv


@public_router.get("/{token}", response_model=PublicInvitationOut, summary="Invitation details (public)")
async def public_invitation(token: str, session: SessionDep, request: Request) -> PublicInvitationOut:
    from app.services.request_logs import set_actor

    set_actor(request, "public")
    inv = await _by_token(session, token)
    request.state.business_id = inv.business_id
    return PublicInvitationOut(business_name=inv.business.name, role=inv.role,  # type: ignore[arg-type]
                               email=inv.email, expires_at=inv.expires_at,
                               status=inv.status_at(datetime.now(UTC)))  # type: ignore[arg-type]


@public_router.post("/{token}/accept", response_model=MemberOut, summary="Accept an invitation (logged in)")
async def accept_invitation(token: str, user: CurrentUser, session: SessionDep, client: ClientDep,
                            request: Request) -> MemberOut:
    inv = await _by_token(session, token, lock=True)
    request.state.business_id = inv.business_id
    if inv.status_at(datetime.now(UTC)) != "pending":
        raise AppError(410, "invitation_unavailable", "This invitation was revoked, expired or already accepted")
    if inv.email.lower() != user.email.lower():
        raise AppError(403, "invitation_email_mismatch", "This invitation was sent to a different email address")
    member = await team_service.accept_invitation(session, inv, user, client)
    await session.commit()
    return member_out(member, user)
