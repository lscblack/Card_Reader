# nexTap — API Contract (source of truth)

This file is the shared contract between `backend/` (FastAPI), `web/` (React dashboard) and
`mobile/` (Flutter nexTap app). Any change here must be mirrored in all three.

Product principle: **NFC detection → Card ID → Secure delivery.** The platform never interprets
what a card ID means. A UID is an *identifier*, not proof of identity: every event carries
`security.authenticated = false` and `security.level = "uid_only"` unless a future
cryptographic card-authentication feature says otherwise.

---

## 1. Conventions

- Base URL: `{API_BASE_URL}/api/v1` (dev: `http://127.0.0.1:8000/api/v1`).
- JSON everywhere. Timestamps are ISO-8601 UTC with `Z` (e.g. `2026-09-25T08:30:21Z`).
- All public resource IDs are UUIDv4 strings.
- Pagination (list endpoints): query `page` (1-based, default 1), `page_size` (default 20, max 100).
  Response: `{ "items": [...], "total": 123, "page": 1, "page_size": 20 }`.
- Errors (every non-2xx, including validation):
  ```json
  { "error": { "code": "invalid_credentials", "message": "Human readable", "details": null } }
  ```
  Validation errors use `code: "validation_error"` and `details` = list of `{ "field": "body.email", "message": "..." }`.
