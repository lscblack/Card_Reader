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

    from app.models import CardTemplate
    from app.services.personal import TEMPLATES

    for order, t in enumerate(TEMPLATES):  # templates are product data: kept in sync on every start
        stmt = insert(CardTemplate).values(sort_order=order, **t)
        await session.execute(stmt.on_conflict_do_update(
            index_elements=[CardTemplate.id],
            set_={k: stmt.excluded[k] for k in ("name", "description", "layout", "default_design", "supports",
                                                "premium", "sort_order")}))
    await session.flush()

    # Part 5: v2 shape templates from app/data/card_templates_v2.json (invalid entries are logged and skipped).
    from app.services import card_design_v2

    for order, template in enumerate(card_design_v2.load_templates()):
        row = card_design_v2.db_row(template, order)
        stmt = insert(CardTemplate).values(**row)
        await session.execute(stmt.on_conflict_do_update(
            index_elements=[CardTemplate.id], set_={k: stmt.excluded[k] for k in row if k != "id"}))
    await session.flush()

    # Part 6: system page templates from app/data/page_templates.json (invalid ones logged and skipped).
    await seed_page_templates(session)

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


async def seed_page_templates(session: AsyncSession) -> int:
    import uuid

    from sqlalchemy import delete

    from app.core.errors import AppError
    from app.models import PageTemplate
    from app.services import pages
    from app.services.actions import validate_action

    kept: list[str] = []
    for order, t in enumerate(pages.load_system_templates()):
        try:  # button actions must work for any business (no references to ids)
            for i, section in enumerate(t["sections"]):
                if section.get("type") == "buttons":
                    for j, item in enumerate(section.get("items") or []):
                        await validate_action(session, uuid.UUID(int=0), (item or {}).get("action"),
                                              f"sections.{i}.items.{j}.action", allow_webhook=False)
        except AppError as exc:
            logger.error("Skipping invalid page template %s: %s", t["id"], exc.details or exc.message)
            continue
        row = {**t, "scope": "system", "business_id": None, "sort_order": order}
        stmt = insert(PageTemplate).values(**row)
        await session.execute(stmt.on_conflict_do_update(
            index_elements=[PageTemplate.id], set_={k: stmt.excluded[k] for k in row if k != "id"},
            where=PageTemplate.scope == "system"))
        kept.append(t["id"])
    await session.execute(delete(PageTemplate).where(PageTemplate.scope == "system", PageTemplate.id.not_in(kept)))
    await session.flush()
    return len(kept)
