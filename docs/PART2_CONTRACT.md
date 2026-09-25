# Part 2 Contract — Business Accounts, Platform Observability, Sandbox, Error Catalog

Extends `docs/API_CONTRACT.md` (Part 1, which stays valid and backward compatible). Same conventions:
base `/api/v1`, UUIDs, ISO-8601 `Z` timestamps, `{items,total,page,page_size}` pagination, error envelope.
Anything not specified here: follow Part 1 conventions and the existing code.

**Backward compatibility is mandatory.** Existing developer accounts, devices, API keys, events, pairing,
direct/relay delivery and the mobile app must keep working unchanged. Every schema change is additive
(new nullable columns / new tables / new optional response fields).

---

## A. Platform-wide changes

### A1. Error envelope + error catalog

Envelope gains optional fields (additive — existing clients keep reading `code`/`message`/`details`):

```json
{ "error": { "code": "invalid_api_key", "message": "…", "details": null,
             "ref": "NFC-1003", "request_id": "3f9c…", "docs_url": "{PUBLIC_WEB_URL}/docs/errors#NFC-1003" } }
```

- `ref` is a stable catalog id. Ranges: `NFC-1xxx` auth/session/credentials, `NFC-2xxx` request/validation/rate limit,
  `NFC-3xxx` applications/keys/endpoints/allowlists, `NFC-4xxx` devices/events/pairing, `NFC-5xxx` webhook delivery
  failures, `NFC-6xxx` business domain, `NFC-7xxx` plans/billing/limits, `NFC-8xxx` sandbox/admin, `NFC-9xxx`
  server/infrastructure, `MOB-1xxx` mobile-app-side failures (NFC hardware, offline, TLS, signing…).
- **Every** error the API can return has a catalog entry (including 404/405/422/429/500/503). Unknown internal
  errors → `internal_error` / `NFC-9000` with `request_id` so it can be found in request logs.
- Delivery attempts get `error_code` + `error_ref` (e.g. `delivery_timeout`/`NFC-5001`, `delivery_connection_refused`,
  `delivery_dns_failure`, `delivery_tls_error`, `delivery_http_4xx`, `delivery_http_5xx`, `delivery_redirect_blocked`,
  `domain_not_allowed`, `delivery_ssrf_blocked`, `endpoint_disabled`, `endpoint_not_configured`,
  `delivery_response_too_large`). `Delivery` and `Event` responses gain `error_code`, `error_ref` (nullable).
- `GET /errors` (public, no auth) →
  `[{ "code", "ref", "http_status": int|null, "source": "api"|"delivery"|"mobile", "title", "description", "fix" }]`.
  This is the single source of truth for docs; the mobile app keeps a local copy of the `MOB-*` entries.

### A2. Request logs (audit of every request — successful and failed)

Every HTTP request (API, device, public tap, sandbox receiver; excluding `/health`, `/docs`, `/openapi.json`, static)
is recorded **without bodies or secrets**:

`RequestLog` = `{ id, created_at, request_id, method, route (template, e.g. /api/v1/applications/{id}), path,
status_code, outcome: "success"|"client_error"|"server_error", latency_ms, error_code, error_ref,
actor_type: "user"|"api_key"|"device"|"pairing_code"|"public"|"anonymous", actor_id, user_id, business_id,
application_id, device_id, ip_hash, user_agent (≤256 chars), country (from trusted proxy header only, else null) }`

- Written asynchronously (buffer in Redis list → flushed in batches by the worker; never slows or fails the request;
  if Redis is down, fall back to a bounded in-process buffer, drop with a warning when full).
