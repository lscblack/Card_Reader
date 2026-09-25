# NFC Platform — Backend API

FastAPI service for the NFC SaaS platform: **NFC detection → Card ID → Secure delivery.**
Developers sign up, create applications, get an API key, register Android phones as NFC readers,
and every card tap is forwarded to their endpoint as an HMAC-signed webhook.

The source of truth for the API is [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md).
Interactive docs: **`/docs`** (Swagger UI) and **`/redoc`**. They include the signature verification guide.

> A card UID is an *identifier*, not proof of identity. Every event carries
> `security.authenticated = false` and `security.level = "uid_only"`.

## Stack

Python 3.11+ · FastAPI · SQLAlchemy 2 (async, psycopg 3) · Alembic · PostgreSQL · Redis (redis-py asyncio) ·
PyJWT · argon2 · httpx · pydantic-settings · cryptography (Fernet).

## Quick start (local)

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env               # adjust DATABASE_URL / REDIS_URL; set EMAIL_ENABLED=false for local dev

# Postgres + Redis: use local services, or from the repo root:
#   docker compose up -d postgres redis
createdb -h 127.0.0.1 -U postgres nfc_platform   # if it doesn't exist yet

.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload            # http://127.0.0.1:8000/docs
```

On startup the app seeds (idempotently) the `free` / `pro` / `business` plans and the default admin from
`DEFAULT_ADMIN_*`. New users get a `free` subscription.

### Everything in Docker

```bash
docker compose up -d --build        # from the repo root; runs migrations then serves on :8000
```

### Delivery worker

Relay-mode retries live in a Redis sorted set (`nfc:delivery:queue`, scored by due time). By default a worker
runs **inside the API process** (asyncio task started in the lifespan). To run it separately:

```bash
DELIVERY_WORKER_ENABLED=false uvicorn app.main:app ...   # API processes
python -m app.workers.delivery                          # one or more worker processes
```

A per-event Redis lock prevents double processing. The database is the source of truth: events with status
`retrying` whose queue entry was lost (Redis restart) are re-queued automatically by a recovery scan.
Backoff after attempt *n*: 10s, 60s, 300s … up to `WEBHOOK_MAX_RETRIES` retries (4 attempts total by default).

## Tests

The tests run against a **real PostgreSQL database** (`nfc_platform_test`, recreated with the Alembic migrations on
each run) and **fakeredis**. Outbound webhooks are mocked with `respx`.

```bash
createdb -h 127.0.0.1 -U postgres nfc_platform_test
.venv/bin/pytest -q
# override: TEST_DATABASE_URL=postgresql+psycopg://user:pass@host:5432/db .venv/bin/pytest
```

## Configuration

See [`.env.example`](.env.example). Notable behaviour:

| Setting | Notes |
|---|---|
| `ENVIRONMENT=production` | Refuses to start if `JWT_SECRET` / `WEBHOOK_SIGNING_SECRET` are placeholders or < 32 chars, or `DEBUG=true`. Enables HTTPS enforcement + HSTS. Endpoint URLs must be `https://` and must not resolve to private/loopback/link-local/metadata IPs. |
| `WEBHOOK_SIGNING_SECRET` | Derives the Fernet key that encrypts webhook secrets at rest. **Changing it makes stored webhook secrets unreadable** — rotate every application's secret afterwards. |
| `TRUST_PROXY_HEADERS` | Honour `X-Forwarded-For` / `X-Forwarded-Proto`. Enable only behind a trusted TLS-terminating proxy. |
| `ENFORCE_HTTPS` | Blank = on in production only. Non-https requests get `403 https_required` (health checks are exempt). |
| `DELIVERY_WORKER_ENABLED` | Run the retry worker in the API process (default `true`). |
| `EMAIL_ENABLED` | When `false`, reset emails are logged instead of sent (the link is logged only in development). |
| `PASSWORD_RESET_URL` | Dashboard page receiving `?token=...`. |

## Security model

* **Passwords**: argon2id. Login timing is equalised for unknown emails. Password change / reset invalidates
  existing JWTs.
* **API keys** (`nfc_` + 48) and **device tokens** (`nfcd_` + 48): only SHA-256 hashes are stored; lookups compare
  in constant time; `last_used_at` / `last_seen_at` are updated; revocation is immediate.
* **Webhook secrets** (`whsec_` + 43): Fernet-encrypted at rest, shown once. Direct-mode devices only ever receive
  the derived per-device secret.
* **Rate limiting**: Redis sliding window per API key / device token / user / IP; auth endpoints 10/min per IP.
  If Redis is down the limiter fails open (logged), and `/health` reports `redis: "error"`.
