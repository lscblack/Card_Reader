"""Public (no-auth) endpoints: error catalog, metadata, action types, public profiles, taps, sandbox receiver."""

from __future__ import annotations

import asyncio
import uuid
import json
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy import select

from app.api.deps import SessionDep
from app.core.config import settings
from app.core.error_catalog import as_public_list
from app.core.errors import AppError, error_response
from app.core.rate_limit import client_ip
from app.models import Business, BusinessCategory, BusinessSlugRedirect, Card, Employee, Profile, SandboxEndpoint
from pydantic import Field

from app.schemas.business import CategoryOut
from app.schemas.common import Schema
from app.services import delivery, taps
from app.services.actions import ACTION_TYPES, effective_action, resolve, vcard_for, wifi_qr_string
from app.services.business import card_effective_status, media_url
from app.services.business_serializers import profile_out
from app.services.request_logs import country_from, ip_hash, set_actor
from app.services.sandbox import MAX_BODY_BYTES, store, token_ok

router = APIRouter(tags=["Public"])
root_router = APIRouter(include_in_schema=True, tags=["Public"])

PUBLIC_CACHE = "public, max-age=60"


@router.get("/errors", summary="Error catalog (public)",
            description="Every error code the API, the delivery pipeline or the mobile app can report.")
async def error_catalog(request: Request) -> list[dict[str, Any]]:
    set_actor(request, "public")
    return as_public_list()


@router.get("/meta/business-categories", response_model=list[CategoryOut], summary="Business categories (public)")
async def business_categories(session: SessionDep, request: Request) -> list[CategoryOut]:
    set_actor(request, "public")
    rows = (await session.execute(select(BusinessCategory).order_by(BusinessCategory.sort_order,
                                                                    BusinessCategory.label))).scalars()
    return [CategoryOut(code=r.code, label=r.label) for r in rows]


@router.get("/actions/types", summary="Card action types (public)",
            description="What a tap can do, with the fields each type needs — the dashboard renders forms from this.")
async def action_types(request: Request) -> list[dict[str, Any]]:
    set_actor(request, "public")
    return ACTION_TYPES


@router.get("/meta/branding", summary="Branding (public, cached ≤ 60 s, ETag)")
async def meta_branding(request: Request) -> Response:
    from app.services import branding

    set_actor(request, "public")
    payload = branding.public(await branding.current())
    tag = branding.etag(payload)
    headers = {"ETag": tag, "Cache-Control": PUBLIC_CACHE}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=payload, headers=headers)


@router.get("/meta/fonts", summary="Curated font list (public)")
async def meta_fonts(request: Request) -> JSONResponse:
    from app.services.branding import FONTS

    set_actor(request, "public")
    return JSONResponse(content=FONTS, headers={"Cache-Control": "public, max-age=3600"})


# ── Public profiles ──────────────────────────────────────────────────────
def _unavailable(reason: str) -> AppError:
    return AppError(404, "profile_unavailable", "This page isn't available", {"reason": reason})


async def _public_business(session: SessionDep, slug: str) -> Business:
    business = (await session.execute(select(Business).where(Business.slug == slug.lower()))).scalar_one_or_none()
    if business is None:
        redirect = await session.get(BusinessSlugRedirect, slug.lower())
        if redirect is not None and redirect.expires_at > datetime.now(UTC):
            business = await session.get(Business, redirect.business_id)
    if business is None or business.deleted_at is not None:
        raise _unavailable("not_found")
    if business.status != "active":
        raise _unavailable("suspended")
    if not business.verified:
        raise _unavailable("unverified")
    return business


def _business_block(b: Business) -> dict[str, Any]:
    return {"name": b.name, "slug": b.slug, "logo_url": media_url(b.logo_path), "verified": b.verified,
            "category": b.category}


