"""Profiles / public pages (Part 2 §B6)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from starlette.concurrency import run_in_threadpool
from sqlalchemy import func, select

from app.api.deps import BusinessContext, ClientDep, SessionDep, business_permission
from app.core.errors import AppError, not_found, validation_error
from app.models import PageTemplate, Profile
from app.schemas.business import (
    PageTemplateUpdateIn,
    PageType,
    ProfileDuplicateIn,
    ProfileIn,
    ProfileOut,
    ProfileUpdateIn,
    SaveAsTemplateIn,
)
from app.services import audit, media, pages
from app.services import business as biz
from app.services.actions import validate_action
from app.services.business_serializers import profile_out

router = APIRouter(prefix="/businesses/{business_id}", tags=["Profiles"])
public_router = APIRouter(tags=["Profiles"])

View = Annotated[BusinessContext, Depends(business_permission("business.view"))]
Manage = Annotated[BusinessContext, Depends(business_permission("profiles.manage"))]

@router.post("/media", status_code=201, summary="Upload a page image (PNG/JPEG/WebP ≤ 2 MB, re-encoded) → /media URL")
async def upload_page_image(ctx: Manage, file: UploadFile = File(...)) -> dict[str, str]:
    limit = media.settings.MEDIA_MAX_UPLOAD_BYTES
    data = await file.read(limit + 1)
    rel = await run_in_threadpool(media.save_resized, data, f"businesses/{ctx.business.id}/pages", "img",
                                  (1600, 1600), False, max_bytes=limit)
    return {"url": f"/media/{rel}"}


async def _validate_sections(session: SessionDep, business_id: uuid.UUID, sections: list[dict[str, Any]],
                             prefix: str = "body.sections") -> list[dict[str, Any]]:
    """Part 6 strict section validation (+ buttons' actions against this business); every section gets an `id`."""
    out = []
    for i, section in enumerate(sections):
        section = pages.validate_section(section, f"{prefix}.{i}")
        if section["type"] == "buttons":
            items = section.get("items") or []
            if not isinstance(items, list) or len(items) > 20:
                raise validation_error(f"{prefix}.{i}.items", "up to 20 buttons")
            clean_items = []
            for j, item in enumerate(items):
                if not isinstance(item, dict) or not str(item.get("label") or "").strip():
                    raise validation_error(f"{prefix}.{i}.items.{j}.label", "label is required")
                action = await validate_action(session, business_id, item.get("action"),
                                               f"{prefix}.{i}.items.{j}.action", allow_webhook=False)
                clean_items.append({"label": str(item["label"])[:80], "action": action})
            section = {**section, "items": clean_items}
        out.append(section)
    return pages.assign_section_ids(out)


def _validate_theme(theme: dict[str, Any]) -> dict[str, Any]:
    return pages.validate_theme(theme)


async def _slug(session: SessionDep, business_id: uuid.UUID, wanted: str, exclude: uuid.UUID | None = None) -> str:
    slug = biz.slugify(wanted, 64)
    if not slug:
        raise validation_error("body.slug", "slug must contain letters or digits")
    taken = (await session.execute(select(Profile.id).where(
        Profile.business_id == business_id, Profile.slug == slug, Profile.deleted_at.is_(None),
        *([Profile.id != exclude] if exclude else [])))).first()
    if taken:
        raise AppError(409, "slug_taken", "A page with this slug already exists")
    return slug


async def _get(session: SessionDep, business_id: uuid.UUID, profile_id: uuid.UUID) -> Profile:
    p = await session.get(Profile, profile_id)
    if p is None or p.business_id != business_id or p.deleted_at is not None:
        raise not_found("Profile")
    return p


@router.get("/profiles", response_model=list[ProfileOut], summary="List profiles / pages")
async def list_profiles(ctx: View, session: SessionDep) -> list[ProfileOut]:
    rows = (await session.execute(select(Profile).where(Profile.business_id == ctx.business.id,
                                                        Profile.deleted_at.is_(None))
                                  .order_by(Profile.type, Profile.title))).scalars()
    return [profile_out(p, ctx.business) for p in rows]


def _template_defaults(business: Any, theme: dict[str, Any]) -> dict[str, Any]:
    """Business logo/accent unless the template sets them."""
    out = dict(theme)
    if not out.get("logo_url") and business.logo_path:
        out["logo_url"] = biz.media_url(business.logo_path)
    if not out.get("accent"):
        accent = (business.settings or {}).get("accent")
        out["accent"] = accent if isinstance(accent, str) and pages.HEX_RE.match(accent) else "#b91c1c"
    return out


async def _template_for(session: SessionDep, business_id: uuid.UUID, template_id: str) -> PageTemplate:
    t = await session.get(PageTemplate, template_id)
    if t is None or (t.scope == "business" and t.business_id != business_id):
        raise AppError(404, "page_template_not_found", "Page template not found")
    return t


@router.post("/profiles", status_code=201, response_model=ProfileOut, summary="Create a page (optionally from a template)",
             description="`template_id` (system or this business's template): sections/theme come from the template "
                         "with `{{business.*}}` placeholders filled in and the business logo/accent applied; `sections`/"
                         "`theme` in the body override them.")
async def create_profile(body: ProfileIn, ctx: Manage, session: SessionDep, client: ClientDep) -> ProfileOut:
    page_type = body.type or "custom"
    theme, sections = body.theme or {}, body.sections or []
    if body.template_id:
        t = await _template_for(session, ctx.business.id, body.template_id)
        if body.type is not None and body.type != t.page_type:
            raise validation_error("body.type", f"the template is a {t.page_type} page")
        page_type = t.page_type
        values = pages.business_values(ctx.business)
        theme = body.theme if body.theme is not None else _template_defaults(
            ctx.business, pages.substitute(dict(t.theme or {}), values))
        sections = body.sections if body.sections is not None else pages.substitute(
            [dict(x) for x in (t.sections or [])], values)
    slug = (await _slug(session, ctx.business.id, body.slug) if body.slug
            else await biz.unique_child_slug(session, Profile, ctx.business.id, body.title))
    p = Profile(business_id=ctx.business.id, type=page_type, slug=slug, title=body.title.strip(),
                published=body.published, theme=_validate_theme(theme),
                sections=await _validate_sections(session, ctx.business.id, sections))
    session.add(p)
    await session.flush()
    audit.record(session, action="profile.create", user_id=ctx.user.id, client=client, resource_type="profile",
                 resource_id=p.id, metadata={"type": p.type, "slug": p.slug, "template_id": body.template_id})
    await session.commit()
    await session.refresh(p)
    return profile_out(p, ctx.business)


@router.get("/profiles/{profile_id}", response_model=ProfileOut, summary="Get a profile")
async def get_profile(profile_id: uuid.UUID, ctx: View, session: SessionDep) -> ProfileOut:
    return profile_out(await _get(session, ctx.business.id, profile_id), ctx.business)


@router.patch("/profiles/{profile_id}", response_model=ProfileOut, summary="Update a profile")
async def update_profile(profile_id: uuid.UUID, body: ProfileUpdateIn, ctx: Manage, session: SessionDep,
                         client: ClientDep) -> ProfileOut:
    p = await _get(session, ctx.business.id, profile_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("title"):
        p.title = body.title.strip()  # type: ignore[union-attr]
    if data.get("slug") and p.type != "business":
        p.slug = await _slug(session, ctx.business.id, body.slug, p.id)  # type: ignore[arg-type]
    if body.published is not None:
        p.published = body.published
    if body.theme is not None:
        p.theme = _validate_theme(body.theme)
    if body.sections is not None:
        p.sections = await _validate_sections(session, ctx.business.id, body.sections)
    p.updated_at = datetime.now(UTC)
    audit.record(session, action="profile.update", user_id=ctx.user.id, client=client, resource_type="profile",
                 resource_id=p.id, metadata={"fields": sorted(data)})
    await session.commit()
    return profile_out(p, ctx.business)


@router.delete("/profiles/{profile_id}", status_code=204, summary="Delete a custom/menu/product page")
async def delete_profile(profile_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> Response:
    p = await _get(session, ctx.business.id, profile_id)
    if p.type in ("business", "employee"):
        raise AppError(409, "conflict", "Business and employee profiles cannot be deleted (unpublish instead)")
    p.deleted_at = datetime.now(UTC)
    p.published = False
    audit.record(session, action="profile.delete", user_id=ctx.user.id, client=client, resource_type="profile",
                 resource_id=p.id, metadata={"slug": p.slug})
    await session.commit()
    return Response(status_code=204)


async def _publish(profile_id: uuid.UUID, ctx: BusinessContext, session: SessionDep, client: ClientDep,
                   published: bool) -> ProfileOut:
    p = await _get(session, ctx.business.id, profile_id)
    p.published = published
    p.updated_at = datetime.now(UTC)
    audit.record(session, action=f"profile.{'publish' if published else 'unpublish'}", user_id=ctx.user.id,
                 client=client, resource_type="profile", resource_id=p.id)
    await session.commit()
    return profile_out(p, ctx.business)


@router.post("/profiles/{profile_id}/publish", response_model=ProfileOut, summary="Publish")
async def publish(profile_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> ProfileOut:
    return await _publish(profile_id, ctx, session, client, True)


@router.post("/profiles/{profile_id}/unpublish", response_model=ProfileOut, summary="Unpublish")
async def unpublish(profile_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> ProfileOut:
    return await _publish(profile_id, ctx, session, client, False)


# ── Part 6: duplicate, save-as-template, page templates ───────────────────
@router.post("/profiles/{profile_id}/duplicate", status_code=201, response_model=ProfileOut,
             summary="Duplicate a page (the copy is unpublished)")
async def duplicate_profile(profile_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep,
                            body: ProfileDuplicateIn | None = None) -> ProfileOut:
    src = await _get(session, ctx.business.id, profile_id)
    if src.type in ("business", "employee"):
        raise AppError(409, "conflict", "Business and employee profiles cannot be duplicated")
    title = ((body.title if body else None) or f"{src.title} (copy)")[:160]
    slug = (await _slug(session, ctx.business.id, body.slug) if body and body.slug
            else await biz.unique_child_slug(session, Profile, ctx.business.id, title))
    p = Profile(business_id=ctx.business.id, type=src.type, slug=slug, title=title.strip(), published=False,
                theme=dict(src.theme or {}), sections=[dict(x) for x in (src.sections or [])])
    session.add(p)
    await session.flush()
    audit.record(session, action="profile.duplicate", user_id=ctx.user.id, client=client, resource_type="profile",
                 resource_id=p.id, metadata={"from": str(src.id)})
    await session.commit()
    await session.refresh(p)
    return profile_out(p, ctx.business)


@router.post("/profiles/{profile_id}/save-as-template", status_code=201,
             summary="Save a page as one of this business's templates (max 50)")
async def save_as_template(profile_id: uuid.UUID, body: SaveAsTemplateIn, ctx: Manage, session: SessionDep,
                           client: ClientDep) -> dict[str, Any]:
    src = await _get(session, ctx.business.id, profile_id)
    if src.type not in pages.PAGE_TYPES:
        raise validation_error("path.profile_id", "only built-in pages (not business/employee profiles) can be templates")
    count = (await session.execute(select(func.count()).select_from(PageTemplate).where(
        PageTemplate.business_id == ctx.business.id))).scalar_one()
    if count >= pages.MAX_BUSINESS_TEMPLATES:
        raise AppError(409, "page_template_limit", f"A business can keep at most {pages.MAX_BUSINESS_TEMPLATES} "
                                                   "page templates", {"max": pages.MAX_BUSINESS_TEMPLATES})
    t = PageTemplate(id=pages.new_business_template_id(), scope="business", business_id=ctx.business.id,
                     page_type=src.type, name=body.name.strip(), description=(body.description or "").strip(),
                     category=body.category, preview_image_url=(src.theme or {}).get("cover_image_url"),
                     theme=dict(src.theme or {}), sections=[dict(x) for x in (src.sections or [])], sort_order=0)
    session.add(t)
    await session.flush()
    audit.record(session, action="page_template.create", user_id=ctx.user.id, client=client,
                 resource_type="page_template", resource_id=t.id, metadata={"from": str(src.id)})
    await session.commit()
    await session.refresh(t)
    return pages.template_out(t)


def _templates_query(page_type: str | None, business_id: uuid.UUID | None):  # type: ignore[no-untyped-def]
    stmt = select(PageTemplate).where(
        (PageTemplate.scope == "system") | (PageTemplate.business_id == business_id) if business_id
        else PageTemplate.scope == "system")
    if page_type:
        stmt = stmt.where(PageTemplate.page_type == page_type)
    return stmt.order_by(PageTemplate.scope.desc(), PageTemplate.sort_order, PageTemplate.name)


@router.get("/page-templates", summary="System templates + this business's own")
async def business_page_templates(ctx: View, session: SessionDep,
                                  page_type: PageType | None = None) -> list[dict[str, Any]]:
    rows = (await session.execute(_templates_query(page_type, ctx.business.id))).scalars()
    return [pages.template_out(t) for t in rows]


async def _own_template(session: SessionDep, business_id: uuid.UUID, template_id: str) -> PageTemplate:
    t = await session.get(PageTemplate, template_id)
    if t is None or t.scope != "business" or t.business_id != business_id:
        raise AppError(404, "page_template_not_found", "Page template not found (system templates are read-only)")
    return t


@router.patch("/page-templates/{template_id}", summary="Edit one of this business's templates")
async def update_page_template(template_id: str, body: PageTemplateUpdateIn, ctx: Manage, session: SessionDep,
                               client: ClientDep) -> dict[str, Any]:
    t = await _own_template(session, ctx.business.id, template_id)
    data = body.model_dump(exclude_unset=True)
    if body.name:
        t.name = body.name.strip()
    if "description" in data:
        t.description = (body.description or "").strip()
    if "category" in data:
        t.category = body.category
    if body.theme is not None:
        t.theme = _validate_theme(body.theme)
    if body.sections is not None:
        t.sections = await _validate_sections(session, ctx.business.id, body.sections)
    audit.record(session, action="page_template.update", user_id=ctx.user.id, client=client,
                 resource_type="page_template", resource_id=t.id, metadata={"fields": sorted(data)})
    await session.commit()
    await session.refresh(t)
    return pages.template_out(t)


@router.delete("/page-templates/{template_id}", status_code=204, summary="Delete one of this business's templates")
async def delete_page_template(template_id: str, ctx: Manage, session: SessionDep, client: ClientDep) -> Response:
    t = await _own_template(session, ctx.business.id, template_id)
    audit.record(session, action="page_template.delete", user_id=ctx.user.id, client=client,
                 resource_type="page_template", resource_id=t.id)
    await session.delete(t)
    await session.commit()
    return Response(status_code=204)


@public_router.get("/page-templates", summary="System page templates (public)")
async def public_page_templates(session: SessionDep, request: Request,
                                page_type: PageType | None = None) -> list[dict[str, Any]]:
    from app.services.request_logs import set_actor

    set_actor(request, "public")
    rows = (await session.execute(_templates_query(page_type, None))).scalars()
    return [pages.template_out(t) for t in rows]