- Rate limiting (Redis sliding window): responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset`. On 429: `code: "rate_limited"` and `Retry-After` header.
  Defaults from env `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS`; auth endpoints are stricter (10/min per IP).

## 2. Credentials

| Credential | Format | Who holds it | Stored server-side as |
|---|---|---|---|
| Dashboard JWT | JWT HS256 (`sub` = user id, `role`) | Web dashboard | not stored |
| API key | `nfc_` + 48 url-safe chars | Developer (shown **once**) | SHA-256 hash + display prefix (`nfc_XXXXXXXX`) + last4 |
| Device token | `nfcd_` + 48 url-safe chars | Mobile app secure storage | SHA-256 hash |
| Webhook secret | `whsec_` + 43 url-safe chars | Developer (shown **once**) + server | Fernet-encrypted (key derived from env `WEBHOOK_SIGNING_SECRET`) |
| Device signing secret | 64 hex chars, derived | Mobile app (direct mode only) | never stored; derived on demand |

Auth headers:
- Dashboard: `Authorization: Bearer <jwt>`
- Device registration: `Authorization: Bearer nfc_...` (API key)
- All other `/device/*` calls: `Authorization: Bearer nfcd_...` (device token)

The mobile app uses the API key **only** to register, then discards it and keeps only the device token.
Secrets (keys, tokens, webhook secrets, passwords, Authorization headers) are never logged.

## 3. Delivery modes (per application)

- **`relay` (default, recommended)** — phone → platform → developer endpoint. The platform signs with the
  application's webhook secret (which never leaves the server), logs, and retries server-side
  (`WEBHOOK_MAX_RETRIES`, exponential backoff 10s, 60s, 300s…).
- **`direct`** — phone → developer endpoint directly (lowest latency). The phone signs with a
  per-device signing secret:
  `device_signing_secret = hex(HMAC_SHA256(key=webhook_secret, msg="device:" + device_id))`.
  The developer derives the same key from their webhook secret and the `X-NFC-Device-Id` header.
  The master webhook secret never reaches the phone. The phone then reports the outcome to
  `POST /device/events` so the platform can log and count it. Retries happen on the phone.

## 4. Payload sent to the developer endpoint

`POST {endpoint_url}` with `Content-Type: application/json`:

```json
{
  "event_id": "7f1c2d3e-....",
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
  "device_id": "uuid",
  "application_id": "uuid",
  "delivery_mode": "relay",
  "test": false,
  "timestamp": "2026-09-25T08:30:21Z"
}
```

`card_id` is the uppercase hex UID without separators. `card.type` may be `null`.
Test deliveries use `"event": "endpoint.test"`, `"test": true`, `card_id` `"TEST0000"`.

Headers:

| Header | Value |
|---|---|
| `User-Agent` | `nexTap-Webhook/1.0` (relay) or `nexTap-Terminal/1.0` (direct) |
| `X-NFC-Event-Id` | event UUID (use for idempotency — retries reuse it) |
| `X-NFC-Timestamp` | unix seconds (string) |
| `X-NFC-Nonce` | 32 hex chars, random per attempt |
| `X-NFC-Device-Id` | device UUID |
| `X-NFC-Delivery-Mode` | `relay` or `direct` |
| `X-NFC-Signature` | `v1=<hex HMAC_SHA256(secret, "{timestamp}.{nonce}.{raw_body}")>` |

Key encoding (clarification): HMAC keys are the secret **strings encoded as UTF-8** — relay uses the full
webhook secret including its `whsec_` prefix; direct uses the 64-char lowercase hex `signing_secret` string itself
(not hex-decoded). `device_id` in `"device:" + device_id` is the lowercase hyphenated UUID. Signatures are lowercase hex.
Endpoint test deliveries use `device_id` = `00000000-0000-0000-0000-000000000000`.

Receivers should reject timestamps older than 5 minutes, reject reused nonces, compare signatures in
constant time, and dedupe on `X-NFC-Event-Id`. A 2xx response = delivered. Anything else (or timeout) = failed.

## 5. Endpoint validation

- Must be `https://` unless `ENVIRONMENT=development`, where `http://localhost`, `http://127.0.0.1`,
  `http://10.0.2.2` and private LAN hosts are also allowed.
- In non-development environments, hosts resolving to private/loopback/link-local/metadata IPs are rejected (SSRF protection).
- Max 2048 chars, no credentials in URL (`user:pass@`), no fragments.

## 6. Endpoints

### Health
- `GET /health` → `{ "status": "ok", "database": "ok", "redis": "ok", "version": "1.0.0" }`

### Auth (dashboard)
- `POST /auth/register` `{ email, password (min 10), full_name }` → `201 { access_token, token_type: "bearer", expires_in, user }`
- `POST /auth/login` `{ email, password }` → `{ access_token, token_type, expires_in, user }`
- `GET /auth/me` → `User`
- `PATCH /auth/me` `{ full_name? }` → `User`
- `POST /auth/change-password` `{ current_password, new_password }` → `204`
- `POST /auth/forgot-password` `{ email }` → `202` always (no user enumeration)
- `POST /auth/reset-password` `{ token, new_password }` → `204`

`User` = `{ id, email, full_name, role: "developer"|"admin", is_active, created_at, plan: "free" }`

### Overview
- `GET /overview` →
  ```json
  { "applications": 2, "active_devices": 3, "active_api_keys": 2,
    "events_today": 41, "events_this_month": 812,
    "delivery_success_rate": 0.987,
    "recent_events": [Event, ...up to 10] }
  ```

### Applications
`Application` = `{ id, name, description, is_active, delivery_mode: "relay"|"direct",
endpoint: EndpointConfig, webhook_secret: { configured: bool, last4: string|null, rotated_at },
device_count, created_at, updated_at }`

`EndpointConfig` = `{ url: string|null, enabled: bool, timeout_seconds: int (1-30),
custom_headers: { [name]: value }, last_tested_at, last_test_success: bool|null }`

- `GET /applications` → `Application[]` (not paginated)
- `POST /applications` `{ name, description?, delivery_mode?, endpoint_url?, webhook_secret? }`
  → `201 { application, api_key: ApiKey, api_key_plaintext, webhook_secret_plaintext }`
  (a first API key and a webhook secret are generated automatically; plaintexts shown once.
  If the developer supplies `webhook_secret` (min 24 chars) it is used instead.)
- `GET /applications/{id}` → `Application`
- `PATCH /applications/{id}` `{ name?, description?, is_active? }` → `Application`
- `DELETE /applications/{id}` → `204` (revokes its keys and devices)
- `PUT /applications/{id}/endpoint` `{ url, enabled, timeout_seconds?, custom_headers?, delivery_mode? }` → `Application`
- `POST /applications/{id}/endpoint/test` → `{ success, status_code, latency_ms, error, response_excerpt }`
- `POST /applications/{id}/webhook-secret/rotate` `{ webhook_secret? }` → `{ webhook_secret_plaintext, last4, rotated_at }`

### API keys
`ApiKey` = `{ id, application_id, application_name, name, prefix, last4, created_at, last_used_at, revoked_at, is_active }`

- `GET /api-keys?application_id=` → `ApiKey[]`
- `POST /api-keys` `{ application_id, name }` → `201 { api_key: ApiKey, plaintext }`
- `POST /api-keys/{id}/revoke` → `ApiKey`

### Devices (dashboard)
`Device` = `{ id, application_id, application_name, name, platform, model, os_version, app_version,
status: "active"|"revoked", last_seen_at, last_ip, events_count, created_at }`

- `GET /devices?application_id=&status=` → `Device[]`
- `GET /devices/{id}` → `Device`
- `PATCH /devices/{id}` `{ name }` → `Device`
- `POST /devices/{id}/revoke` → `Device` (device token stops working immediately)
- `DELETE /devices/{id}` → `204`

### Events (dashboard)
`Event` = `{ id, application_id, application_name, device_id, device_name, event_type: "card.detected",
card_id, card_type, card_technologies: string[], authenticated: false, delivery_mode,
status: "pending"|"delivered"|"retrying"|"failed", attempts, last_status_code, last_error,
detected_at, received_at, delivered_at }`

- `GET /events?application_id=&device_id=&card_id=&status=&date_from=&date_to=&page=&page_size=` → paginated `Event`
- `GET /events/{id}` → `Event & { deliveries: Delivery[] }`

### Webhook deliveries
`Delivery` = `{ id, event_id, application_id, attempt, mode: "relay"|"direct", url, success,
status_code, latency_ms, error, response_excerpt, created_at }`

- `GET /deliveries?application_id=&success=&page=&page_size=` → paginated `Delivery`
- `POST /events/{id}/redeliver` → `Delivery` (relay: immediate signed attempt from server)

### Usage & billing
- `GET /usage?days=30` →
  ```json
  { "plan": Plan, "period_start": "...", "period_end": "...",
    "totals": { "events": 812, "delivered": 800, "failed": 12, "applications": 2, "devices": 3 },
    "limits": { "events_per_month": 10000, "applications": 3, "devices": 5 },
    "daily": [ { "date": "2026-09-01", "events": 30, "delivered": 30, "failed": 0 } ] }
  ```
- `GET /billing/plans` → `Plan[]` where `Plan` = `{ code, name, price_monthly_cents, currency, events_per_month, max_applications, max_devices, features: string[] }`
  Seeded plans: `free` (0, 10k events, 3 apps, 5 devices), `pro` (2900, 250k, 20, 100), `business` (19900, 5M, unlimited = null).
- `GET /billing/subscription` → `{ plan: Plan, status: "active", current_period_start, current_period_end }`
  (Paid upgrades are architecture-only; no payment provider yet.)

Exceeding plan limits → `402 { error: { code: "plan_limit_reached" } }`.

### Audit logs
- `GET /audit-logs?page=&page_size=` → paginated `{ id, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at }`
  Actions include: `user.register`, `user.login`, `user.password_change`, `application.create|update|delete`,
  `endpoint.update`, `endpoint.test`, `webhook_secret.rotate`, `api_key.create|revoke`,
  `device.register|revoke|delete|rename`.

### Admin (role = admin)
- `GET /admin/users?page=` → paginated `User`
- `PATCH /admin/users/{id}` `{ is_active }` → `User`
- `GET /admin/stats` → `{ users, applications, devices, events_total }`

### Device API (mobile app)
- `POST /device/register` (API key auth)
  ```json
  { "device_name": "Front desk Pixel", "platform": "android", "model": "Pixel 8",
    "os_version": "Android 15", "app_version": "1.0.0", "installation_id": "uuid generated on install" }
  ```
  → `201`
  ```json
  { "device": Device, "device_token": "nfcd_...", "config": DeviceConfig }
  ```
  Re-registering with the same `installation_id` for the same application revokes the old token and issues a new one.
- `GET /device/config` → `DeviceConfig`
- `POST /device/heartbeat` → `{ "status": "active", "server_time": "..." }`
- `POST /device/events` (header `Idempotency-Key: <event_id>` optional; `event_id` in body is authoritative)
  ```json
  { "event_id": "uuid generated on phone",
    "card_id": "04A1B2C3D4E5",
    "card_technologies": ["NfcA"],
    "card_type": "mifare_ultralight",
    "detected_at": "2026-09-25T08:30:21Z",
    "direct_delivery": null }
  ```
  - relay mode: server stores the event, makes the first signed delivery attempt synchronously
    (bounded by the endpoint timeout) and returns
    `{ "event_id", "status": "delivered"|"retrying"|"failed", "status_code", "latency_ms", "error" }`.
    If it fails, retries are scheduled server-side (status `retrying`).
  - direct mode: `direct_delivery = { "success": bool, "status_code": int|null, "latency_ms": int|null, "error": string|null, "attempt": int }`,
    server only logs → `{ "event_id", "status": "delivered"|"failed", ... }`.
  - Repeating the same `event_id` is idempotent: returns the current state of the existing event (and in direct mode records the new attempt).
  - `detected_at` older than 7 days or >5 minutes in the future → 422.
  - `card_id` must match `^[0-9A-F]{4,64}$` after normalisation (server uppercases and strips `:`/spaces).
  - Responses are `200` for both new and repeated events. The mode is chosen per request: `direct_delivery`
    present → logged as a direct attempt; absent → relayed by the server (even if the app is in direct mode,
    e.g. stale config). An `event_id` already used by another device → `409 event_id_conflict`.
    Monthly event quota exceeded → `402 plan_limit_reached`.

`DeviceConfig` =
```json
{ "device_id": "uuid", "device_name": "...",
  "application": { "id": "uuid", "name": "..." },
  "delivery_mode": "relay",
  "endpoint_url": "https://example.com/api/nfc/card",
  "endpoint_enabled": true,
  "timeout_seconds": 10,
  "max_retries": 3,
  "custom_headers": {},
  "signing_secret": null }
```
`signing_secret` is present only in `direct` mode. `custom_headers` only in direct mode (relay applies them server-side).
A revoked device gets `401 { error: { code: "device_revoked" } }`; the app must wipe its token and return to setup.

Other device/API-key error codes: `401 invalid_api_key`, `401 api_key_revoked`, `401 invalid_device_token`,
`403 application_disabled` (application paused via `is_active=false`; keep the token and retry later).
Dashboard auth: `401 unauthorized|invalid_token|token_expired|token_revoked`, `403 account_disabled`.
`change-password` and `reset-password` invalidate previously issued JWTs (the dashboard must log in again).

---

## 7. Access controls & QR pairing (v1.1)

### 7.1 Endpoint domain allowlist (per application)

`Application` gains `allowed_domains: string[]` (default `[]` = no restriction beyond section 5).

- Entries are lowercase hostnames: `api.example.com` (exact) or `*.example.com` (any subdomain, **not** the apex).
  IP literals allowed (e.g. `192.168.1.74`) for development. No scheme, port, path or wildcard in the middle.
  Max 20 entries per app.
- When non-empty, the endpoint URL's host must match an entry:
  - `PUT /applications/{id}/endpoint` with a non-matching `url` → `422 { code: "domain_not_allowed" }`.
  - Relay delivery (incl. retries, redeliver, endpoint test) re-checks before sending; a non-matching
    endpoint is not contacted and the attempt is recorded as failed with `error: "domain_not_allowed"`.
  - `DeviceConfig` includes `allowed_domains`; the phone must refuse a direct delivery to a non-matching
    host (recorded as a failed direct attempt with `error: "domain_not_allowed"`, not retried).
- `PUT /applications/{id}/allowed-domains` `{ "domains": ["api.example.com", "*.example.org"] }` → `Application`.
  If the current endpoint URL would no longer match → `409 { code: "endpoint_outside_allowlist" }`
  (change the endpoint first). Audit action `application.allowed_domains_update`.

### 7.2 Allowed dashboard/API origins (CORS, admin-managed)

Browser origins allowed by CORS = env `CORS_ORIGINS` ∪ origins stored in the database. DB origins are cached
in the API process and refreshed at most every 30 s (and immediately in the process that changed them).

`AllowedOrigin` = `{ id, origin, note, created_by (user UUID|null), created_by_email (string|null), created_at }` where `origin` is `scheme://host[:port]`
(lowercase, no path, no trailing slash; `https` required outside development).

- `GET /admin/allowed-origins` → `{ "env": ["http://localhost:5173", ...], "items": AllowedOrigin[] }`
- `POST /admin/allowed-origins` `{ origin, note? }` → `201 AllowedOrigin` (duplicate → `409 origin_exists`)
- `DELETE /admin/allowed-origins/{id}` → `204`
Audit actions `allowed_origin.create|delete`. Env origins are read-only in the UI.

### 7.3 QR pairing (register a phone without typing the API key)

Pairing code: `nfcp_` + 32 url-safe chars, stored as SHA-256 hash, **single use, expires 10 minutes** after creation.
It is bound to one application and may carry a preset device name.

Dashboard:
- `POST /applications/{id}/pairing-codes` `{ device_name? }` → `201`
  ```json
  { "id": "uuid", "code": "nfcp_...", "expires_at": "...",
    "server_url": "http://192.168.1.74:8000",
    "qr_payload": "nfcterminal://pair?v=1&server=http%3A%2F%2F192.168.1.74%3A8000&code=nfcp_...&name=Front%20desk" }
  ```
  `server_url` = `DEVICE_SERVER_URL` (fallback `API_BASE_URL`). `name` is omitted when no device name was given.
  Counts against the plan's device limit at redemption time, not creation. Audit `pairing_code.create`.
- `GET /pairing-codes/{id}` → `{ id, application_id, status: "pending"|"used"|"expired", expires_at, used_at, device: Device|null }`
  (the dashboard polls this every 2 s to show "Paired ✓").
- `POST /pairing-codes/{id}/cancel` → `204` (marks it expired).

Phone:
- `POST /device/register` accepts `Authorization: Bearer nfcp_...` in place of an API key. Same body and response.
  If the pairing code carries a device name it overrides `device_name` in the body.
  The code is consumed atomically on success. Errors: `401 invalid_pairing_code` (unknown/used/expired/cancelled).
  Audit `device.register` with `metadata.via = "pairing_code"`.
- The QR content is the `qr_payload` URI. The app parses `server`, `code`, optional `name`; it validates the server
  URL with the same rules as manual entry, shows the server host + application name after pairing, and never
  stores the pairing code.

`DeviceConfig` additionally contains `allowed_domains: string[]`.
