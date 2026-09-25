"""Sandbox dashboard API (Part 2 §A4). Scope: the developer's own endpoints, or `?business_id=` (api.manage)."""

from __future__ import annotations

import uuid
from datetime import datetime
from urllib.parse import urlsplit

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ClientDep, CurrentUser, PaginationDep, SessionDep, load_business_context
from app.core.errors import AppError, not_found, validation_error
from app.core.security import decrypt_secret
from app.models import Application, SandboxEndpoint, SandboxRequest, User
from app.schemas.business import (
    SandboxEndpointIn,
    SandboxEndpointOut,
    SandboxEndpointUpdateIn,
    SandboxRequestOut,
)
from app.schemas.common import Page
from app.schemas.resources import ApplicationOut, EndpointTestOut
from app.services import audit, delivery
from app.services import sandbox as sandbox_service
from app.services.applications import get_owned_application
from app.services.business_serializers import sandbox_endpoint_out, sandbox_request_out
from app.services.resources_validation import validate_response_headers
from app.services.serializers import application_out_single
from app.services.url_validation import host_matches_allowlist

router = APIRouter(prefix="/sandbox", tags=["Sandbox"])


async def first_app_sandbox(session: AsyncSession, user: User) -> SandboxEndpoint | None:
    """The developer's default sandbox, if this is their first (developer) application."""
    has_app = (await session.execute(
        select(Application.id).where(Application.owner_id == user.id, Application.business_id.is_(None)).limit(1)
    )).first()
    if has_app:
        return None
    return (await session.execute(
        select(SandboxEndpoint).where(SandboxEndpoint.owner_id == user.id, SandboxEndpoint.business_id.is_(None))
        .order_by(SandboxEndpoint.created_at).limit(1)
    )).scalar_one_or_none()


async def _scope(session: AsyncSession, user: User, business_id: uuid.UUID | None, request: Request):  # type: ignore[no-untyped-def]
    if business_id is None:
        return [SandboxEndpoint.owner_id == user.id, SandboxEndpoint.business_id.is_(None)]
    ctx = await load_business_context(session, user, business_id, request)
    ctx.require("api.manage")
    return [SandboxEndpoint.business_id == business_id]


async def _get(session: AsyncSession, user: User, endpoint_id: uuid.UUID, request: Request) -> SandboxEndpoint:
    endpoint = await session.get(SandboxEndpoint, endpoint_id)
    if endpoint is None:
        raise not_found("Sandbox endpoint")
    if endpoint.business_id is None:
        if endpoint.owner_id != user.id:
            raise not_found("Sandbox endpoint")
    else:
        ctx = await load_business_context(session, user, endpoint.business_id, request)
        ctx.require("api.manage")
    return endpoint


async def _check_app(session: AsyncSession, user: User, endpoint: SandboxEndpoint | None,
                     business_id: uuid.UUID | None, application_id: uuid.UUID | None) -> None:
    if application_id is None:
        return
    app = await get_owned_application(session, user, application_id, permission="api.manage")
    if app.business_id != business_id:
        raise validation_error("body.application_id", "application must belong to the same owner/business")


@router.get("/endpoints", response_model=list[SandboxEndpointOut], summary="List sandbox endpoints")
async def list_endpoints(user: CurrentUser, session: SessionDep, request: Request,
                         business_id: uuid.UUID | None = Query(default=None)) -> list[SandboxEndpointOut]:
    conds = await _scope(session, user, business_id, request)
    rows = (await session.execute(select(SandboxEndpoint).where(*conds).order_by(SandboxEndpoint.created_at))).scalars()
    return [sandbox_endpoint_out(r) for r in rows]


@router.post("/endpoints", status_code=201, response_model=SandboxEndpointOut, summary="Create a sandbox endpoint")
async def create_endpoint(body: SandboxEndpointIn, user: CurrentUser, session: SessionDep, request: Request,
                          business_id: uuid.UUID | None = Query(default=None)) -> SandboxEndpointOut:
    await _scope(session, user, business_id, request)
    await _check_app(session, user, None, business_id, body.application_id)
    endpoint = sandbox_service.new_endpoint(user.id, body.name.strip(), business_id, body.application_id)
    endpoint.response_status = body.response_status
    endpoint.response_delay_ms = body.response_delay_ms
    endpoint.response_body = body.response_body
    endpoint.response_headers = validate_response_headers(body.response_headers)
    session.add(endpoint)
    await session.commit()
    return sandbox_endpoint_out(endpoint)


@router.get("/endpoints/{endpoint_id}", response_model=SandboxEndpointOut, summary="Get a sandbox endpoint")
async def get_endpoint(endpoint_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request) -> SandboxEndpointOut:
    return sandbox_endpoint_out(await _get(session, user, endpoint_id, request))


