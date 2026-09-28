from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Response
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import ClientDep, CurrentUser, SessionDep, ensure_developer_account, platform_only
from app.core.config import settings
from app.core.errors import AppError, not_found, validation_error
from app.core.security import generate_webhook_secret
from app.models import Application, ChipRegistration, User
from app.schemas.common import Schema
from app.schemas.resources import (
    ApplicationCreatedOut,
    ApplicationCreateIn,
    ApplicationOut,
    ApplicationUpdateIn,
    AllowedDomainsIn,
    EndpointTestOut,
    PairingCodeCreatedOut,
    PairingCodeCreateIn,
    EndpointUpdateIn,
    RotateSecretIn,
    RotateSecretOut,
)
from app.services import audit, chips, delivery, pairing
from app.services import sandbox as sandbox_service
from app.api.v1.routes import sandbox as sandbox_routes
from app.services import plans as plan_service
from app.services.applications import (
    check_endpoint_url,
    get_owned_application,
    new_api_key,
    revoke_application_credentials,
    set_webhook_secret,
)
from app.services.url_validation import normalize_domain_list, url_matches_allowlist
from app.services.serializers import (
    api_key_out,
    application_out,
    application_out_single,
    device_counts,
)

router = APIRouter(prefix="/applications", tags=["Applications"], dependencies=platform_only)


@router.get("", response_model=list[ApplicationOut], summary="List applications")
async def list_applications(user: CurrentUser, session: SessionDep) -> list[ApplicationOut]:
    apps = list(
        (
            await session.execute(
                select(Application)
                .where(Application.owner_id == user.id, Application.deleted_at.is_(None),
                       Application.business_id.is_(None))
                .order_by(Application.created_at.desc())
            )
        ).scalars()
    )
    counts = await device_counts(session, [a.id for a in apps])
    return [application_out(a, counts.get(a.id, 0)) for a in apps]


@router.post(
    "",
    status_code=201,
    response_model=ApplicationCreatedOut,
    summary="Create an application",
    description=(
        "Creates the application plus a first API key and a webhook secret. "
        "`api_key_plaintext` and `webhook_secret_plaintext` are shown **once**."
    ),
)
async def create_application(
    body: ApplicationCreateIn, user: CurrentUser, session: SessionDep, client: ClientDep
) -> ApplicationCreatedOut:
    ensure_developer_account(user)
    await plan_service.ensure_can_create_application(session, user.id)
    return await create_application_record(session, user, body, client, business_id=None)


async def create_application_record(
    session: SessionDep, user: User, body: ApplicationCreateIn, client: ClientDep, business_id: uuid.UUID | None,
) -> ApplicationCreatedOut:
    """Shared by POST /applications (developer) and POST /businesses/{id}/applications (Part 2 §E)."""
    url = await check_endpoint_url(body.endpoint_url, "body.endpoint_url")
    # Part 2 §A4: the developer's first application points at their sandbox if no endpoint was given.
    auto_sandbox = None
    if url is None and settings.SANDBOX_AUTO_ATTACH and business_id is None:
        auto_sandbox = await sandbox_routes.first_app_sandbox(session, user)
        if auto_sandbox is not None:
            url = sandbox_service.sandbox_url(auto_sandbox.token)
    app = Application(
        owner_id=user.id,
        business_id=business_id,
        name=body.name,
        description=body.description,
        is_active=True,
        delivery_mode=body.delivery_mode,
        endpoint_url=url,
        endpoint_enabled=url is not None,
        endpoint_timeout_seconds=max(1, min(30, settings.WEBHOOK_TIMEOUT_SECONDS)),
        endpoint_custom_headers={},
    )
    secret = body.webhook_secret or generate_webhook_secret()
    set_webhook_secret(app, secret)
    session.add(app)
    await session.flush()
    key, plaintext = new_api_key(app, "Default key")
    session.add(key)
    if auto_sandbox is not None:
        auto_sandbox.application_id = app.id
    await session.flush()
    audit.record(session, action="application.create", user_id=user.id, client=client,
                 resource_type="application", resource_id=app.id,
                 metadata={"name": app.name, "delivery_mode": app.delivery_mode,
                           "business_id": str(business_id) if business_id else None})
    audit.record(session, action="api_key.create", user_id=user.id, client=client,
                 resource_type="api_key", resource_id=key.id,
                 metadata={"application_id": str(app.id), "prefix": key.prefix})
    await session.commit()
    return ApplicationCreatedOut(
        application=application_out(app, 0),
        api_key=api_key_out(key),
        api_key_plaintext=plaintext,
        webhook_secret_plaintext=secret,
    )


