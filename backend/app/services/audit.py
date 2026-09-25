"""Audit log writer."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import redact_value
from app.models import AuditLog


@dataclass(frozen=True)
class ClientInfo:
    ip: str | None
    user_agent: str | None


def record(
    session: AsyncSession,
    *,
    action: str,
    user_id: uuid.UUID | None,
    client: ClientInfo | None,
    resource_type: str | None = None,
    resource_id: uuid.UUID | str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditLog:
    """Adds an audit row to the session (committed together with the action)."""
    entry = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        ip_address=client.ip if client else None,
        user_agent=(client.user_agent or "")[:512] if client and client.user_agent else None,
        meta=redact_value(metadata or {}),
    )
    session.add(entry)
    return entry
