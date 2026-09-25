"""Usage counters (usage_daily) and event status transitions."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TERMINAL_STATUSES, Application, NfcEvent, UsageDaily


def _developer_apps(owner_id: uuid.UUID):  # type: ignore[no-untyped-def]
    return select(Application.id).where(Application.owner_id == owner_id, Application.business_id.is_(None))


def month_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or datetime.now(UTC)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return start, end


async def bump(
    session: AsyncSession,
    *,
    application_id: uuid.UUID,
    owner_id: uuid.UUID,
    day: date,
    events: int = 0,
    delivered: int = 0,
    failed: int = 0,
) -> None:
    stmt = insert(UsageDaily).values(
        application_id=application_id,
        owner_id=owner_id,
        day=day,
        events=events,
        delivered=delivered,
        failed=failed,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[UsageDaily.application_id, UsageDaily.day],
        set_={
            "events": UsageDaily.events + events,
            "delivered": UsageDaily.delivered + delivered,
            "failed": UsageDaily.failed + failed,
        },
    )
    await session.execute(stmt)


def _day(event: NfcEvent) -> date:
    return event.received_at.astimezone(UTC).date()


async def set_status(session: AsyncSession, event: NfcEvent, new_status: str) -> None:
    """Changes an event's status, keeping delivered/failed daily counters exact."""
    old = event.status
    if old == new_status:
        return
    delta = {"delivered": 0, "failed": 0}
    if old in TERMINAL_STATUSES:
        delta[old] -= 1
    if new_status in TERMINAL_STATUSES:
        delta[new_status] += 1
    event.status = new_status
    if delta["delivered"] or delta["failed"]:
        await bump(
            session,
            application_id=event.application_id,
            owner_id=event.owner_id,
            day=_day(event),
            **delta,
        )


async def events_in_range(
    session: AsyncSession, owner_id: uuid.UUID, start: date, end_exclusive: date
) -> tuple[int, int, int]:
    row = (
        await session.execute(
            select(
                func.coalesce(func.sum(UsageDaily.events), 0),
                func.coalesce(func.sum(UsageDaily.delivered), 0),
                func.coalesce(func.sum(UsageDaily.failed), 0),
            ).where(
                UsageDaily.owner_id == owner_id,
                UsageDaily.day >= start,
                UsageDaily.day < end_exclusive,
                UsageDaily.application_id.in_(_developer_apps(owner_id)),
            )
        )
    ).one()
    return int(row[0]), int(row[1]), int(row[2])


async def events_this_month(session: AsyncSession, owner_id: uuid.UUID) -> int:
    start, end = month_bounds()
    return (await events_in_range(session, owner_id, start.date(), end.date()))[0]