async def _public_profile(session: SessionDep, business: Business, profile_slug: str | None) -> tuple[Profile, Employee | None]:
    stmt = select(Profile).where(Profile.business_id == business.id, Profile.deleted_at.is_(None))
    stmt = stmt.where(Profile.type == "business") if profile_slug is None else stmt.where(Profile.slug == profile_slug)
    profile = (await session.execute(stmt.limit(1))).scalar_one_or_none()
    if profile is None:
        raise _unavailable("not_found")
    if not profile.published:
        raise _unavailable("unpublished")
    employee = None
    if profile.employee_id:
        employee = await session.get(Employee, profile.employee_id)
        if employee is None or employee.status != "active":
            raise _unavailable("inactive")
    return profile, employee


def _employee_block(e: Employee | None) -> dict[str, Any] | None:
    if e is None:
        return None
    return {"id": str(e.id), "full_name": e.full_name, "position": e.position, "department": e.department,
            "photo_url": media_url(e.photo_path), "phone": e.phone, "email": e.email,
            "social_links": list(e.social_links or [])}


def _json(data: Any) -> JSONResponse:
    return JSONResponse(content=data, headers={"Cache-Control": PUBLIC_CACHE})


@router.get("/public/b/{business_slug}", summary="Public business profile")
async def public_business(business_slug: str, session: SessionDep, request: Request) -> JSONResponse:
    set_actor(request, "public")
    business = await _public_business(session, business_slug)
    request.state.business_id = business.id
    profile, _ = await _public_profile(session, business, None)
    return _json({
        "business": _business_block(business),
        "profile": profile_out(profile, business).model_dump(mode="json"),
        "employee": None,
        "vcard_url": f"{settings.public_api_url}/api/v1/public/b/{business.slug}/vcard",
    })


@router.get("/public/b/{business_slug}/vcard", summary="Business contact card (vCard)")
async def public_business_vcard(business_slug: str, session: SessionDep, request: Request) -> Response:
    set_actor(request, "public")
    business = await _public_business(session, business_slug)
    request.state.business_id = business.id
    return _vcard(vcard_for(business), business.slug)


@router.get("/public/b/{business_slug}/{profile_slug}", summary="Public profile page data")
async def public_profile(business_slug: str, profile_slug: str, session: SessionDep, request: Request) -> JSONResponse:
    set_actor(request, "public")
    business = await _public_business(session, business_slug)
    request.state.business_id = business.id
    profile, employee = await _public_profile(session, business, profile_slug.lower())
    return _json({
        "business": _business_block(business),
        "profile": profile_out(profile, business).model_dump(mode="json"),
        "employee": _employee_block(employee),
        "vcard_url": f"{settings.public_api_url}/api/v1/public/b/{business.slug}/{profile.slug}/vcard",
    })


@router.get("/public/b/{business_slug}/{profile_slug}/vcard", summary="Profile contact card (vCard)")
async def public_profile_vcard(business_slug: str, profile_slug: str, session: SessionDep, request: Request) -> Response:
    set_actor(request, "public")
    business = await _public_business(session, business_slug)
    request.state.business_id = business.id
    profile, employee = await _public_profile(session, business, profile_slug.lower())
    return _vcard(vcard_for(business, employee), profile.slug)


# ── Part 6: forms & calendar ─────────────────────────────────────────────
class FormSubmitIn(Schema):
    answers: dict[str, Any] = Field(default_factory=dict)
    website: str | None = Field(default=None, max_length=500, description="Honeypot — must be empty")
    card: str | None = Field(default=None, max_length=16, description="public_code of the tapped card, if any")


@router.post("/public/b/{business_slug}/{profile_slug}/forms/{section_id}", status_code=201,
             summary="Submit a form on a public page",
             description="Validated against the form definition; 5 submissions / 10 min per IP and page (429); the "
                         "honeypot `website` must stay empty (otherwise 201 but nothing is stored).")
