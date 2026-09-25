"""ORM → schema conversion for Part 2 objects (batch-loaded; no N+1)."""

from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_catalog import ref_for
from app.models import (
    Business,
    BusinessInvitation,
    BusinessMember,
    Card,
    CardTap,
    Customer,
    Employee,
    Profile,
    RequestLog,
    SandboxEndpoint,
    SandboxRequest,
    User,
)
from app.schemas.business import (
    BusinessOut,
    BusinessSettings,
    CardOut,
    CardSummary,
    CardTapOut,
    CustomerOut,
    EmployeeOut,
    InvitationOut,
    MemberOut,
    ProfileOut,
    RequestLogOut,
    SandboxEndpointOut,
    SandboxRequestOut,
)
from app.services import sandbox as sandbox_service
from app.services.business import (
    DEFAULT_SETTINGS,
    assignee_of,
    business_public_url,
    card_effective_status,
    mask_uid,
    media_url,
    tap_url,
)
from app.services.permissions import ordered, permissions_for
from app.services.serializers import plan_out


def business_out(b: Business, role: str | None = None) -> BusinessOut:
    settings_ = {**DEFAULT_SETTINGS, **(b.settings or {})}
    return BusinessOut(
        id=b.id, name=b.name, slug=b.slug, email=b.email, phone=b.phone, country=b.country, category=b.category,
        description=b.description, website=b.website, address=b.address, logo_url=media_url(b.logo_path),
        status=b.status,  # type: ignore[arg-type]
        verified=b.verified, settings=BusinessSettings(**settings_),
        plan=plan_out(b.plan) if b.plan else None, public_url=business_public_url(b), role=role,  # type: ignore[arg-type]
        created_at=b.created_at,
    )


def card_summary(card: Card, business: Business) -> CardSummary:
    return CardSummary(id=card.id, name=card.name, kind=card.kind, status=card.status,
                       effective_status=card_effective_status(card, business), public_code=card.public_code)


def card_out(card: Card, business: Business) -> CardOut:
    assignee = assignee_of(card)
    return CardOut(
        id=card.id, business_id=card.business_id, kind=card.kind,  # type: ignore[arg-type]
        name=card.name, uid=card.uid, uid_masked=mask_uid(card.uid), public_code=card.public_code,
        tap_url=tap_url(card.public_code), status=card.status,  # type: ignore[arg-type]
        effective_status=card_effective_status(card, business),
        assignee=({k: v for k, v in assignee.items() if k != "position"} if assignee else None),
        profile_id=card.profile_id, action=card.action, programmed=card.programmed_at is not None,
        programmed_at=card.programmed_at, total_taps=card.total_taps, unique_visitors=card.unique_visitors,
        last_tap_at=card.last_tap_at, created_at=card.created_at,
    )


async def _cards_by(session: AsyncSession, column: Any, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Card]]:
    out: dict[uuid.UUID, list[Card]] = defaultdict(list)
    if not ids:
        return out
    rows = (await session.execute(
        select(Card).where(column.in_(ids), Card.deleted_at.is_(None)).order_by(Card.created_at)
    )).scalars().unique()
    for card in rows:
        out[getattr(card, column.key)].append(card)
    return out


async def employees_out(session: AsyncSession, business: Business, employees: list[Employee]) -> list[EmployeeOut]:
    ids = [e.id for e in employees]
    cards = await _cards_by(session, Card.employee_id, ids)
    profiles: dict[uuid.UUID, Profile] = {}
    if ids:
        for p in (await session.execute(
            select(Profile).where(Profile.employee_id.in_(ids), Profile.deleted_at.is_(None))
        )).scalars():
            profiles[p.employee_id] = p  # type: ignore[index]
    digital = await _employee_digital_cards(session, ids)
    out = []
    for e in employees:
        prof = profiles.get(e.id)
        out.append(EmployeeOut(
            id=e.id, business_id=e.business_id, first_name=e.first_name, last_name=e.last_name,
            full_name=e.full_name, photo_url=media_url(e.photo_path), position=e.position, department=e.department,
            phone=e.phone, email=e.email, social_links=list(e.social_links or []), slug=e.slug,
            status=e.status,  # type: ignore[arg-type]
            profile_published=bool(prof and prof.published and e.status == "active"),
            profile_id=prof.id if prof else None,
            public_url=business_public_url(business, prof.slug if prof else e.slug),
            cards=[card_summary(c, business) for c in cards.get(e.id, [])],
            total_taps=e.total_taps, last_tap_at=e.last_tap_at, created_at=e.created_at,
            digital_card=digital.get(e.id),
        ))
    return out