@router.patch("/endpoints/{endpoint_id}", response_model=SandboxEndpointOut, summary="Update simulated response")
async def update_endpoint(endpoint_id: uuid.UUID, body: SandboxEndpointUpdateIn, user: CurrentUser,
                          session: SessionDep, request: Request) -> SandboxEndpointOut:
    endpoint = await _get(session, user, endpoint_id, request)
    data = body.model_dump(exclude_unset=True)
    if "application_id" in data:
        await _check_app(session, user, endpoint, endpoint.business_id, body.application_id)
        endpoint.application_id = body.application_id
    for field in ("name", "response_status", "response_delay_ms", "response_body"):
        if field in data and data[field] is not None:
            setattr(endpoint, field, data[field])
    if data.get("response_headers") is not None:
        endpoint.response_headers = validate_response_headers(data["response_headers"])
    await session.commit()
    return sandbox_endpoint_out(endpoint)


@router.delete("/endpoints/{endpoint_id}", status_code=204, summary="Delete a sandbox endpoint")
async def delete_endpoint(endpoint_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request) -> Response:
    endpoint = await _get(session, user, endpoint_id, request)
    await session.delete(endpoint)
    await session.commit()
    return Response(status_code=204)


@router.get("/endpoints/{endpoint_id}/requests", response_model=Page[SandboxRequestOut],
            summary="Captured requests (poll every 2 s with `since`)")
async def list_requests(endpoint_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request,
                        pagination: PaginationDep, since: datetime | None = Query(default=None)) -> Page[SandboxRequestOut]:
    endpoint = await _get(session, user, endpoint_id, request)
    conds = [SandboxRequest.endpoint_id == endpoint.id]
    if since is not None:
        conds.append(SandboxRequest.received_at > since)
    total = (await session.execute(select(func.count()).select_from(SandboxRequest).where(*conds))).scalar_one()
    rows = (await session.execute(
        select(SandboxRequest).where(*conds).order_by(SandboxRequest.received_at.desc(), SandboxRequest.id)
        .offset(pagination.offset).limit(pagination.page_size)
    )).scalars()
    return Page[SandboxRequestOut](items=[sandbox_request_out(r) for r in rows], total=total,
                                   page=pagination.page, page_size=pagination.page_size)


@router.delete("/endpoints/{endpoint_id}/requests", status_code=204, summary="Clear captured requests")
async def clear_requests(endpoint_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request) -> Response:
    endpoint = await _get(session, user, endpoint_id, request)
    await session.execute(delete(SandboxRequest).where(SandboxRequest.endpoint_id == endpoint.id))
    endpoint.request_count = 0
    await session.commit()
    return Response(status_code=204)


@router.get("/requests/{request_id}", response_model=SandboxRequestOut, summary="One captured request")
async def get_request(request_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request) -> SandboxRequestOut:
    row = await session.get(SandboxRequest, request_id)
    if row is None:
        raise not_found("Sandbox request")
    try:
        await _get(session, user, row.endpoint_id, request)
    except AppError as exc:
        if exc.code == "not_found":
            raise not_found("Sandbox request") from None
        raise
    return sandbox_request_out(row)


@router.post("/endpoints/{endpoint_id}/use-for/{application_id}", response_model=ApplicationOut,
             summary="Point an application's endpoint at this sandbox",
             description="Sets the endpoint URL (enabled), links the sandbox to the application (so signatures can "
                         "be verified) and adds the sandbox host to the allowlist if the application has one.")
async def use_for(endpoint_id: uuid.UUID, application_id: uuid.UUID, user: CurrentUser, session: SessionDep,
                  request: Request, client: ClientDep) -> ApplicationOut:
    endpoint = await _get(session, user, endpoint_id, request)
    app = await get_owned_application(session, user, application_id, permission="api.manage")
    if app.business_id != endpoint.business_id:
        raise validation_error("path.application_id", "application must belong to the same owner/business")
    url = sandbox_service.sandbox_url(endpoint.token)
    app.endpoint_url = url
    app.endpoint_enabled = True
    host = (urlsplit(url).hostname or "").lower()
    if app.allowed_domains and not host_matches_allowlist(host, app.allowed_domains):
        app.allowed_domains = [*app.allowed_domains, host]
    endpoint.application_id = app.id
    audit.record(session, action="endpoint.update", user_id=user.id, client=client, resource_type="application",
                 resource_id=app.id, metadata={"url": url, "via": "sandbox", "sandbox_id": str(endpoint.id)})
    await session.commit()
    return await application_out_single(session, app)


@router.post("/endpoints/{endpoint_id}/send-test", response_model=EndpointTestOut,
             summary="Send a signed test delivery to this sandbox through the real pipeline")
async def send_test(endpoint_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request) -> EndpointTestOut:
    endpoint = await _get(session, user, endpoint_id, request)
    app = await session.get(Application, endpoint.application_id) if endpoint.application_id else None
    if app is None or app.deleted_at is not None or not app.webhook_secret_encrypted:
        raise AppError(409, "sandbox_no_application", "Link this sandbox endpoint to an application first")
    result = await delivery.send_signed(
        url=sandbox_service.sandbox_url(endpoint.token),
        secret=decrypt_secret(app.webhook_secret_encrypted),
        payload=delivery.build_test_payload(app.id),
        timeout_seconds=app.endpoint_timeout_seconds,
        custom_headers=app.endpoint_custom_headers,
    )
    return EndpointTestOut(success=result.success, status_code=result.status_code, latency_ms=result.latency_ms,
                           error=result.error, error_code=result.error_code, error_ref=result.error_ref,
                           response_excerpt=result.response_excerpt)