async def submit_form(business_slug: str, profile_slug: str, section_id: str, body: FormSubmitIn,
                      session: SessionDep, request: Request) -> dict[str, Any]:
    from app.core.rate_limit import hit
    from app.models import BusinessMember, FormResponse
    from app.services import notifications, pages

    set_actor(request, "public")
    business = await _public_business(session, business_slug)
    request.state.business_id = business.id
    profile, _ = await _public_profile(session, business, profile_slug.lower())
    form = pages.find_section(profile, section_id, "form")
    if form is None:
        raise AppError(404, "form_not_found", "This form doesn't exist on the page")
    limit = await hit(f"form:{client_ip(request)}:{profile.id}", 5, 600)
    if limit is not None and not limit.allowed:
        raise AppError(429, "rate_limited", "Too many submissions, try again later", {"retry_after": limit.retry_after},
                       headers={"Retry-After": str(limit.retry_after)})
    if body.website:
        return {"status": "received", "message": form.get("success_message")}
    answers, rating = pages.validate_answers(form, body.answers)
    if not answers:
        raise AppError(422, "validation_error", "The form is empty", [{"field": "body.answers", "message": "empty"}])
    card_id = None
    if body.card:
        card_id = (await session.execute(select(Card.id).where(
            Card.public_code == body.card, Card.business_id == business.id, Card.deleted_at.is_(None)))).scalar()
    session.add(FormResponse(business_id=business.id, profile_id=profile.id, section_id=section_id, answers=answers,
                             rating=rating, card_id=card_id))
    recipients = (await session.execute(select(BusinessMember.user_id).where(
        BusinessMember.business_id == business.id, BusinessMember.status == "active",
        BusinessMember.role.in_(("owner", "admin"))))).scalars().all()
    notifications.notify(session, recipients, type_="business.form_response",
                         title=f"New response: {form.get('title') or profile.title}"[:200],
                         body=f"On the page “{profile.title}”" + (f" · rating {rating:g}/5" if rating else ""),
                         link=f"/business/{business.id}/pages/{profile.id}/responses", severity="info")
    await session.commit()
    return {"status": "received", "message": form.get("success_message")}


