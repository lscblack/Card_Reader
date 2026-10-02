"""Page visits: recorded by the web app on public pages, reported to admins (whole site) and business owners."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import Date, cast, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.useragent import device_type, is_bot
from app.models import Business, BusinessSlugRedirect, DigitalCard, PageVisit, Profile
from app.services.taps import visitor_hash

# Signed-in areas and flows that aren't "the website".
PRIVATE_PREFIXES = ("/dashboard", "/admin", "/business", "/me", "/checkout", "/reset-password", "/verify-email",
                    "/invite")
_BIZ = re.compile(r"^/b/([^/]+)(?:/([^/]+))?/?$")
_CARD = re.compile(r"^/p/([^/]+)/?$")


def normalize_path(path: str) -> str | None:
    p = urlsplit(path.strip()).path or "/"
    if not p.startswith("/") or len(p) > 300:
        return None
    p = re.sub(r"/{2,}", "/", p)
    if len(p) > 1:
        p = p.rstrip("/")
    if any(p == x or p.startswith(x + "/") for x in PRIVATE_PREFIXES):
        return None
    return p


def _referrer_host(referrer: str | None, own_host: str | None) -> str | None:
    if not referrer:
        return None
    host = (urlsplit(referrer).hostname or "").lower()[:200]
    return host if host and host != (own_host or "").lower() else None


async def _business(session: AsyncSession, slug: str) -> Business | None:
    b = (await session.execute(select(Business).where(Business.slug == slug.lower()))).scalar_one_or_none()
    if b is None:
        r = await session.get(BusinessSlugRedirect, slug.lower())
        if r is not None and r.expires_at > datetime.now(UTC):
            b = await session.get(Business, r.business_id)
    return b if b is not None and b.deleted_at is None else None


async def record(session: AsyncSession, *, path: str, referrer: str | None, ip: str | None, ua: str | None,
                 own_host: str | None, user_id: uuid.UUID | None) -> bool:
    """Stores one visit. Returns False when it isn't counted (bot, private area, unknown page)."""
    if is_bot(ua):
        return False
    p = normalize_path(path)
    if p is None:
        return False
    visit = PageVisit(kind="site", path=p, user_id=user_id, visitor_hash=visitor_hash(ip, ua),
                      referrer_host=_referrer_host(referrer, own_host), device_type=device_type(ua))
    if p == "/support":
        visit.kind = "support"
    elif m := _BIZ.match(p):
        business = await _business(session, m.group(1))
        if business is None:
            return False
        visit.kind, visit.business_id = "business", business.id
        if m.group(2):
            visit.profile_id = (await session.execute(select(Profile.id).where(
                Profile.business_id == business.id, Profile.slug == m.group(2).lower(),
                Profile.deleted_at.is_(None)))).scalar_one_or_none()
    elif m := _CARD.match(p):
        card_id = (await session.execute(select(DigitalCard.id).where(DigitalCard.slug == m.group(1).lower()))
                   ).scalar_one_or_none()
        if card_id is None:
            return False
        visit.kind, visit.digital_card_id = "personal", card_id
    session.add(visit)
    await session.commit()
    return True


# ── Reports ─────────────────────────────────────────────────────────────


def _since(days: int) -> datetime:
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return today - timedelta(days=days - 1)


async def _counts(session: AsyncSession, since: datetime, *conds: Any) -> dict[str, int]:
    row = (await session.execute(select(func.count(), func.count(distinct(PageVisit.visitor_hash)))
                                 .where(PageVisit.created_at >= since, *conds))).one()
    return {"visits": int(row[0]), "unique_visitors": int(row[1])}


async def _daily(session: AsyncSession, days: int, *conds: Any) -> list[dict[str, Any]]:
    since = _since(days)
    day = cast(func.timezone("UTC", PageVisit.created_at), Date)
    rows = (await session.execute(
        select(day, func.count(), func.count(distinct(PageVisit.visitor_hash)))
        .where(PageVisit.created_at >= since, *conds).group_by(day)
    )).all()
    by_day: dict[date, tuple[int, int]] = {r[0]: (int(r[1]), int(r[2])) for r in rows}
    out = []
    for i in range(days):
        d = since.date() + timedelta(days=i)
        v, u = by_day.get(d, (0, 0))
        out.append({"date": d.isoformat(), "visits": v, "unique_visitors": u})
    return out


async def site_report(session: AsyncSession, days: int) -> dict[str, Any]:
    since = _since(days)
    by_kind = dict((await session.execute(
        select(PageVisit.kind, func.count()).where(PageVisit.created_at >= since).group_by(PageVisit.kind))).all())
    top_pages = (await session.execute(
        select(PageVisit.path, func.count().label("n"), func.count(distinct(PageVisit.visitor_hash)))
        .where(PageVisit.created_at >= since).group_by(PageVisit.path).order_by(func.count().desc()).limit(10)
    )).all()
    referrers = (await session.execute(
        select(PageVisit.referrer_host, func.count()).where(PageVisit.created_at >= since,
                                                            PageVisit.referrer_host.is_not(None))
        .group_by(PageVisit.referrer_host).order_by(func.count().desc()).limit(8)
    )).all()
    devices = dict((await session.execute(
        select(PageVisit.device_type, func.count()).where(PageVisit.created_at >= since)
        .group_by(PageVisit.device_type))).all())
    return {
        "days": days,
        "today": await _counts(session, _since(1)),
        "last_7_days": await _counts(session, _since(7)),
        "period": await _counts(session, since),
        "by_kind": {k: int(by_kind.get(k, 0)) for k in ("site", "support", "business", "personal")},
        "devices": {k or "other": int(v) for k, v in devices.items()},
        "daily": await _daily(session, days),
        "top_pages": [{"path": p, "visits": int(n), "unique_visitors": int(u)} for p, n, u in top_pages],
        "top_referrers": [{"host": h, "visits": int(n)} for h, n in referrers],
    }


async def support_visits(session: AsyncSession, days: int = 30) -> int:
    return (await _counts(session, _since(days), PageVisit.kind == "support"))["visits"]


async def business_report(session: AsyncSession, business_id: uuid.UUID, days: int) -> dict[str, Any]:
    cond = PageVisit.business_id == business_id
    since = _since(days)
    pages = (await session.execute(
        select(PageVisit.profile_id, Profile.title, func.count(), func.count(distinct(PageVisit.visitor_hash)))
        .outerjoin(Profile, Profile.id == PageVisit.profile_id)
        .where(cond, PageVisit.created_at >= since).group_by(PageVisit.profile_id, Profile.title)
        .order_by(func.count().desc()).limit(20)
    )).all()
    return {
        "days": days,
        "today": await _counts(session, _since(1), cond),
        "period": await _counts(session, since, cond),
        "daily": await _daily(session, days, cond),
        "pages": [{"profile_id": str(pid) if pid else None, "title": title or "Business page",
                   "visits": int(n), "unique_visitors": int(u)} for pid, title, n, u in pages],
    }
