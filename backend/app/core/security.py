"""Credentials: passwords, JWTs, API keys, device tokens, webhook secrets, signatures."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import string
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

URLSAFE_ALPHABET = string.ascii_letters + string.digits + "-_"
DEVICE_TOKEN_PREFIX = "nfcd_"
DEVICE_TOKEN_LENGTH = 48
WEBHOOK_SECRET_PREFIX = "whsec_"
JWT_ALGORITHM = "HS256"

_hasher = PasswordHasher()
# Used to equalise timing when the user does not exist.
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


# ── Passwords ────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# ── Random tokens & hashing ─────────────────────────────────────────────
def random_urlsafe(length: int) -> str:
    return "".join(secrets.choice(URLSAFE_ALPHABET) for _ in range(length))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def generate_api_key() -> str:
    return settings.API_KEY_PREFIX + random_urlsafe(settings.API_KEY_LENGTH)


def api_key_display_prefix(key: str) -> str:
    return key[: len(settings.API_KEY_PREFIX) + 8]


def generate_device_token() -> str:
    return DEVICE_TOKEN_PREFIX + random_urlsafe(DEVICE_TOKEN_LENGTH)


def generate_webhook_secret() -> str:
    return WEBHOOK_SECRET_PREFIX + secrets.token_urlsafe(32)  # 43 chars


def generate_reset_token() -> str:
    return secrets.token_urlsafe(32)


# ── JWT ──────────────────────────────────────────────────────────────────
def create_access_token(user_id: uuid.UUID, role: str, session_id: uuid.UUID) -> tuple[str, int]:
    """Dashboard JWT bound to a web session (`sid`): revoking the session (sign-in elsewhere, logout) ends it."""
    now = datetime.now(UTC)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
        "jti": uuid.uuid4().hex,
        "sid": str(session_id),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=JWT_ALGORITHM), expires_in


def decode_access_token(token: str) -> dict[str, Any]:
    """Raises jwt.PyJWTError on any problem."""
    payload = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[JWT_ALGORITHM],
        options={"require": ["sub", "exp", "iat"]},
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return payload


# ── Webhook secret encryption at rest ───────────────────────────────────
@lru_cache
def _fernet(secret: str) -> Fernet:
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"nfc-platform",
        info=b"webhook-secret-encryption-v1",
    ).derive(secret.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(plaintext: str) -> str:
    return _fernet(settings.WEBHOOK_SIGNING_SECRET).encrypt(plaintext.encode("utf-8")).decode()


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet(settings.WEBHOOK_SIGNING_SECRET).decrypt(ciphertext.encode()).decode("utf-8")
    except InvalidToken as exc:  # pragma: no cover - misconfiguration
        raise RuntimeError(
            "Cannot decrypt webhook secret (was WEBHOOK_SIGNING_SECRET changed?)"
        ) from exc


# ── Webhook signing ─────────────────────────────────────────────────────
def sign_payload(secret: str, timestamp: str, nonce: str, raw_body: bytes) -> str:
    """`v1=` + hex HMAC_SHA256(secret, "{timestamp}.{nonce}.{raw_body}")."""
    message = f"{timestamp}.{nonce}.".encode("utf-8") + raw_body
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"v1={digest}"


def derive_device_signing_secret(webhook_secret: str, device_id: uuid.UUID | str) -> str:
    """hex(HMAC_SHA256(key=webhook_secret, msg="device:" + device_id))."""
    msg = f"device:{str(device_id).lower()}".encode("utf-8")
    return hmac.new(webhook_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def new_nonce() -> str:
    return secrets.token_hex(16)