@router.get("/public/b/{business_slug}/{profile_slug}/events/{section_id}.ics", summary="Add an event to a calendar")
async def event_calendar(business_slug: str, profile_slug: str, section_id: str, session: SessionDep,
                         request: Request) -> Response:
    from app.services import pages
    from app.services.actions import business_public_url

    set_actor(request, "public")
    business = await _public_business(session, business_slug)
    request.state.business_id = business.id
    profile, _ = await _public_profile(session, business, profile_slug.lower())
    event = pages.find_section(profile, section_id, "event")
    if event is None:
        raise AppError(404, "profile_unavailable", "This event doesn't exist on the page", {"reason": "not_found"})
    text = pages.event_ics(event, uid=f"{profile.id}-{section_id}@nextap", organizer=business.name,
                           url=business_public_url(business, profile.slug))
    return Response(content=text, media_type="text/calendar; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="{section_id}.ics"', "Cache-Control": PUBLIC_CACHE})


def _vcard(text: str, name: str) -> Response:
    return Response(
        content=text, media_type="text/vcard; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}.vcf"', "Cache-Control": PUBLIC_CACHE},
    )


@router.get("/public/cards/resolve", summary="Find a registered card's tap link by chip ID (public)",
            description="Lets the nexTap app open a registered card that has no tap link written to its chip yet, "
                        "without signing in. Returns only the public tap link (the same URL printed in the card's "
                        "QR code). 404 `card_not_registered` when no business — or more than one — registered "
                        "this chip ID. Rate limited per IP like all public endpoints.")
async def public_resolve_card(uid: str, session: SessionDep, request: Request) -> JSONResponse:
    from app.api.v1.routes.cards import normalize_uid
    from app.services.business import tap_url

    set_actor(request, "public")
    normalized = normalize_uid(uid, "query.uid")
    rows = (await session.execute(
        select(Card.public_code, Card.kind)
        .join(Business, Business.id == Card.business_id)
        .where(Card.uid == normalized, Card.deleted_at.is_(None), Business.deleted_at.is_(None))
        .limit(2)
    )).all()
    if len(rows) != 1:  # unknown, or registered by several businesses (never guess between them)
        raise AppError(404, "card_not_registered", "This card isn't registered with nexTap")
    code, kind = rows[0]
    return JSONResponse({"tap_url": tap_url(code), "kind": kind}, headers={"Cache-Control": "no-store"})


@router.get("/public/w/{public_code}", summary="Wi-Fi details for a tag (public Wi-Fi page data)",
            description="Used by the web page `/w/{public_code}`. 404 `profile_unavailable` unless the tag's "
                        "action is `wifi` and the tag/business are available.")
async def public_wifi(public_code: str, session: SessionDep, request: Request) -> JSONResponse:
    set_actor(request, "public")
    card = (await session.execute(
        select(Card).where(Card.public_code == public_code, Card.deleted_at.is_(None))
    )).scalar_one_or_none()
    if card is None:
        raise _unavailable("not_found")
    business = await session.get(Business, card.business_id)
    if business is None or business.deleted_at is not None:
        raise _unavailable("not_found")
    request.state.business_id = business.id
    if business.status != "active":
        raise _unavailable("suspended")
    if not business.verified:
        raise _unavailable("unverified")
    if card_effective_status(card, business) in ("inactive", "inactive_owner"):
        raise _unavailable("inactive")
    action = effective_action(card, business)
    if action.get("type") != "wifi":
        raise _unavailable("not_wifi")
    cfg = action.get("config") or {}
    if cfg.get("profile_id"):  # Part 6: the details live on a Wi-Fi page
        page = await session.get(Profile, uuid.UUID(cfg["profile_id"]))
        section = next((sec for sec in ((page.sections or []) if page and page.deleted_at is None else [])
                        if isinstance(sec, dict) and sec.get("type") == "wifi"), None)
        if page is None or not page.published or section is None:
            raise _unavailable("not_wifi")
        cfg = section
    return JSONResponse(content={
        "business": _business_block(business),
        "ssid": cfg.get("ssid"), "password": cfg.get("password"), "security": cfg.get("security", "WPA"),
        "hidden": bool(cfg.get("hidden")), "wifi_qr": wifi_qr_string(cfg),
    }, headers={"Cache-Control": "no-store"})


# ── Tap resolution: GET /t/{public_code} (root path) ────────────────────
def _unavailable_redirect(reason: str) -> RedirectResponse:
    url = f"{settings.public_web_url}/tap/unavailable?" + urlencode({"reason": reason})
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})


@root_router.get("/t/{public_code}", summary="Card tap (consumer phone opened the card URL)",
                 description="Records a `web` tap and performs the card's action (302 / page / vCard). Unknown or "
                             "unavailable cards redirect to the neutral `/tap/unavailable` page.")
async def tap(public_code: str, session: SessionDep, request: Request) -> Response:
    set_actor(request, "public")
    card = (await session.execute(
        select(Card).where(Card.public_code == public_code, Card.deleted_at.is_(None))
    )).scalar_one_or_none()
    if card is None:
        return _unavailable_redirect("unknown")
    business = await session.get(Business, card.business_id)
    if business is None or business.deleted_at is not None:
        return _unavailable_redirect("unknown")
    request.state.business_id = business.id
    ua = request.headers.get("user-agent")
    ip = client_ip(request)
    country = country_from(request)
    eff = card_effective_status(card, business)
    reason = None
    if business.status != "active":
        reason = "suspended"
    elif not business.verified:
        reason = "unverified"
    elif eff in ("inactive", "inactive_owner"):
        reason = "inactive"
    if reason:
        await taps.record_tap(session, business=business, card=card, source="web", result="inactive",
                              action_type=None, ip=ip, ua=ua, country=country)
        await session.commit()
        return _unavailable_redirect(reason)

    res = await resolve(session, business, card)
    tap_row = await taps.record_tap(session, business=business, card=card, source="web",
                                    result=taps.RESULT_BY_KIND.get(res.kind, "redirected"),
                                    action_type=res.action_type, ip=ip, ua=ua, country=country)
    event = None
    if res.kind == "webhook" and not tap_row.is_bot:
        await session.flush()
        event = await taps.create_webhook_event(session, business=business, card=card,
                                                application_id=res.webhook_application_id, source="web",
                                                device=None, tap=tap_row)
    await session.commit()
    if event is not None:
        await delivery.enqueue(event.id, datetime.now(UTC))
    final = res.then if res.kind == "webhook" and res.then is not None else res
    return _respond(final, card)