* **SSRF**: endpoint URLs are validated on save and again before every delivery; redirects are never followed.
* **Logging**: a redaction filter scrubs `Authorization` / Bearer values, `nfc_…`, `nfcd_…`, `whsec_…` tokens,
  passwords and URL credentials from every log record. Each request gets an `X-Request-ID`.
* **Audit log**: every action in the contract is recorded with IP address and user agent.

## Verifying webhook signatures (receivers)

Headers on every delivery: `X-NFC-Event-Id`, `X-NFC-Timestamp` (unix seconds), `X-NFC-Nonce`,
`X-NFC-Device-Id`, `X-NFC-Delivery-Mode` (`relay` | `direct`), `X-NFC-Signature: v1=<hex>`.

```
signature = hex(HMAC_SHA256(key, "{timestamp}.{nonce}." + raw_body))
key (relay)  = webhook_secret                       # the full "whsec_..." string, UTF-8
key (direct) = hex(HMAC_SHA256(webhook_secret, "device:" + X-NFC-Device-Id))   # 64-char hex string, UTF-8
```

Reject timestamps older than 5 minutes, reject reused nonces, compare in constant time, dedupe on
`X-NFC-Event-Id`, and reply `2xx` quickly.

**Python**

```python
import hashlib, hmac, time

def verify(webhook_secret: str, headers: dict, raw_body: bytes) -> bool:
    ts, nonce, sig = headers["X-NFC-Timestamp"], headers["X-NFC-Nonce"], headers["X-NFC-Signature"]
    if abs(time.time() - int(ts)) > 300:
        return False
    key = webhook_secret
    if headers.get("X-NFC-Delivery-Mode") == "direct":
        key = hmac.new(webhook_secret.encode(), f"device:{headers['X-NFC-Device-Id']}".encode(),
                       hashlib.sha256).hexdigest()
    expected = hmac.new(key.encode(), f"{ts}.{nonce}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"v1={expected}", sig)
```

**Node.js**

```js
const crypto = require("crypto");
const hmacHex = (key, msg) => crypto.createHmac("sha256", key).update(msg).digest("hex");

function verify(webhookSecret, headers, rawBody /* Buffer */) {
  const ts = headers["x-nfc-timestamp"], nonce = headers["x-nfc-nonce"], sig = headers["x-nfc-signature"] || "";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = headers["x-nfc-delivery-mode"] === "direct"
    ? hmacHex(webhookSecret, `device:${headers["x-nfc-device-id"]}`)
    : webhookSecret;
  const expected = Buffer.from("v1=" + hmacHex(key, Buffer.concat([Buffer.from(`${ts}.${nonce}.`), rawBody])));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
```

Complete runnable receivers (with nonce replay protection and event dedupe) are in
[`examples/receiver_fastapi.py`](examples/receiver_fastapi.py) and
[`examples/receiver_express.js`](examples/receiver_express.js). Both are exercised by the test suite.

## Layout

```
app/
  main.py                 app factory, middleware (request id, HTTPS, rate limit, security headers), lifespan
  core/                   config, security (hashing/JWT/signing/Fernet), logging (redaction), errors, rate_limit, redis
  db/                     declarative base, async engine/session
  models/                 users, plans, subscriptions, applications, api_keys, devices, nfc_events,
                          deliveries, usage_daily, audit_logs, password_reset_tokens
  schemas/                pydantic request/response models
  api/v1/routes/          auth, account (overview/usage/billing/audit), applications, api_keys, devices,
                          events (+deliveries), admin, device_api, health
  services/               delivery (sign/send/queue/worker), url_validation (SSRF + domain allowlist), origins (CORS),
                          pairing, plans, usage, audit, email, seed
  workers/delivery.py     `python -m app.workers.delivery`
alembic/                  migrations
examples/                 signature-verifying webhook receivers
tests/                    pytest suite (real Postgres + fakeredis + respx)
```

## Access controls & QR pairing (contract §7)

* **Endpoint domain allowlist** (`PUT /applications/{id}/allowed-domains`): exact hosts, `*.example.com`
  (sub-domains only, never the apex) or IP literals, max 20. Enforced when saving the endpoint
  (`422 domain_not_allowed`) and before every relay attempt, retry, redelivery and endpoint test (the endpoint
  is not contacted; the attempt is recorded as failed with `domain_not_allowed` and not retried). Shrinking the
  list below the current endpoint → `409 endpoint_outside_allowlist`. Sent to phones in `DeviceConfig.allowed_domains`.
