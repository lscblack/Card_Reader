"""Idempotent startup seeding: plans + default admin."""

from __future__ import annotations

import logging

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import PLACEHOLDER_ADMIN_PASSWORD, settings
from app.core.security import hash_password
from app.models import Plan, User
from app.services import plans as plan_service

logger = logging.getLogger("app.seed")

_SEED_LOCK_KEY = 815_004_221  # arbitrary advisory-lock id


async def seed(session: AsyncSession) -> None:
    # Serialise seeding across multiple workers/processes.
    await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _SEED_LOCK_KEY})

    # Insert-only: once a plan exists it is managed by admins (Part 3 §2) and never overwritten here.
    for data in plan_service.PLAN_SEED:
        await session.execute(insert(Plan).values(**data).on_conflict_do_nothing(index_elements=[Plan.code]))
    await session.flush()

    from app.models import BusinessCategory

    for order, (code, label) in enumerate(plan_service.BUSINESS_CATEGORIES):
        cat = insert(BusinessCategory).values(code=code, label=label, sort_order=order)
        await session.execute(cat.on_conflict_do_update(
            index_elements=[BusinessCategory.code], set_={"label": cat.excluded.label,
                                                          "sort_order": cat.excluded.sort_order}))
    await session.flush()

    email = settings.DEFAULT_ADMIN_EMAIL.strip().lower()
    if email:
        existing = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if existing is None:
            if settings.is_production and settings.DEFAULT_ADMIN_PASSWORD == PLACEHOLDER_ADMIN_PASSWORD:
                logger.error(
                    "Default admin NOT created: DEFAULT_ADMIN_PASSWORD is the placeholder value"
                )
            else:
                admin = User(
                    email=email,
                    password_hash=hash_password(settings.DEFAULT_ADMIN_PASSWORD),
                    full_name=settings.DEFAULT_ADMIN_NAME,
                    role="admin",
                    is_active=True,
                )
                session.add(admin)
                await session.flush()
                await plan_service.create_free_subscription(session, admin)
                logger.info("Default admin account created")
    await session.commit()

    if settings.SEED_DEMO_DATA and settings.is_development:
        from app.services.demo import seed_demo

        await seed_demo(session)
