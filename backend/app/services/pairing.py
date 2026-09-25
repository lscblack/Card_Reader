"""QR pairing codes (contract 7.3)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from app.core.config import settings
from app.core.security import random_urlsafe, sha256_hex
from app.models import Application, PairingCode

PAIRING_PREFIX = "nfcp_"
PAIRING_CODE_LENGTH = 32
PAIRING_TTL = timedelta(minutes=10)


def generate_pairing_code() -> str:
    return PAIRING_PREFIX + random_urlsafe(PAIRING_CODE_LENGTH)


def new_pairing_code(app: Application, device_name: str | None) -> tuple[PairingCode, str]:
    code = generate_pairing_code()
    row = PairingCode(
        application_id=app.id,
        owner_id=app.owner_id,
        code_hash=sha256_hex(code),
        device_name=device_name,
        expires_at=datetime.now(UTC) + PAIRING_TTL,
    )
    row.application = app
    return row, code


def server_url() -> str:
    return (settings.DEVICE_SERVER_URL or settings.API_BASE_URL).rstrip("/")


def qr_payload(server: str, code: str, device_name: str | None) -> str:
    uri = f"nfcterminal://pair?v=1&server={quote(server, safe='')}&code={quote(code, safe='')}"
    if device_name:
        uri += f"&name={quote(device_name, safe='')}"
    return uri