async def _employee_digital_cards(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    """Latest digital-card invitation per employee → {status, user_email, accepted_at} (Part 4 §6)."""
    from datetime import UTC, datetime

    from app.models import DigitalCard, DigitalCardInvite
    from app.services.personal import effective_status

    if not ids:
        return {}
    rows = (await session.execute(select(DigitalCardInvite).where(DigitalCardInvite.employee_id.in_(ids))
                                  .order_by(DigitalCardInvite.created_at.desc()))).scalars().all()
    latest: dict[uuid.UUID, Any] = {}
    for inv in rows:
        if inv.status_at(datetime.now(UTC)) != "revoked":
            latest.setdefault(inv.employee_id, inv)
    card_ids = [i.card_id for i in latest.values() if i.card_id]
    cards = {c.id: c for c in (await session.execute(select(DigitalCard).where(DigitalCard.id.in_(card_ids))))
             .scalars().unique()} if card_ids else {}
    out = {}
    for eid, inv in latest.items():
        status = inv.status_at(datetime.now(UTC))
        card = cards.get(inv.card_id) if inv.card_id else None
        if status == "accepted":
            status = effective_status(card) if card is not None and card.deleted_at is None else "removed"
        elif status == "pending":
            status = "invited"
        out[eid] = {"status": status, "user_email": inv.email,
                    "accepted_at": inv.accepted_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
                    if inv.accepted_at else None}
    return out


async def customers_out(session: AsyncSession, business: Business, customers: list[Customer]) -> list[CustomerOut]:
    cards = await _cards_by(session, Card.customer_id, [c.id for c in customers])
    return [
        CustomerOut(
            id=c.id, business_id=c.business_id, full_name=c.full_name, email=c.email, phone=c.phone,
            company=c.company, notes=c.notes, tags=list(c.tags or []), status=c.status,  # type: ignore[arg-type]
            cards=[card_summary(x, business) for x in cards.get(c.id, [])], total_taps=c.total_taps,
            last_tap_at=c.last_tap_at, created_at=c.created_at,
        )
        for c in customers
    ]


def profile_out(p: Profile, business: Business) -> ProfileOut:
    url = business_public_url(business) if p.type == "business" else business_public_url(business, p.slug)
    return ProfileOut(
        id=p.id, business_id=p.business_id, type=p.type,  # type: ignore[arg-type]
        slug=p.slug, title=p.title, employee_id=p.employee_id, published=p.published, theme=dict(p.theme or {}),
        sections=list(p.sections or []), public_url=url, updated_at=p.updated_at,
    )


def tap_out(t: CardTap) -> CardTapOut:
    assignee = ({"type": t.assignee_type, "id": t.assignee_id, "name": t.assignee_name}
                if t.assignee_type else None)
    return CardTapOut(
        id=t.id, business_id=t.business_id, card_id=t.card_id, card_name=t.card_name, card_kind=t.card_kind,
        assignee=assignee, source=t.source,  # type: ignore[arg-type]
        action_type=t.action_type, result=t.result, device_id=t.device_id, device_name=t.device_name,
        nfc_event_id=t.nfc_event_id, visitor_hash=t.visitor_hash, device_type=t.device_type, browser=t.browser,
        country=t.country, is_bot=t.is_bot, created_at=t.created_at,
    )


def member_out(m: BusinessMember, user: User) -> MemberOut:
    return MemberOut(
        id=m.id, user_id=m.user_id, full_name=user.full_name, email=user.email, role=m.role,  # type: ignore[arg-type]
        extra_permissions=list(m.extra_permissions or []),
        permissions=ordered(permissions_for(m.role, m.extra_permissions)),
        status=m.status,  # type: ignore[arg-type]
        joined_at=m.joined_at, last_active_at=m.last_active_at,
    )


def invitation_out(inv: BusinessInvitation, now: Any, dev_url: str | None = None) -> InvitationOut:
    return InvitationOut(
        id=inv.id, email=inv.email, role=inv.role, status=inv.status_at(now),  # type: ignore[arg-type]
        invited_by=inv.invited_by, expires_at=inv.expires_at, created_at=inv.created_at, dev_invite_url=dev_url,
    )


def sandbox_endpoint_out(e: SandboxEndpoint) -> SandboxEndpointOut:
    return SandboxEndpointOut(
        id=e.id, name=e.name, url=sandbox_service.sandbox_url(e.token), token=e.token,
        application_id=e.application_id, business_id=e.business_id, response_status=e.response_status,
        response_delay_ms=e.response_delay_ms, response_body=e.response_body,
        response_headers=dict(e.response_headers or {}), request_count=int(e.request_count or 0),
        last_request_at=e.last_request_at, created_at=e.created_at,
    )


def sandbox_request_out(r: SandboxRequest) -> SandboxRequestOut:
    return SandboxRequestOut.model_validate(r)


def request_log_out(r: RequestLog) -> RequestLogOut:
    return RequestLogOut(
        id=r.id, created_at=r.created_at, request_id=r.request_id, method=r.method, route=r.route, path=r.path,
        status_code=r.status_code, outcome=r.outcome,  # type: ignore[arg-type]
        latency_ms=r.latency_ms, error_code=r.error_code, error_ref=ref_for(r.error_code),
        actor_type=r.actor_type, actor_id=r.actor_id, user_id=r.user_id, business_id=r.business_id,
        application_id=r.application_id, device_id=r.device_id, ip_hash=r.ip_hash, user_agent=r.user_agent,
        country=r.country,
    )
