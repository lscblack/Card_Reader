"""In-app notifications (Part 3 §10)."""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, User


def notify(session: AsyncSession, user_ids: Iterable[uuid.UUID], *, type_: str, title: str, body: str | None = None,
           link: str | None = None, severity: str = "info") -> None:
    for uid in dict.fromkeys(user_ids):  # dedupe, keep order
        session.add(Notification(user_id=uid, type=type_, title=title[:200], body=body, link=link, severity=severity))


async def admin_ids(session: AsyncSession) -> list[uuid.UUID]:
    return list((await session.execute(select(User.id).where(User.role == "admin", User.is_active.is_(True)))).scalars())
