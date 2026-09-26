"""Profiles / public pages (Part 2 §B6)."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select

from app.api.deps import BusinessContext, ClientDep, SessionDep, business_permission
from app.core.errors import AppError, not_found, validation_error
from app.models import Profile
from app.schemas.business import ProfileIn, ProfileOut, ProfileUpdateIn
from app.services import audit
from app.services import business as biz
from app.services.actions import validate_action
from app.services.url_validation import unsafe_url_scheme
from app.services.business_serializers import profile_out

router = APIRouter(prefix="/businesses/{business_id}", tags=["Profiles"])

View = Annotated[BusinessContext, Depends(business_permission("business.view"))]
Manage = Annotated[BusinessContext, Depends(business_permission("profiles.manage"))]

SECTION_TYPES = {"about", "contact", "hours", "social", "services", "products", "menu", "buttons", "gallery", "text"}
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


_LINK_KEYS = {"url", "href", "link", "src", "image", "images", "image_url", "photo_url", "cover_image_url", "website"}


def _check_links(value: Any, field: str, link: bool = False) -> None:
    """Public pages render section links/images: reject javascript:/data:/vbscript: & other non-web schemes."""
    if isinstance(value, dict):
        for key, item in value.items():
            _check_links(item, f"{field}.{key}", key in _LINK_KEYS or key.endswith("_url"))
    elif isinstance(value, list):
        for j, item in enumerate(value):
            _check_links(item, f"{field}.{j}", link)
    elif link and isinstance(value, str) and unsafe_url_scheme(value):
        raise validation_error(field, "must be an http(s), mailto: or tel: URL")


async def _validate_sections(session: SessionDep, business_id: uuid.UUID, sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, section in enumerate(sections):
        if not isinstance(section, dict) or section.get("type") not in SECTION_TYPES:
            raise validation_error(f"body.sections.{i}.type", f"one of: {', '.join(sorted(SECTION_TYPES))}")
        _check_links({k: v for k, v in section.items() if k != "items" or section["type"] != "buttons"},
                     f"body.sections.{i}")
        if section["type"] == "buttons":
            items = section.get("items") or []
            if not isinstance(items, list) or len(items) > 20:
                raise validation_error(f"body.sections.{i}.items", "up to 20 buttons")
            clean_items = []
            for j, item in enumerate(items):
                if not isinstance(item, dict) or not str(item.get("label") or "").strip():
                    raise validation_error(f"body.sections.{i}.items.{j}.label", "label is required")
                action = await validate_action(session, business_id, item.get("action"),
                                               f"body.sections.{i}.items.{j}.action", allow_webhook=False)
                clean_items.append({"label": str(item["label"])[:80], "action": action})
            section = {**section, "items": clean_items}
        out.append(section)
    return out


def _validate_theme(theme: dict[str, Any]) -> dict[str, Any]:
    accent = theme.get("accent")
    if accent is not None and not (isinstance(accent, str) and HEX_RE.match(accent)):
        raise validation_error("body.theme.accent", "accent must be a hex colour like #b91c1c")
    _check_links({"cover_image_url": theme.get("cover_image_url")}, "body.theme")
    return {k: v for k, v in theme.items() if k in ("accent", "cover_image_url")}


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


@router.post("/profiles", status_code=201, response_model=ProfileOut, summary="Create a custom/menu/product page")
async def create_profile(body: ProfileIn, ctx: Manage, session: SessionDep, client: ClientDep) -> ProfileOut:
    slug = (await _slug(session, ctx.business.id, body.slug) if body.slug
            else await biz.unique_child_slug(session, Profile, ctx.business.id, body.title))
    p = Profile(business_id=ctx.business.id, type=body.type, slug=slug, title=body.title.strip(),
                published=body.published, theme=_validate_theme(body.theme),
                sections=await _validate_sections(session, ctx.business.id, body.sections))
    session.add(p)
    await session.flush()
    audit.record(session, action="profile.create", user_id=ctx.user.id, client=client, resource_type="profile",
                 resource_id=p.id, metadata={"type": p.type, "slug": p.slug})
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