def _respond(res: Any, card: Card) -> Response:
    headers = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}
    if res.kind == "vcard" and res.vcard:
        return Response(content=res.vcard, media_type="text/vcard; charset=utf-8",
                        headers={**headers, "Content-Disposition": f'attachment; filename="{card.public_code}.vcf"'})
    if res.kind == "page" and res.page_html:
        return HTMLResponse(res.page_html, headers=headers)
    if res.url:
        return RedirectResponse(res.url, status_code=302, headers=headers)
    return _unavailable_redirect("unknown")


# ── Sandbox receiver: ANY /sandbox/{token} (root path) ──────────────────
async def sandbox_receiver(token: str, session: SessionDep, request: Request) -> Response:
    set_actor(request, "public")
    endpoint = None
    if token_ok(token):
        endpoint = (await session.execute(
            select(SandboxEndpoint).where(SandboxEndpoint.token == token)
        )).scalar_one_or_none()
    if endpoint is None:
        return error_response(404, "not_found", "Unknown sandbox endpoint", request=request)
    request.state.user_id = endpoint.owner_id
    request.state.business_id = endpoint.business_id
    request.state.application_id = endpoint.application_id

    declared = int(request.headers.get("content-length") or 0)
    raw = bytearray()
    too_large = declared > MAX_BODY_BYTES
    if not too_large:
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_BODY_BYTES:
                too_large = True
                break
    size = max(declared, len(raw))
    status = 413 if too_large else endpoint.response_status
    stored = await store(
        session, endpoint, method=request.method, path=request.url.path, query=request.url.query or None,
        headers={k: v for k, v in request.headers.items()}, raw=None if too_large else bytes(raw), size=size,
        ip_hash=ip_hash(client_ip(request)), response_status=status, too_large=too_large,
    )
    delay = 0 if too_large else endpoint.response_delay_ms
    await session.commit()
    if endpoint.application_id:
        from app.services import live

        live.publish_later(endpoint.application_id, "sandbox.request", {
            "endpoint_id": str(endpoint.id), "request_id": str(stored.id), "event_id": stored.event_id,
            "signature_status": (stored.signature or {}).get("status"),
            "checks_failed": sum(1 for c in (stored.checks or []) if c.get("passed") is False),
            "response_status": status})
    if too_large:
        return error_response(413, "payload_too_large", "Sandbox bodies are limited to 64 KB", request=request)
    if delay:
        await asyncio.sleep(delay / 1000)
    body = endpoint.response_body or ""
    media = "application/json"
    try:
        json.loads(body)
    except ValueError:
        media = "text/plain"
    from app.services.resources_validation import forbidden_sandbox_header

    headers = {k: v for k, v in (endpoint.response_headers or {}).items() if not forbidden_sandbox_header(k)}
    # The body is attacker-controllable and served from the API origin: never let a browser run it.
    headers.update({"Content-Security-Policy": "sandbox; default-src 'none'", "X-Content-Type-Options": "nosniff"})
    return Response(content=body if request.method != "HEAD" else b"", status_code=status, media_type=media,
                    headers=headers)


for _method in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"):
    root_router.add_api_route(
        "/sandbox/{token}", sandbox_receiver, methods=[_method], name=f"sandbox_receiver_{_method.lower()}",
        operation_id=f"sandbox_receiver_{_method.lower()}",
        summary="Sandbox receiver (captures the request, simulates the configured response)",
        include_in_schema=_method in ("POST", "GET"),
    )