@router.get("/{application_id}", response_model=ApplicationOut, summary="Get an application")
async def get_application(application_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> ApplicationOut:
    app = await get_owned_application(session, user, application_id, permission="api.view")
    return await application_out_single(session, app)


@router.patch("/{application_id}", response_model=ApplicationOut, summary="Update an application")
async def update_application(
    application_id: uuid.UUID, body: ApplicationUpdateIn, user: CurrentUser, session: SessionDep, client: ClientDep
) -> ApplicationOut:
    app = await get_owned_application(session, user, application_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        name = (body.name or "").strip()
        if not name:
            raise validation_error("body.name", "name must not be blank")
        app.name = name
    if "description" in changes:
        app.description = body.description
    if "is_active" in changes and body.is_active is not None:
        app.is_active = body.is_active
    audit.record(session, action="application.update", user_id=user.id, client=client,
                 resource_type="application", resource_id=app.id, metadata={"fields": sorted(changes)})
    await session.commit()
    return await application_out_single(session, app)


@router.delete("/{application_id}", status_code=204, summary="Delete an application (revokes keys and devices)")
async def delete_application(
    application_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep
) -> Response:
    app = await get_owned_application(session, user, application_id, for_update=True)
    app.deleted_at = datetime.now(UTC)
    app.is_active = False
    app.endpoint_enabled = False
    await revoke_application_credentials(session, app)
    audit.record(session, action="application.delete", user_id=user.id, client=client,
                 resource_type="application", resource_id=app.id, metadata={"name": app.name})
    await session.commit()
    return Response(status_code=204)


@router.put("/{application_id}/endpoint", response_model=ApplicationOut, summary="Configure the delivery endpoint")
async def update_endpoint(
    application_id: uuid.UUID, body: EndpointUpdateIn, user: CurrentUser, session: SessionDep, client: ClientDep
) -> ApplicationOut:
    app = await get_owned_application(session, user, application_id)
    url = await check_endpoint_url(body.url, "body.url")
    if body.enabled and url is None:
        raise validation_error("body.url", "an endpoint URL is required when enabled is true")
    if not url_matches_allowlist(url, app.allowed_domains):
        raise AppError(
            422, "domain_not_allowed", "The endpoint host is not in this application's allowed domains",
            [{"field": "body.url", "message": "host not in allowed_domains: " + ", ".join(app.allowed_domains)}],
        )
    app.endpoint_url = url
    app.endpoint_enabled = body.enabled
    if body.timeout_seconds is not None:
        app.endpoint_timeout_seconds = body.timeout_seconds
    if body.custom_headers is not None:
        app.endpoint_custom_headers = body.custom_headers
    if body.delivery_mode is not None:
        app.delivery_mode = body.delivery_mode
    audit.record(
        session, action="endpoint.update", user_id=user.id, client=client,
        resource_type="application", resource_id=app.id,
        metadata={
            "url": url, "enabled": body.enabled, "delivery_mode": app.delivery_mode,
            "timeout_seconds": app.endpoint_timeout_seconds,
            "custom_header_names": sorted((app.endpoint_custom_headers or {}).keys()),
        },
    )
    await session.commit()
    return await application_out_single(session, app)


@router.post(
    "/{application_id}/endpoint/test",
    response_model=EndpointTestOut,
    summary="Send a signed test delivery",
    description='Sends `"event": "endpoint.test"`, `"test": true`, `card_id` `"TEST0000"` signed with the webhook secret.',
)
async def test_endpoint(
    application_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep
) -> EndpointTestOut:
    app = await get_owned_application(session, user, application_id)
    if not app.endpoint_url:
        raise AppError(400, "endpoint_not_configured", "Configure an endpoint URL first")
    result = await delivery.test_endpoint(app)
    app.endpoint_last_tested_at = datetime.now(UTC)
    app.endpoint_last_test_success = result.success
    audit.record(session, action="endpoint.test", user_id=user.id, client=client,
                 resource_type="application", resource_id=app.id,
                 metadata={"success": result.success, "status_code": result.status_code})
    await session.commit()
    return EndpointTestOut(
        success=result.success,
        status_code=result.status_code,
        latency_ms=result.latency_ms,
        error=result.error,
        response_excerpt=result.response_excerpt,
    )


@router.post(
    "/{application_id}/webhook-secret/rotate",
    response_model=RotateSecretOut,
    summary="Rotate the webhook secret",
    description=(
        "Generates (or sets) a new webhook secret, shown once. Takes effect immediately. "
        "In direct mode, device signing secrets change too; devices pick them up via `GET /device/config`."
    ),
)
async def rotate_secret(
    application_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep,
    body: RotateSecretIn | None = None,
) -> RotateSecretOut:
    app = await get_owned_application(session, user, application_id)
    secret = (body.webhook_secret if body else None) or generate_webhook_secret()
    set_webhook_secret(app, secret)
    audit.record(session, action="webhook_secret.rotate", user_id=user.id, client=client,
                 resource_type="application", resource_id=app.id,
                 metadata={"last4": app.webhook_secret_last4})
    await session.commit()
    assert app.webhook_secret_rotated_at is not None and app.webhook_secret_last4 is not None
    return RotateSecretOut(
        webhook_secret_plaintext=secret,
        last4=app.webhook_secret_last4,
        rotated_at=app.webhook_secret_rotated_at,
    )


@router.put(
    "/{application_id}/allowed-domains",
    response_model=ApplicationOut,
    summary="Set the endpoint domain allowlist",
    description=(
        "Entries: `api.example.com` (exact), `*.example.com` (sub-domains only, not the apex) or an IP literal. "
        "Max 20. An empty list removes the restriction. If the current endpoint would no longer match → "
        "`409 endpoint_outside_allowlist`."
    ),
)
async def set_allowed_domains(
    application_id: uuid.UUID, body: AllowedDomainsIn, user: CurrentUser, session: SessionDep, client: ClientDep
) -> ApplicationOut:
    app = await get_owned_application(session, user, application_id)
    try:
        domains = normalize_domain_list(body.domains)
    except ValueError as exc:
        raise validation_error("body.domains", str(exc)) from exc
    if not url_matches_allowlist(app.endpoint_url, domains):
        raise AppError(
            409, "endpoint_outside_allowlist",
            "The current endpoint URL does not match the new allowlist; change the endpoint first",
        )
    old = list(app.allowed_domains or [])
    app.allowed_domains = domains
    audit.record(session, action="application.allowed_domains_update", user_id=user.id, client=client,
                 resource_type="application", resource_id=app.id, metadata={"from": old, "to": domains})
    await session.commit()
    return await application_out_single(session, app)


@router.post(
    "/{application_id}/pairing-codes",
    status_code=201,
    response_model=PairingCodeCreatedOut,
    summary="Create a QR pairing code",
    description=(
        "Single-use `nfcp_` code valid for 10 minutes, bound to this application. The phone scans `qr_payload` "
        "and calls `POST /device/register` with `Authorization: Bearer nfcp_...`. The plan's device limit is "
        "checked at redemption."
    ),
)
async def create_pairing_code(
    application_id: uuid.UUID, user: CurrentUser, session: SessionDep, client: ClientDep,
    body: PairingCodeCreateIn | None = None,
) -> PairingCodeCreatedOut:
    app = await get_owned_application(session, user, application_id, permission="devices.manage")
    name = ((body.device_name if body else None) or "").strip() or None
    row, code = pairing.new_pairing_code(app, name)
    session.add(row)
    await session.flush()
    audit.record(session, action="pairing_code.create", user_id=user.id, client=client,
                 resource_type="pairing_code", resource_id=row.id,
                 metadata={"application_id": str(app.id), "device_name": name})
    await session.commit()
    server_url = pairing.server_url()
    return PairingCodeCreatedOut(
        id=row.id, code=code, expires_at=row.expires_at, server_url=server_url,
        qr_payload=pairing.qr_payload(server_url, code, name),
    )


# ── Registered cards (developer applications) ───────────────────────────────
class AppCardIn(Schema):
    uid: str = Field(min_length=4, max_length=200)
    label: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)


class AppCardPatch(Schema):
    label: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)


