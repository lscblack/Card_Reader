"""ORM → API schema conversion."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.core.error_catalog import ref_for
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ApiKey, Application, AuditLog, Delivery, Device, NfcEvent, Plan, User
from app.schemas.auth import UserOut
from app.schemas.resources import (
    ApiKeyOut,
    ApplicationOut,
    AuditLogOut,
    DeliveryOut,
    DeviceOut,
    EndpointConfig,
    EventOut,
    PlanOut,
    WebhookSecretInfo,
)


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,  # type: ignore[arg-type]
        is_active=user.is_active,
        created_at=user.created_at,
        plan=user.plan_code,
        account_type=user.account_type,  # type: ignore[arg-type]
        email_verified=user.email_verified,
        email_verified_at=user.email_verified_at,
        memberships=[
            {"business_id": m.business_id, "business_name": m.business.name, "business_slug": m.business.slug,
             "role": m.role}
            for m in (user.__dict__.get("memberships") or [])
            if m.business.deleted_at is None
        ],
        avatar_url=_media(user.avatar_path),
        phone=user.phone,
        company=user.company,
        country=user.country,
        job_title=user.job_title,
        last_login_at=user.last_login_at,
        login_count=user.login_count or 0,
        preferences=dict(user.preferences or {}),
    )


def _media(path: str | None) -> str | None:
    from app.services.business import media_url

    return media_url(path)


def plan_out(plan: Plan) -> PlanOut:
    return PlanOut.model_validate(plan)


async def device_counts(session: AsyncSession, app_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not app_ids:
        return {}
    rows = await session.execute(
        select(Device.application_id, func.count())
        .where(
            Device.application_id.in_(app_ids),
            Device.status == "active",
            Device.deleted_at.is_(None),
        )
        .group_by(Device.application_id)
    )
    return {app_id: int(n) for app_id, n in rows.all()}


def application_out(app: Application, device_count: int = 0) -> ApplicationOut:
    return ApplicationOut(
        id=app.id,
        name=app.name,
        description=app.description,
        is_active=app.is_active,
        delivery_mode=app.delivery_mode,  # type: ignore[arg-type]
        endpoint=EndpointConfig(
            url=app.endpoint_url,
            enabled=app.endpoint_enabled,
            timeout_seconds=app.endpoint_timeout_seconds,
            custom_headers=dict(app.endpoint_custom_headers or {}),
            last_tested_at=app.endpoint_last_tested_at,
            last_test_success=app.endpoint_last_test_success,
        ),
        webhook_secret=WebhookSecretInfo(
            configured=app.webhook_secret_encrypted is not None,
            last4=app.webhook_secret_last4,
            rotated_at=app.webhook_secret_rotated_at,
        ),
        allowed_domains=list(app.allowed_domains or []),
        device_count=device_count,
        created_at=app.created_at,
        updated_at=app.updated_at,
    )


async def application_out_single(session: AsyncSession, app: Application) -> ApplicationOut:
    counts = await device_counts(session, [app.id])
    return application_out(app, counts.get(app.id, 0))


def api_key_out(key: ApiKey) -> ApiKeyOut:
    return ApiKeyOut(
        id=key.id,
        application_id=key.application_id,
        application_name=key.application.name,
        name=key.name,
        prefix=key.prefix,
        last4=key.last4,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
        revoked_at=key.revoked_at,
        is_active=key.is_active,
    )


def device_out(device: Device) -> DeviceOut:
    return DeviceOut(
        id=device.id,
        application_id=device.application_id,
        application_name=device.application.name,
        name=device.name,
        platform=device.platform,
        model=device.model,
        os_version=device.os_version,
        app_version=device.app_version,
        status=device.status,  # type: ignore[arg-type]
        last_seen_at=device.last_seen_at,
        last_ip=device.last_ip,
        events_count=device.events_count,
        created_at=device.created_at,
    )


def event_out(event: NfcEvent) -> EventOut:
    return EventOut(
        id=event.id,
        application_id=event.application_id,
        application_name=event.application.name,
        device_id=event.device_id,
        device_name=event.device.name if event.device is not None else None,
        event_type=event.event_type,
        card_id=event.card_id,
        card_type=event.card_type,
        card_technologies=list(event.card_technologies or []),
        authenticated=False,
        delivery_mode=event.delivery_mode,  # type: ignore[arg-type]
        status=event.status,  # type: ignore[arg-type]
        attempts=event.attempts,
        last_status_code=event.last_status_code,
        last_error=event.last_error,
        error_code=event.last_error_code,
        error_ref=ref_for(event.last_error_code),
        detected_at=event.detected_at,
        received_at=event.received_at,
        delivered_at=event.delivered_at,
    )


def delivery_out(d: Delivery) -> DeliveryOut:
    out = DeliveryOut.model_validate(d)
    out.error_ref = ref_for(d.error_code)
    return out


def audit_out(a: AuditLog) -> AuditLogOut:
    return AuditLogOut(
        id=a.id,
        action=a.action,
        resource_type=a.resource_type,
        resource_id=a.resource_id,
        ip_address=a.ip_address,
        user_agent=a.user_agent,
        metadata=dict(a.meta or {}),
        created_at=a.created_at,
    )
