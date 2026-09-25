"""Team membership & invitations (Part 2 §B9)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import Business, BusinessInvitation, BusinessMember, User
from app.services import audit
from app.services.audit import ClientInfo


async def active_owner_count(session: AsyncSession, business_id) -> int:  # type: ignore[no-untyped-def]
    return int((await session.execute(
        select(func.count()).select_from(BusinessMember).where(
            BusinessMember.business_id == business_id, BusinessMember.role == "owner",
            BusinessMember.status == "active")
    )).scalar_one())


async def accept_invitation(
    session: AsyncSession, invitation: BusinessInvitation, user: User, client: ClientInfo | None,
) -> BusinessMember:
    """Adds the user to the business with the invited role (caller validated status + email)."""
    from app.services.business import ensure_business_limit

    business = await session.get(Business, invitation.business_id)
    if business is None or business.deleted_at is not None:
        raise AppError(410, "invitation_unavailable", "This business no longer exists")
    existing = (await session.execute(
        select(BusinessMember).where(BusinessMember.business_id == business.id, BusinessMember.user_id == user.id)
    )).scalar_one_or_none()
    if existing is not None and existing.status == "active":
        raise AppError(409, "already_member", "You are already a member of this business")
    await ensure_business_limit(session, business, "members")
    now = datetime.now(UTC)
    if existing is not None:
        existing.status, existing.role, member = "active", invitation.role, existing
    else:
        member = BusinessMember(business_id=business.id, user_id=user.id, role=invitation.role,
                                extra_permissions=[], status="active", joined_at=now)
        session.add(member)
    invitation.accepted_at = now
    invitation.accepted_by = user.id
    audit.record(session, action="invitation.accept", user_id=user.id, client=client,
                 resource_type="business", resource_id=business.id,
                 metadata={"invitation_id": str(invitation.id), "role": invitation.role})
    await session.flush()
    return member
