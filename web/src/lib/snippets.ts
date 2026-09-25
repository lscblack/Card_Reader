import type { CodeSample } from '@/components/ui/CodeBlock'

/**
 * Signature verification samples. They implement docs/API_CONTRACT.md §3–4 exactly:
 *   X-NFC-Signature: v1=<hex HMAC_SHA256(secret, "{timestamp}.{nonce}.{raw_body}")>
 *   relay  -> secret = the application's webhook secret (whsec_…)
 *   direct -> secret = hex(HMAC_SHA256(key=webhook_secret, msg="device:" + X-NFC-Device-Id))
 */

export const pythonVerify = `import hashlib
import hmac
import os
import time

WEBHOOK_SECRET = os.environ["NFC_WEBHOOK_SECRET"]  # whsec_...
TOLERANCE_SECONDS = 300  # reject timestamps older than 5 minutes


def _hmac_hex(key: bytes, msg: bytes) -> str:
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def signing_key(headers) -> bytes:
    """relay: the webhook secret. direct: the per-device key derived from it."""
    if headers.get("X-NFC-Delivery-Mode") == "direct":
        device_id = headers["X-NFC-Device-Id"]
        return _hmac_hex(WEBHOOK_SECRET.encode(), f"device:{device_id}".encode()).encode()
    return WEBHOOK_SECRET.encode()


def verify_nfc_request(headers, raw_body: bytes, seen_nonce) -> bool:
    """seen_nonce(nonce) -> True if already used (store nonces ~10 min, e.g. Redis SET NX EX)."""
    timestamp = headers.get("X-NFC-Timestamp", "")
    nonce = headers.get("X-NFC-Nonce", "")
    signature = headers.get("X-NFC-Signature", "")

    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > TOLERANCE_SECONDS:
        return False
    if not signature.startswith("v1="):
        return False

    message = f"{timestamp}.{nonce}.".encode() + raw_body  # raw bytes, NOT re-serialised JSON
    expected = _hmac_hex(signing_key(headers), message)
    if not hmac.compare_digest(expected, signature[3:]):  # constant-time
        return False
    if seen_nonce(nonce):  # replay protection
        return False
    return True


# Flask example
from flask import Flask, abort, request

app = Flask(__name__)
_nonces: set[str] = set()  # use Redis in production


def _seen(nonce: str) -> bool:
    if nonce in _nonces:
        return True
    _nonces.add(nonce)
    return False


@app.post("/api/nfc/card")
def nfc_card():
    if not verify_nfc_request(request.headers, request.get_data(), _seen):
        abort(401)
    event = request.get_json()
    # Dedupe on X-NFC-Event-Id: retries reuse the same id.
    # event["security"]["level"] == "uid_only": the UID is an identifier, not proof of identity.
    print(event["event_id"], event["card_id"])
    return "", 204
`

export const nodeVerify = `// Node.js 18+ / Express
import crypto from "node:crypto";
import express from "express";

const WEBHOOK_SECRET = process.env.NFC_WEBHOOK_SECRET; // whsec_...
const TOLERANCE_SECONDS = 300; // reject timestamps older than 5 minutes
const seenNonces = new Set(); // use Redis (SET NX EX 600) in production

const hmacHex = (key, msg) => crypto.createHmac("sha256", key).update(msg).digest("hex");

function signingKey(headers) {
  // relay: the webhook secret. direct: the per-device key derived from it.
  if (headers["x-nfc-delivery-mode"] === "direct") {
    return hmacHex(WEBHOOK_SECRET, "device:" + headers["x-nfc-device-id"]);
  }
  return WEBHOOK_SECRET;
}

function verifyNfcRequest(headers, rawBody /* Buffer */) {
  const timestamp = headers["x-nfc-timestamp"] ?? "";
  const nonce = headers["x-nfc-nonce"] ?? "";
  const signature = headers["x-nfc-signature"] ?? "";

  if (!/^\\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  if (!signature.startsWith("v1=")) return false;

  const message = Buffer.concat([Buffer.from(\`\${timestamp}.\${nonce}.\`), rawBody]);
  const expected = Buffer.from(hmacHex(signingKey(headers), message), "utf8");
  const received = Buffer.from(signature.slice(3), "utf8");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return false;

  if (seenNonces.has(nonce)) return false; // replay protection
  seenNonces.add(nonce);
  return true;
}

const app = express();

// Use the RAW body: re-serialised JSON will not match the signature.
app.post("/api/nfc/card", express.raw({ type: "application/json" }), (req, res) => {
  if (!verifyNfcRequest(req.headers, req.body)) return res.sendStatus(401);
  const event = JSON.parse(req.body.toString("utf8"));
  // Dedupe on X-NFC-Event-Id (retries reuse it). security.level === "uid_only".
  console.log(event.event_id, event.card_id);
  res.sendStatus(204);
});

app.listen(3000);
`

