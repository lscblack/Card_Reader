"""Digital-card share tokens (Part 4 §3) — reference implementation.

Binary layout (41 bytes):

    offset  size  field
    0       1     version   = 0x01
    1       16    share_id  (UUID, RFC 4122 big-endian byte order = uuid.bytes)
    17      4     key_id    (uint32, big-endian)
    21      4     issued_at (uint32, big-endian, unix seconds)
    25      16    mac       = HMAC_SHA256(key = share-key secret (raw 32 bytes), msg = bytes[0:25])[0:16]

Text form: base64url of the 41 bytes **without padding** → always 55 characters.
The share-key secret is transported as base64url (no padding) of the 32 raw bytes; decode it before HMACing.

Validity window on the server: now - 600 s ≤ issued_at ≤ now + 120 s.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import struct
import uuid
from dataclasses import dataclass

VERSION = 1
TOKEN_BYTES = 41
TOKEN_CHARS = 55
MAX_AGE_SECONDS = 600
MAX_SKEW_SECONDS = 120
SELECT_APDU = bytes.fromhex("00A4040007F04E4643444301" + "00")
RESPONSE_PREFIX = b"NFCDC"
STATUS_OK = bytes.fromhex("9000")


class TokenError(ValueError):
    """code: invalid_card_token | card_token_expired"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ParsedToken:
    share_id: uuid.UUID
    key_id: int
    issued_at: int
    signed: bytes  # first 25 bytes
    mac: bytes


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    text = text.strip()
    if not text or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for c in text):
        raise ValueError("not base64url")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def compute_mac(secret: bytes, signed: bytes) -> bytes:
    return hmac.new(secret, signed, hashlib.sha256).digest()[:16]


def encode_token_bytes(secret: bytes, share_id: uuid.UUID, key_id: int, issued_at: int) -> bytes:
    if len(secret) != 32:
        raise ValueError("share-key secret must be 32 bytes")
    signed = struct.pack(">B16sII", VERSION, share_id.bytes, key_id, issued_at)
    return signed + compute_mac(secret, signed)


def encode(secret: bytes, share_id: uuid.UUID, key_id: int, issued_at: int) -> str:
    return b64url_encode(encode_token_bytes(secret, share_id, key_id, issued_at))


def parse(token: str) -> ParsedToken:
    """Structural parse only (no MAC/time check)."""
    try:
        raw = b64url_decode(token)
    except (ValueError, TypeError) as exc:
        raise TokenError("invalid_card_token", "token is not base64url") from exc
    if len(token.strip()) != TOKEN_CHARS or len(raw) != TOKEN_BYTES:
        raise TokenError("invalid_card_token", "token has the wrong length")
    if raw[0] != VERSION:
        raise TokenError("invalid_card_token", "unsupported token version")
    _, share_bytes, key_id, issued_at = struct.unpack(">B16sII", raw[:25])
    return ParsedToken(uuid.UUID(bytes=share_bytes), key_id, issued_at, raw[:25], raw[25:])


def verify_mac(parsed: ParsedToken, secret: bytes) -> bool:
    return hmac.compare_digest(compute_mac(secret, parsed.signed), parsed.mac)


def check_time(parsed: ParsedToken, now: int) -> None:
    if parsed.issued_at > now + MAX_SKEW_SECONDS:
        raise TokenError("invalid_card_token", "token issued in the future")
    if parsed.issued_at < now - MAX_AGE_SECONDS:
        raise TokenError("card_token_expired", "token is older than 10 minutes")


def hce_response(token_bytes: bytes) -> bytes:
    """What the phone returns to the digital-card SELECT: 'NFCDC' ‖ token (41) ‖ 90 00."""
    return RESPONSE_PREFIX + token_bytes + STATUS_OK