async def _app_chip(session: SessionDep, app: Application, chip_id: uuid.UUID) -> ChipRegistration:
    chip = (await session.execute(select(ChipRegistration).where(
        ChipRegistration.id == chip_id, ChipRegistration.application_id == app.id))).scalar_one_or_none()
    if chip is None:
        raise not_found("Card")
    return chip


@router.get("/{application_id}/cards", summary="Cards registered to this application")
async def list_app_cards(application_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> list[dict[str, Any]]:
    app = await get_owned_application(session, user, application_id, permission="api.view")
    rows = (await session.execute(select(ChipRegistration).where(ChipRegistration.application_id == app.id)
                                  .order_by(ChipRegistration.created_at.desc()))).scalars().all()
    return [chips.chip_out(c) for c in rows]


@router.post("/{application_id}/cards", status_code=201, summary="Register a card by its chip UID")
async def create_app_card(application_id: uuid.UUID, body: AppCardIn, user: CurrentUser, session: SessionDep,
                          client: ClientDep) -> dict[str, Any]:
    from app.api.v1.routes.cards import normalize_uid

    app = await get_owned_application(session, user, application_id)
    if app.business_id is not None:
        raise AppError(403, "device_is_business", "Business applications register cards in the business dashboard")
    uid = normalize_uid(body.uid)
    assert uid is not None
    await chips.ensure_free(session, uid, user_id=app.owner_id)
    chip = ChipRegistration(uid=uid, user_id=app.owner_id, application_id=app.id,
                            label=(body.label or "").strip() or f"Card {uid[-4:]}", note=body.note)
    session.add(chip)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise chips.uid_taken() from None
    audit.record(session, action="app_card.register", user_id=user.id, client=client,
                 resource_type="chip", resource_id=chip.id, metadata={"application_id": str(app.id)})
    await session.commit()
    return chips.chip_out(chip)


@router.patch("/{application_id}/cards/{chip_id}", summary="Rename a registered card")
async def update_app_card(application_id: uuid.UUID, chip_id: uuid.UUID, body: AppCardPatch, user: CurrentUser,
                          session: SessionDep) -> dict[str, Any]:
    app = await get_owned_application(session, user, application_id)
    chip = await _app_chip(session, app, chip_id)
    changes = body.model_dump(exclude_unset=True)
    if "label" in changes:
        chip.label = (body.label or "").strip() or f"Card {chip.uid[-4:]}"
    if "note" in changes:
        chip.note = body.note
    await session.commit()
    return chips.chip_out(chip)


@router.delete("/{application_id}/cards/{chip_id}", status_code=204, summary="Unregister a card")
async def delete_app_card(application_id: uuid.UUID, chip_id: uuid.UUID, user: CurrentUser, session: SessionDep,
                          client: ClientDep) -> Response:
    app = await get_owned_application(session, user, application_id)
    chip = await _app_chip(session, app, chip_id)
    await session.delete(chip)
    audit.record(session, action="app_card.unregister", user_id=user.id, client=client,
                 resource_type="chip", resource_id=chip.id, metadata={"application_id": str(app.id)})
    await session.commit()
    return Response(status_code=204)