* **CORS origins** = env `CORS_ORIGINS` ∪ `allowed_origins` table (`/admin/allowed-origins`). Each process
  caches the DB set for ≤ 30 s (refreshed only when a request carries an `Origin` header) and reloads
  immediately after an admin change in that process (`app/core/cors.py`, `app/services/origins.py`).
* **QR pairing codes** (`nfcp_` + 32, SHA-256 hashed, single use, 10-minute expiry). `POST /device/register`
  accepts `Bearer nfcp_...`; the code is consumed with a conditional `UPDATE … RETURNING` in the registration
  transaction, so of two concurrent redemptions exactly one succeeds, and a failed registration
  (e.g. `402` device limit) leaves the code unused. `server_url` in the QR payload is `DEVICE_SERVER_URL`
  (fallback `API_BASE_URL`), which must be reachable from the phone (e.g. the LAN IP, not 127.0.0.1).

## Part 2: business accounts, sandbox, observability (`docs/PART2_CONTRACT.md`)

* **Error catalog** (`app/core/error_catalog.py`, served at `GET /api/v1/errors`): every error body carries
  `ref` (`NFC-xxxx`), `request_id` and `docs_url`; delivery attempts record `error_code`/`error_ref`.
  A test scans the codebase and fails if any emitted code is missing from the catalog.
* **Request logs**: every request (except health/docs/static) is captured without bodies or secrets, with an
  HMAC'd IP (`ip_hash`) and country only from a trusted proxy header. Entries are pushed to a Redis list in a
  background task and flushed in batches by every API process (and the standalone worker); if Redis is down they go
  to a bounded in-process buffer. Retention (`platform_settings.request_log_retention_days`) is purged daily.
* **Sandbox**: `ANY /sandbox/{token}` captures requests, verifies signatures (relay + direct), runs checks and
  simulates status/delay/body. Each developer gets one on sign-up; their first application uses it when
  `SANDBOX_AUTO_ATTACH=true`.
* **Business domain**: permissions live in `app/services/permissions.py` and are enforced by one dependency
  (`business_permission(...)` in `app/api/deps.py`); Part 1 endpoints authorise business applications through
  `authorize_application()`. Taps (`GET /t/{code}` and reader events) share `card_taps`; bots are recorded but
  excluded from counters and analytics.
* **Media**: logos/photos (PNG/JPEG/WebP ≤ 2 MB, sniffed by magic bytes) under `MEDIA_ROOT`, served at `/media`.
* **Demo data** (`SEED_DEMO_DATA=true` and `ENVIRONMENT=development` only): `developer.demo@example.com` and
  `business.demo@example.com`, password `DEMO_PASSWORD` (default `DemoPassword123`).

## Part 3: branding, pricing, emails, live mode, app releases (`docs/PART3_CONTRACT.md`)

* **Docs are off by default** (`API_DOCS_ENABLED=false`): `/docs`, `/redoc` and `/openapi.json` return 404.
* **Branding** lives in `platform_settings` (key `branding`), served at `/meta/branding` with an ETag; uploaded SVGs are
  rebuilt by an allowlist sanitiser (`app/services/svg_sanitizer.py`).
* **Emails** use Jinja2 templates in `app/templates/email/` (HTML + text); every send is logged in `email_logs`, and
  one-time links are replaced with `[link removed]` in stored copies. Admin campaigns are queued and sent by the worker.
* **Live mode**: `GET /api/v1/live/applications/{id}` streams SSE from Redis pub/sub, with replay from a capped Redis stream.
* **App builds**: with `APP_BUILD_ENABLED=true` the worker runs
  `FLUTTER_BIN build apk --<type> --build-name --build-number --dart-define=API_BASE_URL` (no shell) in
  `MOBILE_PROJECT_DIR`, one at a time. APKs land in `MEDIA_ROOT/releases/` and are served from `/downloads/android/latest`.

## Implementation notes

* `usage_daily` holds per-application daily counters (`events`, `delivered`, `failed`) keyed by the event's
  received date (UTC); status transitions keep them exact (e.g. failed → delivered after a redelivery).
  Monthly quotas and dashboards read these counters instead of scanning events.
* Applications and devices are soft-deleted so event history survives; deleting an application revokes its
  keys and devices immediately.
* `POST /device/events` returns `200` for new and repeated events. A request containing `direct_delivery` is logged as a
  direct attempt; without it the server relays (also covers phones with stale config).
* `POST /events/{id}/redeliver` always makes a relay-signed attempt from the server.
* `delivery_success_rate` is `delivered / (delivered + failed)` for the current month, `0.0` when there is no data.