export const phpVerify = `<?php
// Plain PHP 8
$secret = getenv('NFC_WEBHOOK_SECRET'); // whsec_...
$tolerance = 300; // reject timestamps older than 5 minutes

$rawBody   = file_get_contents('php://input'); // raw bytes, not re-encoded JSON
$timestamp = $_SERVER['HTTP_X_NFC_TIMESTAMP'] ?? '';
$nonce     = $_SERVER['HTTP_X_NFC_NONCE'] ?? '';
$signature = $_SERVER['HTTP_X_NFC_SIGNATURE'] ?? '';
$mode      = $_SERVER['HTTP_X_NFC_DELIVERY_MODE'] ?? 'relay';
$deviceId  = $_SERVER['HTTP_X_NFC_DEVICE_ID'] ?? '';

// relay: the webhook secret. direct: the per-device key derived from it.
$key = $mode === 'direct'
    ? hash_hmac('sha256', 'device:' . $deviceId, $secret)
    : $secret;

if (!ctype_digit($timestamp) || abs(time() - (int) $timestamp) > $tolerance) {
    http_response_code(401); exit;
}
if (!str_starts_with($signature, 'v1=')) {
    http_response_code(401); exit;
}

$expected = hash_hmac('sha256', $timestamp . '.' . $nonce . '.' . $rawBody, $key);
if (!hash_equals($expected, substr($signature, 3))) { // constant-time
    http_response_code(401); exit;
}

// Replay protection: reject nonces you have already seen (e.g. Redis SET NX EX 600).
// Idempotency: dedupe on $_SERVER['HTTP_X_NFC_EVENT_ID'].

$event = json_decode($rawBody, true);
// $event['security']['level'] === 'uid_only' — a UID is not proof of identity.
http_response_code(204);
`

export const verifySamples: CodeSample[] = [
  { label: 'Python', language: 'python', code: pythonVerify },
  { label: 'Node.js', language: 'javascript', code: nodeVerify },
]

export const verifySamplesWithPhp: CodeSample[] = [...verifySamples, { label: 'PHP', language: 'php', code: phpVerify }]

export const samplePayload = `{
  "event_id": "7f1c2d3e-9a4b-4c1d-8e2f-3a4b5c6d7e8f",
  "event": "card.detected",
  "card_id": "04A1B2C3D4E5",
  "card": {
    "uid": "04A1B2C3D4E5",
    "uid_length": 6,
    "technologies": ["NfcA", "MifareUltralight"],
    "type": "mifare_ultralight"
  },
  "security": {
    "authenticated": false,
    "level": "uid_only"
  },
  "device_id": "5b0e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b",
  "application_id": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
  "delivery_mode": "relay",
  "test": false,
  "timestamp": "2026-09-25T08:30:21Z"
}`

export const sampleHeaders = `POST /api/nfc/card HTTP/1.1
Content-Type: application/json
User-Agent: NFCPlatform-Webhook/1.0
X-NFC-Event-Id: 7f1c2d3e-9a4b-4c1d-8e2f-3a4b5c6d7e8f
X-NFC-Timestamp: 1790325021
X-NFC-Nonce: 9f86d081884c7d659a2feaa0c55ad015
X-NFC-Device-Id: 5b0e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b
X-NFC-Delivery-Mode: relay
X-NFC-Signature: v1=5d41402abc4b2a76b9719d911017c592...`