- `ip_hash = HMAC_SHA256(server secret, ip)` — raw IPs are not stored in request logs.
- Retention: `platform_settings.request_log_retention_days` (default 90), purged daily by the worker.
- `GET /request-logs?status=&outcome=&route=&error_code=&application_id=&device_id=&date_from=&date_to=&request_id=&page=`
  → paginated, scoped to what the caller owns (developer: own apps/devices + own dashboard requests;
  business member with `api.view`: the business's apps/devices/public taps).
- `GET /request-logs/{id}` → one log (same scoping).

### A3. Account types, registration & email verification

`User` gains: `account_type: "developer"|"business"` (existing rows = `developer`), `email_verified: bool`,
`email_verified_at`, `memberships: [{ business_id, business_name, business_slug, role }]` (in `/auth/me` and login).
Admin stays `role = "admin"` (any account type).

- `POST /auth/register` gains optional `account_type` (default `developer` → exactly the old behaviour) and, for
  `business`, a required `business` object:
  `{ name, email, phone, country (ISO-3166 alpha-2), category, description, website?, address? }`
  plus optional `invite_token` (joining an existing business as a team member — then `business` is not required).
  Business registration atomically creates user + Business workspace + owner membership + default
  "Business Terminal" application (see B8) + business subscription (plan `biz_starter`).
- `POST /auth/verify-email` `{ token }` → `204`. `POST /auth/resend-verification` → `202`.
  Tokens hashed, single-use, 48 h. When `ENVIRONMENT=development` and email is disabled, register/resend responses
  include `dev_verification_url` (never in production).
- Unverified **business** workspaces can configure everything, but public profile/tap pages show a neutral
  "This business hasn't been verified yet" page. Developers: verification is shown as a banner only (non-blocking).
- `GET /meta/business-categories` (public) → `[{ code, label }]` (served by backend, not hardcoded in the UI).
- `GET /billing/plans` becomes public (used by the marketing page) and each plan gains `audience: "developer"|"business"`.

### A4. Sandbox (developer test endpoint)

A platform-hosted receiver that shows developers everything the platform/phone sends and simulates any response.

`SandboxEndpoint` = `{ id, name, url, token, application_id|null (used to verify signatures), response_status (100-599,
default 200), response_delay_ms (0-15000; > endpoint timeout simulates a timeout), response_body (≤4 KB, default
{"ok":true}), response_headers {}, request_count, last_request_at, created_at }`
`url = {PUBLIC_API_URL}/sandbox/{token}` (token 24 url-safe chars).

- Receiver (root path, no `/api/v1`, no auth): `ANY /sandbox/{token}` → stores the request, waits `response_delay_ms`,
  responds with the configured status/body/headers. Rate limited per token. Max body 64 KB (larger → 413 stored as failed).
- `SandboxRequest` = `{ id, endpoint_id, received_at, method, path, query, headers (all; `Authorization` values masked),
  body (text), body_json|null, size_bytes, source_ip_hash, signature: { status: "valid"|"invalid"|"missing"|
  "unverifiable", mode: "relay"|"direct"|null, reason: string|null, error_ref|null },
  checks: [{ name, passed, detail }] (timestamp skew ≤ 5 min, nonce unused, event_id format, payload schema,
  device known, card_id format…), response_status, response_delay_ms, event_id|null, device_id|null }`
  Keeps the last 500 requests per endpoint.
- Dashboard API (developer, or business member with `api.manage` via `?business_id=`):
  `GET/POST /sandbox/endpoints`, `GET/PATCH/DELETE /sandbox/endpoints/{id}`,
  `GET /sandbox/endpoints/{id}/requests?page=&since=` (poll every 2 s), `GET /sandbox/requests/{id}`,
  `DELETE /sandbox/endpoints/{id}/requests`, `POST /sandbox/endpoints/{id}/use-for/{application_id}` (sets that
  application's endpoint URL to the sandbox URL and adds its host to the allowlist if an allowlist exists),
  `POST /sandbox/endpoints/{id}/send-test` (runs the real signed delivery pipeline to it).
- Every new developer account gets one sandbox endpoint automatically; the first created application uses it as its
  endpoint if the developer didn't provide one.
- Demo data (only when `SEED_DEMO_DATA=true` **and** `ENVIRONMENT=development`): demo developer
  `developer.demo@example.com` and demo business `business.demo@example.com`, both password `DemoPassword123`
  (overridable via env), with apps wired to sandbox endpoints, sample devices, events, cards, employees, taps.
  Idempotent. Never in production.

### A5. Admin console (role = admin) — monitor and change everything

All `/admin/*` require admin; every mutating admin action is audited (`admin.*`).

- `GET /admin/overview?range=1h|24h|7d|30d` → `{ users: {total, developers, businesses, active_24h, new_in_range},
  businesses, applications, devices: {total, online, offline, revoked}, events_in_range, taps_in_range,
  requests: {total, success, client_error, server_error, error_rate, p50_ms, p95_ms, p99_ms, rpm_now},
  deliveries: {total, succeeded, failed, success_rate, queue_depth}, top_errors: [{error_code, error_ref, count}],
  top_routes: [{route, count, error_rate, p95_ms}], timeline: [{bucket, requests, errors, p95_ms, events}] }`
- `GET /admin/request-logs` (all filters from A2 + `user_id`, `business_id`, `actor_type`, `min_latency_ms`) and `GET /admin/request-logs/{id}`.
- `GET /admin/accounts?type=&q=&status=&page=` → users with `{ …User, plan, business: {id,name,status}|null,
  stats: { requests_24h, error_rate_24h, events_30d, devices, applications, last_active_at } }`.
  `GET /admin/accounts/{id}` → detail incl. apps, devices, recent request logs, audit logs.
  `PATCH /admin/accounts/{id}` `{ is_active?, role?, plan_code?, email_verified? }`.
- `GET /admin/businesses?q=&status=` / `GET /admin/businesses/{id}` / `PATCH /admin/businesses/{id}` `{ status: "active"|"suspended", plan_code? }`
  (suspended → its devices get `403 business_suspended`, public pages show neutral page).
- `GET /admin/devices?status=&online=&q=` → all devices with owner, business, `online` (heartbeat/event within 2 min), last_seen_at.
  `POST /admin/devices/{id}/revoke`. `POST /admin/api-keys/{id}/revoke`.
- `GET /admin/deliveries?success=&error_code=` (all), `GET /admin/system` →
  `{ database, redis, worker: {alive, last_heartbeat_at}, delivery_queue_depth, request_log_buffer_depth, version, environment }`.
- `GET /admin/settings` / `PATCH /admin/settings` → `platform_settings`: `{ signups_enabled: {developer, business},
  request_log_retention_days, default_rate_limit: {requests, window_seconds}, maintenance_message|null }`.
- Existing `/admin/users`, `/admin/stats`, `/admin/allowed-origins` stay.

---

## B. Business domain

All business routes are `/businesses/{business_id}/…` and require membership. Permission failures →
`403 { code: "insufficient_permissions", ref: NFC-6003, details: { required: "cards.manage" } }`.

### B1. Roles & permissions

| permission | owner | admin | manager | staff |
|---|---|---|---|---|
| `business.view` (overview, read cards/tags/employees/customers/events/profiles) | ✓ | ✓ | ✓ | ✓ |
| `cards.manage` (cards, tags, actions, assignments) | ✓ | ✓ | ✓ | – |
| `people.manage` (employees, customers) | ✓ | ✓ | ✓ | – |
| `profiles.manage` | ✓ | ✓ | ✓ | – |
| `devices.manage` | ✓ | ✓ | ✓ | – |
| `analytics.view` | ✓ | ✓ | ✓ | – |
| `api.view` / `api.manage` (apps, keys, webhooks, sandbox, request logs) | ✓ | ✓ | – | – |
| `team.manage` | ✓ | ✓ (not owners) | – | – |
| `settings.manage` | ✓ | ✓ | – | – |
| `billing.manage`, `business.delete`, `ownership.transfer` | ✓ | – | – | – |

Owners/admins can grant extra permissions to a member (`extra_permissions: string[]`, never billing/delete/transfer).
`GET /businesses/{id}/me` → `{ role, permissions: string[] }` (UI hides what the member can't do; backend enforces).

### B2. Business & settings

`Business` = `{ id, name, slug, email, phone, country, category, description, website, address, logo_url,
status: "active"|"suspended", verified: bool, settings: { devices_can_register_cards: bool (default true),
default_card_action: Action|null, timezone }, plan, created_at }`

- `GET /businesses` (mine), `GET /businesses/{id}`, `PATCH /businesses/{id}` (`settings.manage`),
  `DELETE /businesses/{id}` (owner; soft delete, revokes devices/keys, unpublishes profiles).
- `POST /businesses/{id}/logo` (multipart, png/jpeg/webp ≤ 2 MB → stored under `MEDIA_ROOT`, served at `/media/...`).
  Same upload endpoint pattern for employee photos: `POST /businesses/{id}/employees/{eid}/photo`.
- Slug: unique, lowercase `[a-z0-9-]{3,48}`, generated from name, changeable (old slug keeps redirecting for 90 days).

### B3. Employees & customers

`Employee` = `{ id, business_id, first_name, last_name, full_name, photo_url, position, department, phone, email,
social_links: [{platform, url}], slug, status: "active"|"inactive", profile_published: bool, cards: [CardSummary],
total_taps, last_tap_at, created_at }`
`Customer` = `{ id, business_id, full_name, email, phone, company, notes, tags: string[], status: "active"|"inactive",
cards: [CardSummary], total_taps, last_tap_at, created_at }`

- CRUD: `GET/POST /businesses/{id}/employees`, `GET/PATCH/DELETE …/employees/{eid}`, same for `/customers`.
  List filters: `q` (search name/email/phone/position), `status`, `department`, `page`.
- `POST …/employees/{eid}/deactivate` / `activate`: deactivation **immediately** disables the employee's cards
  (effective status `inactive_owner`) and unpublishes their profile; reactivation restores both.

### B4. NFC cards & tags

One model, `kind: "card"` (held by a person) or `"tag"` (placed on a thing: table, product, poster, door).

`Card` = `{ id, business_id, kind, name, uid|null, uid_masked, public_code, tap_url, status: "active"|"inactive",
effective_status: "active"|"inactive"|"inactive_owner"|"unassigned"|"business_suspended",
assignee: { type: "employee"|"customer", id, name, photo_url }|null, profile_id|null, action: Action|null
(null → business default action → business profile), programmed: bool, programmed_at, total_taps,
unique_visitors, last_tap_at, created_at }`

- `tap_url = {PUBLIC_API_URL}/t/{public_code}`; `public_code` = 10 random base62 chars (unguessable, not the UID).
- CRUD: `GET/POST /businesses/{id}/cards?kind=&status=&assignee_type=&q=&page=`, `GET/PATCH/DELETE …/cards/{cid}`.
  `uid` unique per business (`409 card_uid_exists`); normalised like Part 1 `card_id`.
- `POST …/cards/{cid}/assign` `{ assignee_type, assignee_id }` / `POST …/cards/{cid}/unassign` → records history.
- `POST …/cards/{cid}/activate|deactivate`.
- `GET …/cards/{cid}/history` → assignment + status changes + programming (who, when).
- `GET …/cards/{cid}/taps?page=` and `GET …/cards/{cid}/stats?range=` → `{ total_taps, unique_visitors, timeline, by_source, by_device_type, by_country }`.
- Bulk: `POST …/cards/bulk` `{ count (1-500), kind, name_prefix }` → creates unprogrammed cards (for printing batches).

### B5. Actions (what a tap does — no code needed)

`Action` = `{ type, config, label? }`. Types and required `config`:

| type | config | tap result |
|---|---|---|
| `website` / `custom_url` | `{ url }` (https; http only in dev) | 302 to url |
| `business_profile` | `{}` | 302 to `/b/{slug}` |
| `employee_profile` | `{ employee_id? }` (default: card assignee) | 302 to `/b/{slug}/{employee.slug}` |
| `profile` | `{ profile_id }` (custom/menu/product profile) | 302 to profile page |
| `share_contact` | `{ employee_id? }` | serves `text/vcard` (assignee or business) |
| `whatsapp` | `{ phone (E.164), message? }` | 302 `https://wa.me/…?text=` |
| `phone_call` | `{ phone }` | page with a call button → `tel:` (browsers block direct tel redirects in some cases) |
| `email` | `{ to, subject?, body? }` | page/302 `mailto:` |
| `maps` | `{ query?, lat?, lng? }` (one of) | 302 Google Maps URL |
| `social` | `{ platform, url }` | 302 url |
| `digital_menu` | `{ profile_id? , url? }` (one of) | menu profile page or url |
| `product_info` | `{ profile_id?, url? }` | product profile page or url |
| `wifi` | `{ ssid, password?, security: "WPA"|"WEP"|"nopass", hidden? }` | page showing network + copy password + Android `WIFI:` QR; the mobile app can also write a native NDEF Wi-Fi record |
| `developer_webhook` | `{ application_id, then?: Action (non-webhook) }` | signed delivery via the existing pipeline to that app's endpoint (event `card.tapped`), then `then` action or the business profile |

- `GET /actions/types` (public) → the table above as data `{ type, label, description, fields: [{name, type, required, …}] }`
  so the UI renders forms from the backend definition.
- Validation per type → `422 invalid_action_config` (NFC-6010) with field details.
- `POST /businesses/{id}/actions/preview` `{ action, card_id? }` → `{ resolved_url|null, kind: "redirect"|"page"|"vcard"|"webhook" }`.

### B6. Profiles (public pages)

`Profile` = `{ id, business_id, type: "business"|"employee"|"custom"|"menu"|"product", slug, title, employee_id|null,
published: bool, theme: { accent: hex, cover_image_url? }, sections: Section[], public_url, updated_at }`

`Section` types: `about {text}`, `contact {phone,email,website,address}`, `hours {rows:[{day, open, close, closed}]}`,
`social {links:[{platform,url}]}`, `services {items:[{title, description, price?}]}`,
`products {items:[{title, description, price?, image_url?, url?}]}`, `menu {categories:[{name, items:[{name, description, price, tags[]}]}]}`,
`buttons {items:[{label, action: Action}]}`, `gallery {images:[url]}`, `text {markdown}`.

- One `business` profile per business (created with the workspace from the registration data); `employee` profiles
  are generated per employee and editable; any number of `custom|menu|product` profiles.
- CRUD `GET/POST /businesses/{id}/profiles`, `GET/PATCH/DELETE …/profiles/{pid}`, `POST …/profiles/{pid}/publish|unpublish`.
- Public (no auth, cached ≤ 60 s, rate limited): `GET /public/b/{business_slug}` and `GET /public/b/{business_slug}/{profile_slug}`
  → `{ business: {name, slug, logo_url, verified, category}, profile: Profile(published only) , vcard_url }`;
  `GET /public/b/{slug}/vcard` and `/public/b/{slug}/{profile_slug}/vcard` → `text/vcard`.
  Unpublished/inactive/suspended/unverified → `404 profile_unavailable` (the page shows a neutral message).
- Public web pages (React, no login): `{PUBLIC_WEB_URL}/b/{slug}` and `/b/{slug}/{profile_slug}`, plus `/w/{public_code}`
  (Wi-Fi page) and `/tap/unavailable`. Updating a profile never requires reprogramming a card.

### B7. Taps (the business event model) & analytics

`CardTap` = `{ id, business_id, card_id, card_name, card_kind, assignee: {type,id,name}|null,
source: "web" (consumer phone opened tap_url) | "reader" (business device via NFC Terminal),
action_type, result: "redirected"|"page"|"vcard"|"webhook"|"inactive"|"unknown_card", device_id|null,
device_name|null, nfc_event_id|null, visitor_hash (daily-rotating salt; used for unique counts), device_type
("ios"|"android"|"desktop"|"other"), browser, country|null (only from trusted proxy header; no GeoIP, no raw IP),
created_at }`

- `GET /t/{public_code}` (root path, public): records a `web` tap, resolves the action (B5), responds 302/page.
  Unknown code → neutral `/tap/unavailable`. Bots (link previews) are recorded with `result` but excluded from analytics.
- Reader taps: see C2. Both sources feed the same `card_taps` table and the card counters.
- `GET /businesses/{id}/taps?source=&card_id=&employee_id=&customer_id=&device_id=&result=&date_from=&date_to=&page=` → paginated `CardTap`.
- `GET /businesses/{id}/analytics?range=7d|30d|90d|365d&card_id=&employee_id=` →
  `{ totals: {taps, unique_visitors, web_taps, reader_taps, active_cards, active_employees}, previous_period_totals,
  timeline: [{date, taps, unique_visitors}], by_card: [{card_id, name, taps}], by_employee: [{employee_id, name, taps}],
  by_action: [{action_type, taps}], by_device_type, by_country, by_hour: [{hour, taps}], last_activity: CardTap|null }`
- `GET /businesses/{id}/overview` → counts (cards/tags active/total, employees, customers, devices online), taps today/7d, recent taps, setup checklist flags.

### B8. Devices, API & integrations for businesses (reuse, don't duplicate)

- A business owns applications: `applications.business_id` (nullable). Registration creates the default
  **"Business Terminal"** application (relay mode, endpoint optional). Business API keys, webhooks, endpoints,
  deliveries, pairing codes, devices and `nfc_events` all reuse the Part 1 tables/endpoints.
- Authorization generalised: an application (and its keys/devices/events/deliveries/pairing codes) is accessible if
  `app.user_id == user` **or** the user is a member of `app.business_id` with the needed permission
  (`api.manage` for keys/endpoints/webhooks, `devices.manage` for devices/pairing, `api.view` for events/deliveries).
- The **developer** listings (`GET /applications`, `/api-keys`, `/devices`, `/events`, `/overview`, `/usage`) exclude
  business-owned rows (unchanged behaviour for developers).
- Business listings: `GET /businesses/{id}/applications`, `GET /businesses/{id}/devices` (adds `assigned_employee`,
  `last_scan_at`, `online`), `PATCH /businesses/{id}/devices/{did}` `{ name?, assigned_employee_id? }`,
  `GET /businesses/{id}/devices/{did}/activity` (taps + request logs), `GET /businesses/{id}/api-usage?range=`
  (requests by key/device/route, error rate, from request logs).
  Add device = `POST /applications/{business_terminal_app_id}/pairing-codes` (Part 1 §7.3, unchanged).
- Plans: business plans `biz_starter` (free: 50 cards, 3 devices, 5 members, 10k taps/month), `biz_growth`
  (4900: 1000 cards, 25 devices, 25 members, 250k taps), `biz_enterprise` (null = unlimited).
  `GET /businesses/{id}/billing` → `{ plan, usage: {cards, devices, members, taps_this_month}, limits, status }`.
  Limit exceeded → `402 plan_limit_reached` (NFC-7001) with `details.limit`.

### B9. Team

`Member` = `{ id, user_id, full_name, email, role, extra_permissions, status: "active"|"suspended", joined_at, last_active_at }`
`Invitation` = `{ id, email, role, status: "pending"|"accepted"|"revoked"|"expired", invited_by, expires_at (7 days), created_at }`

- `GET /businesses/{id}/members`, `PATCH …/members/{mid}` `{ role?, extra_permissions?, status? }`, `DELETE …/members/{mid}`.
  Rules: only owners change owners; there is always ≥ 1 active owner (`409 last_owner`); nobody edits their own role.
- `GET/POST …/invitations` `{ email, role }` (email sent with `{PUBLIC_WEB_URL}/invite/{token}`; dev returns `dev_invite_url`),
  `POST …/invitations/{iid}/revoke`, `POST …/invitations/{iid}/resend`.
- `GET /invitations/{token}` (public) → `{ business_name, role, email, expires_at, status }`.
  `POST /invitations/{token}/accept` (logged in, email must match → `403 invitation_email_mismatch`) or register with `invite_token`.

---

## C. Mobile (NFC Terminal) — business devices

### C1. DeviceConfig additions (additive)

```json
{ "account_type": "developer" | "business",
  "business": { "id": "uuid", "name": "Acme Café", "slug": "acme-cafe", "logo_url": null } | null,
  "assigned_employee": { "id": "uuid", "name": "John Doe" } | null,
  "capabilities": ["cards.register", "cards.program"] }
```

`capabilities` come from business settings (`devices_can_register_cards`). Developer devices get `account_type:
"developer"`, `business: null`, `capabilities: []` — behaviour unchanged.

### C2. Events from business devices

`POST /device/events` (unchanged request). For business devices the backend additionally resolves the UID against the
business's cards, records a `reader` CardTap, runs a `developer_webhook` action through the normal signed pipeline,
and the response gains (developer devices: field absent):

```json
{ "business": {
    "result": "recognized" | "unknown_card" | "inactive",
    "card": { "id", "name", "kind", "status", "effective_status" } | null,
    "assignee": { "type": "employee"|"customer", "id", "name", "position": null, "photo_url": null } | null,
    "action": { "type", "label", "url": "https://…" | null } | null,
    "message": "John Doe · Sales Manager" } }
```

A business device with no configured endpoint is **not** an error: the event is logged, status `delivered` is replaced
by `status: "logged"` (new allowed value, business apps only) and `business` carries the result.

### C3. Device card management (business devices with capabilities)

- `GET /device/business/cards?q=&programmed=&page=` → `[{ id, name, kind, assignee_name, uid_masked, tap_url, programmed }]`
- `POST /device/business/cards` `{ uid, name?, kind }` → `201 Card` (needs `cards.register`; `409 card_uid_exists`)
- `POST /device/business/cards/{id}/programmed` `{ uid }` → binds the UID if not set (`409 card_uid_exists` if used
  by another card) and marks programmed (needs `cards.program`).
- Programming = writing an NDEF URI record with `tap_url` (and optionally a Wi-Fi record for `wifi` actions).
  The app never makes a tag read-only.

### C4. App behaviour

- Show business name/logo when `account_type = business`. On a read, show the `business` result prominently
  (card name, assignee, status colour: recognized = green, inactive = amber, unknown = neutral) with an **Open**
  button for `action.url` and, for `unknown_card` with `cards.register`, a **Register this card** flow.
- New **Program card** screen: pick a card (search), tap to write, confirm, report `programmed`.
- Error handling: show `message` + `ref` (and `request_id` in details) for API errors; local failures use `MOB-*` refs.
- Theme: switch to the platform's dark-red palette (no purple).
- Developer devices: no visible change except the new theme and error refs.

---

## D. Settings / environment additions (backend `.env.example`)

```
PUBLIC_API_URL=            # base for /t/{code} and /sandbox/{token}; empty = DEVICE_SERVER_URL or API_BASE_URL
PUBLIC_WEB_URL=http://localhost:5173   # base for /b/{slug}, /invite/{token}, /docs/errors
MEDIA_ROOT=./media
SEED_DEMO_DATA=false
DEMO_PASSWORD=DemoPassword123
REQUEST_LOG_ENABLED=true
```

---

## E. Backend implementation notes (additions / clarifications — keep clients in sync)

- **Errors:** `GET /errors` also mirrors `mobile/ERROR_CODES.md` (`MOB-1001…1021`, `source: "mobile"`). Mobile codes
  may reuse a server code name (`domain_not_allowed`, `endpoint_not_configured`); refs differ (`MOB-*` vs `NFC-*`).
  Every error body has `ref`, `request_id`, `docs_url`.
- **`POST /device/events` response:** `error_code` / `error_ref` are present **only when the attempt failed** (success
  responses keep the exact Part 1 shape). `business` is present only for business devices. `status` may be `logged`.
- **`GET /device/business/cards`** returns the standard paginated shape `{items,total,page,page_size}`; items also carry `status`.
- **`POST /device/business/cards`** returns `201 Card` (full `Card` object). `.../programmed` returns the updated `Card`.
  A card already bound to a different UID → `409 card_uid_mismatch` (NFC-6014). Capability off → `403 device_capability_missing`;
  developer device → `403 device_not_business`.
- **Wi-Fi page data:** `GET /public/w/{public_code}` (public) → `{ business, ssid, password, security, hidden, wifi_qr }`
  for `/w/{public_code}`; `404 profile_unavailable` otherwise.
- **Public profile** responses also include `employee: {id, full_name, position, department, photo_url, phone, email,
  social_links} | null` (live employee data for employee profiles). `404 profile_unavailable` has
  `details.reason` ∈ `not_found|unpublished|inactive|suspended|unverified`.
- **Neutral tap page:** `/tap/unavailable?reason=unknown|inactive|suspended|unverified`.
- **`email` action** resolves to a small page that opens `mailto:` (kind `page`), like `phone_call`.
- **`card.tapped` webhook payload** = Part 1 payload + `tap: { id, source, business_id, card: {id,name,kind,public_code,
  tap_url}, assignee }`; `device_id` is `null` for web taps; `card_id` is the card UID or, if unknown, its `public_code`.
  Queued through the normal retry pipeline (not sent inline, so consumer redirects stay fast). Bots never trigger it.
- **Maintenance message:** `GET /meta/status` (public) → `{ maintenance_message, public_api_url, public_web_url, version }`
  (`/meta` keeps its Part 1 shape).
- **`GET /billing/plans?audience=developer|business`** optional filter. `biz_enterprise` is 19900 cents with all limits `null`.
- **`POST /auth/resend-verification`** → `202 { dev_verification_url: string|null }`.
- **Registration with `invite_token`** marks the email as verified (the invitation link proved it).
- **`POST /applications/{id}/pairing-codes`** → `201`. `POST /sandbox/endpoints/{id}/use-for/{app}` → `Application`;
  `send-test` → `{ success, status_code, latency_ms, error, error_code, error_ref, response_excerpt }`
  (`409 sandbox_no_application` if the sandbox isn't linked to an application).
- **Sandbox auto-attach** of a developer's first application is controlled by `SANDBOX_AUTO_ATTACH` (default true).
- **`GET /businesses`** items include the caller's `role`. `GET /businesses/{id}/billing` needs only `business.view`.
  `DELETE /businesses/{id}/members/{mid}` on yourself = leave (no permission needed; `last_owner` still applies).
- **Business overview** = `{ cards:{total,active}, tags:{total,active}, employees:{total,active}, customers,
  devices:{total,online}, taps_today, taps_7d, recent_taps, checklist:{email_verified, logo_uploaded,
  profile_published, first_employee, first_card, card_programmed, device_paired, team_invited} }`.
- **Admin list endpoints** (`/admin/accounts`, `/admin/businesses`, `/admin/devices`, `/admin/deliveries`) are paginated
  `{items,total,page,page_size}` (`page`, `page_size` query params).
