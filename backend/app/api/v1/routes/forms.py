"""Part 6 §4: form responses collected on business pages."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC
from typing import Any

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import func, select

from app.api.deps import BusinessContext, ClientDep, CurrentUser, PaginationDep, SessionDep, load_business_context
from app.core.errors import AppError, not_found
from app.models import Card, FormResponse, Profile
from app.services import audit, pages

router = APIRouter(prefix="/businesses/{business_id}/form-responses", tags=["Profiles"])


async def _ctx(business_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request) -> BusinessContext:
    ctx = await load_business_context(session, user, business_id, request)
    if not (ctx.has("people.manage") or ctx.has("profiles.manage")):
        raise AppError(403, "insufficient_permissions", "Your role does not allow this action (profiles.manage)",
                       {"required": "profiles.manage"})
    return ctx


def _iso(dt: Any) -> str | None:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _out(r: FormResponse, title: str | None, card_name: str | None) -> dict[str, Any]:
    return {"id": str(r.id), "profile_id": str(r.profile_id), "profile_title": title, "section_id": r.section_id,
            "answers": r.answers, "rating": r.rating, "card_id": str(r.card_id) if r.card_id else None,
            "card_name": card_name, "created_at": _iso(r.created_at)}


def _conds(business_id: uuid.UUID, profile_id: uuid.UUID | None) -> list:  # type: ignore[type-arg]
    conds = [FormResponse.business_id == business_id]
    if profile_id:
        conds.append(FormResponse.profile_id == profile_id)
    return conds


def _rows(conds: list):  # type: ignore[no-untyped-def,type-arg]
    return (select(FormResponse, Profile.title, Card.name).join(Profile, Profile.id == FormResponse.profile_id)
            .outerjoin(Card, Card.id == FormResponse.card_id).where(*conds)
            .order_by(FormResponse.created_at.desc(), FormResponse.id))


@router.get("", summary="Form responses (paginated)")
async def list_responses(business_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request,
                         pagination: PaginationDep, profile_id: uuid.UUID | None = None) -> dict[str, Any]:
    ctx = await _ctx(business_id, user, session, request)
    conds = _conds(ctx.business.id, profile_id)
    total = (await session.execute(select(func.count()).select_from(FormResponse).where(*conds))).scalar_one()
    rows = (await session.execute(_rows(conds).offset(pagination.offset).limit(pagination.page_size))).all()
    return {"items": [_out(r, t, c) for r, t, c in rows], "total": total, "page": pagination.page,
            "page_size": pagination.page_size}


@router.get("/export.csv", summary="Export form responses (CSV, formula-injection guarded)")
async def export_responses(business_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request,
                           profile_id: uuid.UUID | None = Query(default=None)) -> Response:
    ctx = await _ctx(business_id, user, session, request)
    rows = (await session.execute(_rows(_conds(ctx.business.id, profile_id)).limit(50_000))).all()
    labels: dict[str, str] = {}
    forms = {p.id: p for p in (await session.execute(select(Profile).where(
        Profile.id.in_({r.profile_id for r, _, _ in rows})))).scalars()} if rows else {}
    for r, _, _ in rows:
        form = pages.find_section(forms[r.profile_id], r.section_id, "form") if r.profile_id in forms else None
        for f in (form or {}).get("fields") or []:
            labels.setdefault(f["id"], f.get("label") or f["id"])
        for key in r.answers or {}:
            labels.setdefault(key, key)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["created_at", "page", "form", "card", "rating", *[pages.csv_cell(v) for v in labels.values()]])
    for r, title, card_name in rows:
        w.writerow([_iso(r.created_at), pages.csv_cell(title), r.section_id, pages.csv_cell(card_name),
                    "" if r.rating is None else f"{r.rating:g}",
                    *[pages.csv_cell((r.answers or {}).get(k)) for k in labels]])
    return Response(content=out.getvalue(), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": 'attachment; filename="form-responses.csv"', "Cache-Control": "no-store"})


@router.delete("/{response_id}", status_code=204, summary="Delete a form response")
async def delete_response(business_id: uuid.UUID, response_id: uuid.UUID, user: CurrentUser, session: SessionDep,
                          request: Request, client: ClientDep) -> Response:
    ctx = await _ctx(business_id, user, session, request)
    r = await session.get(FormResponse, response_id)
    if r is None or r.business_id != ctx.business.id:
        raise not_found("Form response")
    audit.record(session, action="form_response.delete", user_id=user.id, client=client,
                 resource_type="form_response", resource_id=r.id)
    await session.delete(r)
    await session.commit()
    return Response(status_code=204)
