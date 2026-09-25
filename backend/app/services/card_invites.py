"""Business-issued employee digital cards (Part 4 §6)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import Business, DigitalCard, DigitalCardInvite, Employee, User
from app.services import audit, personal
from app.services.audit import ClientInfo

DEFAULT_LOCKED = ["company"]


async def accept(session: AsyncSession, invite: DigitalCardInvite, user: User, client: ClientInfo | None) -> DigitalCard:
    now = datetime.now(UTC)
    if invite.status_at(now) != "pending":
        raise AppError(410, "card_invite_unavailable", "This card invitation is no longer available")
    if invite.email.lower() != user.email.lower():
        raise AppError(403, "invitation_email_mismatch", "This invitation was sent to a different email address")
    business = await session.get(Business, invite.business_id)
    employee = await session.get(Employee, invite.employee_id)
    if business is None or business.deleted_at is not None or employee is None:
        raise AppError(410, "card_invite_unavailable", "The business or employee no longer exists")
    fields = {"full_name": employee.full_name or user.full_name, "job_title": employee.position,
              "company": business.name, "department": employee.department,
              "phones": [{"label": "Work", "value": employee.phone}] if employee.phone else [],
              "emails": [{"label": "Work", "value": employee.email or user.email}],
              "websites": [{"label": "Website", "url": business.website}] if business.website else [],
              "socials": [{"platform": s.get("platform", "other"), "url": s["url"]}
                          for s in (employee.social_links or []) if s.get("url", "").startswith("http")]}
    card = await personal.new_card(session, user, label=business.name[:60], template_id=invite.template_id,
                                   fields={k: v for k, v in fields.items() if v not in (None, "")},
                                   design=invite.design or {})
    card.business_id, card.employee_id, card.linked_at = business.id, employee.id, now
    card.locked_fields = list(invite.locked_fields or DEFAULT_LOCKED)
    card.template_locked = bool(invite.template_id or invite.design)
    card.logo_path = business.logo_path
    card.photo_path = employee.photo_path
    invite.accepted_at, invite.user_id, invite.card_id = now, user.id, card.id
    audit.record(session, action="digital_card.invite_accept", user_id=user.id, client=client,
                 resource_type="digital_card", resource_id=card.id,
                 metadata={"business_id": str(business.id), "employee_id": str(employee.id)})
    await session.flush()
    return card


async def by_token(session: AsyncSession, token_hash: str) -> DigitalCardInvite | None:
    return (await session.execute(select(DigitalCardInvite).where(DigitalCardInvite.token_hash == token_hash)
                                  .with_for_update(of=DigitalCardInvite))).scalar_one_or_none()
