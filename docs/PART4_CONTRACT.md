# Part 4 Contract — Personal Accounts & Digital Cards (phone-as-card, exchange)

Extends Parts 1–3. Same conventions (UUIDs, `Z` timestamps, pagination, error envelope with `ref`/`request_id`,
every new error code in the catalog, audit logs, rate limits, no secrets in logs). **Fully additive**: developer and
business accounts, terminals, events and the existing app flows keep working unchanged.

Product decisions (confirmed by the product owner):
- **Mutual exchange automatically**: when A scans B, A gets B's card and B automatically gets A's card
  (if B's `auto_exchange` is on — default on; otherwise one-way with public fields only).
- **Both on one phone**: the app has a *My Card* space (personal) and the existing *Terminal* space; a phone can be
  signed into a personal account and also be a registered developer/business reader.
- **No-app phones** (e.g. iPhone) tapping a sharing phone get the owner's **public card web page** via NDEF emulation.
- **Businesses can issue employee digital cards** that live on the employee's personal account.

A digital card is an **identifier with a signed, short-lived token — not strong authentication** (a live relay is
possible). Events carry `security: { authenticated: false, level: "signed_token" }`.

---

## 1. Personal accounts

- `account_type` gains `"personal"`. `POST /auth/register` with `account_type: "personal"` (fields: `full_name, email,
  password`; optional `phone`). Creates user + a first digital card (template `modern`, from the user's name/email) +
  subscription `personal_free`. Email verification: non-blocking banner (like developers).
- Plans (admin-managed like others, `audience: "personal"`): `personal_free` (3 cards, 1000 contacts), `personal_pro`
  (price set by admin, 20 cards, unlimited contacts, lead capture export). Limits → `402 plan_limit_reached`.
- After login, personal users land on `/me`.

### 1.1 Mobile sessions (the app signs in as the person)

`PersonalSession` = `{ id, device_name, platform, model, app_version, created_at, last_seen_at, revoked_at }`
- `POST /personal/sessions` — one of:
  `{ email, password, device_name, platform, model, os_version, app_version, installation_id }` or
  `{ login_code, ...same device fields }` →
  `201 { session_token: "nfcs_…", session: PersonalSession, user: User, share_key: { key_id: int, secret: base64url(32 bytes) }, cards: DigitalCard[] }`.
  `session_token` stored hashed (SHA-256); `share_key.secret` stored encrypted server-side (Fernet, like webhook secrets),
  one key per session. Re-login with the same `installation_id` revokes the previous session.
- Auth for all `/personal/*` calls from the app: `Authorization: Bearer nfcs_…` (the web dashboard uses its JWT; both work).
- `GET /personal/sessions` (web + app) · `DELETE /personal/sessions/{id}` (revokes; its share key stops validating) ·
  `POST /personal/sessions/current/heartbeat`.
- **QR login from the web**: `POST /personal/login-codes` (JWT) → `{ id, code: "nfcl_…", expires_at (5 min), qr_payload:
  "nfcterminal://login?v=1&server=<urlenc>&code=nfcl_…" }`, single use, hashed. `GET /personal/login-codes/{id}` →
  `{ status: pending|used|expired, session: PersonalSession|null }` (web polls to show "Signed in on <device> ✓").
  Invalid → `401 invalid_login_code`.

## 2. Digital cards

`DigitalCard` = `{ id, share_id (uuid, rotatable), label ("Work", "Personal"…), is_primary, status: "active"|"inactive",
slug, public_url ({PUBLIC_WEB_URL}/p/{slug}), template_id, design: { primary: hex, background: hex, text: hex,
accent: hex, background_style: "solid"|"gradient"|"glass"|"pattern", pattern: string|null, font: "sans"|"serif"|"mono"|"display",
corner_radius: int (0–32), show_qr: bool }, photo_url, cover_url, logo_url,
fields: { full_name, pronouns, headline, job_title, company, department, bio, phones: [{label, value}], emails: [{label, value}],
websites: [{label, url}], address, socials: [{platform, url}], custom_links: [{label, url}] },
visibility: { <field>: "public"|"contacts"|"hidden" } (defaults: name/headline/company/job_title/photo/socials/websites public;
phones/emails contacts; address hidden),
share_settings: { auto_exchange: true, web_page_enabled: true, lead_capture_enabled: true, nfc_sharing_enabled: true },
business_link: { business_id, business_name, employee_id, locked_fields: string[], template_locked: bool, status } | null,
stats: { views, nfc_taps, exchanges, leads }, created_at, updated_at }`

- `GET /personal/cards` · `POST /personal/cards` · `GET/PATCH/DELETE /personal/cards/{id}` ·
  `POST /personal/cards/{id}/primary` (exactly one primary = the card the phone shares) ·
  `POST /personal/cards/{id}/rotate-share-id` (old tokens/QRs stop working) · `POST /personal/cards/{id}/duplicate`.
- Images: `POST /personal/cards/{id}/images?kind=photo|cover|logo` (png/jpeg/webp ≤ 3 MB, re-encoded; photo 512², cover 1200×630) · `DELETE …?kind=`.
- Locked fields of business-linked cards can't be changed by the user (`403 field_locked`).
- **Templates** (data-driven, rendered identically on web and mobile): `GET /personal/templates` (public) →
  `[{ id, name, description, layout: "centered"|"left"|"split"|"hero_photo"|"banner"|"compact", default_design: {...design},
  supports: { photo, cover, logo }, premium: bool }]`. Seed at least 8: `classic, modern, minimal, gradient, glass, bold,
  split, photo_hero`. Layout semantics (both clients must follow):
  - `centered`: round photo top-centre, name/headline centred, action buttons row, fields list.
  - `left`: photo left of name block, left-aligned text, divider, fields.
  - `split`: coloured left/top panel with photo+name, right/bottom panel with fields.
  - `hero_photo`: full-width photo/cover on top with gradient overlay and name over it.
  - `banner`: cover banner, overlapping round photo, name below.
  - `compact`: small card (like a physical business card ratio 1.75:1) with name, title, company, logo, QR.
- Public page (no auth, rate limited): `GET /public/p/{slug}` → `{ card: { design, template, public fields only, photo/cover/logo,
  business: {name, logo_url, verified}|null }, lead_capture_enabled, vcard_url }`; `GET /public/p/{slug}/vcard` (public fields);
  `POST /public/p/{slug}/leads` `{ full_name, email?, phone?, company?, message? , website (honeypot, must be empty) }` →
  `201` (creates a Contact with `source: "web_lead"` for the owner + notification). Inactive/disabled → `404 card_unavailable`.
  Views counted (bots excluded). `?via=nfc|qr|link` recorded as the source.
- Web page `{PUBLIC_WEB_URL}/p/{slug}`: renders the card with its template/design, Save contact, Share, "Share your details back"
  (lead form), "Get your own digital card" CTA, Powered by Nexventures.

## 3. NFC phone-as-card (Android Host Card Emulation)

The app registers a `HostApduService` for two AIDs (category `other`):

**A. Digital-card AID `F04E4643444301`** (proprietary). Reader sends
`SELECT 00 A4 04 00 07 F0 4E 46 43 44 43 01 00` → phone answers `"NFCDC"` (5 ASCII bytes) ‖ `token_bytes` (41) ‖ `90 00`.

`token_bytes` = `0x01` (version) ‖ `share_id` (16 bytes, UUID big-endian) ‖ `key_id` (uint32 BE) ‖ `issued_at`
(uint32 BE, unix seconds) ‖ `mac` (first 16 bytes of `HMAC_SHA256(key = share_key.secret raw 32 bytes, msg = the first 25 bytes)`).
Text form (QR, JSON): base64url without padding (55 chars). The phone generates a fresh token per SELECT (works offline).
Server validation: known share_id → card (active, sharing enabled), key_id → non-revoked session of the card owner,
mac valid (constant-time), `now-600s ≤ issued_at ≤ now+120s`. Errors: `422 invalid_card_token` (NFC-4xxx: malformed,
bad mac, unknown key), `410 card_token_expired`, `404 card_unavailable`.

**Token test vectors** (reference implementation: `backend/app/services/card_tokens.py`; the mobile generator must
reproduce these byte-for-byte). `secret` is the share-key secret as delivered by the API (base64url, no padding) —
decode it to the raw 32 bytes before HMACing; `share_id` bytes are the UUID in standard (big-endian) order.

| # | secret (base64url, 32 bytes) | share_id | key_id | issued_at | token (base64url, 55 chars) |
|---|---|---|---|---|---|
| 1 | `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` (bytes 00..1f) | `00112233-4455-6677-8899-aabbccddeeff` | 1 | 1790000000 | `AQARIjNEVWZ3iJmqu8zd7v8AAAABarE7gDqfF63howUbVssouoR5VwM` |
| 2 | `qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo` (32 × 0xAA) | `7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f` | 305419896 | 1800000123 | `AX8cLT5LWkxtjp8KGyw9Tl8SNFZ4a0nSe8Fk1b4SfbhyWc78tVbqa8M` |
| 3 | `47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU` | `c0ffee00-0000-4000-8000-000000000001` | 4294967295 | 0 | `AcD_7gAAAEAAgAAAAAAAAAH_____AAAAAOkYlkbhvHUFoqWI5pKkMEE` |

Vector 1 cross-check: signed bytes = `01 00112233445566778899aabbccddeeff 00000001 6AB13B80`,
mac = first 16 bytes of HMAC-SHA256 → token above. HCE response = `"NFCDC"` ‖ 41 token bytes ‖ `90 00` (48 bytes).
Time window: `now − 600 ≤ issued_at ≤ now + 120` (older → `410 card_token_expired`, future → `422 invalid_card_token`).

**B. NDEF Type 4 Tag emulation AID `D2760000850101`** (only when `web_page_enabled`): standard NFC Forum T4T
(CC file `E103`, NDEF file `E104`, READ BINARY, max NDEF 1 KB) exposing one URI record
`{PUBLIC_WEB_URL}/p/{slug}?via=nfc`. This is what iPhones/other phones read.

Rules: sharing works while the phone is on and (on most devices) unlocked; while the app itself is in reader mode card
emulation is suspended (Android behaviour) — the UI must make roles clear ("Share" vs "Scan"). The card data served by
HCE comes from a local cache (primary card's share_id + slug + share key) kept in Android secure storage accessible from
the Kotlin service; it is refreshed whenever the primary card or session changes; wiped on sign-out.

**Reader side (all app modes):** on any IsoDep tag the app first sends the digital-card SELECT (≤ 150 ms timeout).
`NFCDC` + token → digital-card flow; anything else → the existing UID flow unchanged.

## 4. Exchanges & contacts

- `POST /personal/exchanges` `{ token }` (token from NFC or from an in-app QR `nfcterminal://card?v=1&t=<token>`)
  (auth: personal session or JWT) →
  `201 { contact: Contact, mutual: bool, already_connected: bool }`.
  Server: validates token; scanner gets a Contact with B's `public` + `contacts` fields (mutual) or `public` only (B has
  `auto_exchange` off); if mutual, B gets a Contact for A's primary card and a notification "You exchanged cards with A";
  repeat exchanges update the existing contacts (`already_connected: true`). Can't exchange with yourself (`409 self_exchange`).
- `Contact` = `{ id, source: "nfc_exchange"|"qr_exchange"|"web_lead"|"manual", counterpart_user_id|null, counterpart_card_id|null,
  card: { snapshot of fields/design/template/photo }, live: bool (true while connected → snapshot refreshes when the other
  person edits their card), notes, tags: string[], favorite, met_at, created_at, updated_at }`
- `GET /personal/contacts?q=&tag=&source=&favorite=&page=` · `GET/PATCH/DELETE /personal/contacts/{id}` ·
  `POST /personal/contacts` (manual) · `GET /personal/contacts/{id}/vcard` · `GET /personal/contacts/export.vcf` (all) ·
  `GET /personal/contacts/export.csv`.
- `GET /personal/activity?page=` → views/taps/exchanges/leads timeline; `GET /personal/stats?range=` → totals + timeline + by source.
- In-app QR for exchange when NFC isn't available: `GET /personal/cards/{id}/exchange-qr` → `{ qr_payload, expires_at }` (token-based, 10 min).

## 5. Terminals reading a digital card (developer & business devices)

`POST /device/events` accepts optional `digital_card_token` (base64url). When present: `card_type = "digital_card"` and
`card_id` must equal `share_id` hex without dashes (32 uppercase hex chars) (`422 card_id_mismatch`).
- Invalid/expired token → the event is still stored with `digital_card.verified = false` (no personal data) and the
  response says why (`error_code`), so developers can debug.
- Developer delivery payload gains `"card": { …, "type": "digital_card" }` and
  `"digital_card": { "id": share_id, "verified": true, "full_name", "headline", "company", "job_title", "photo_url", "public_url" }`
  — **only fields with visibility `public`**, and only if `nfc_sharing_enabled`.
- Business devices: `business.result` may be `"digital_card"` with `assignee` = the person (public fields) — or, if the card is
  business-linked to **this** business, `"recognized"` with the employee as assignee (and a business CardTap with source `reader`).
- The card owner's activity shows "Read by a terminal of <application or business name>" (no device details).

## 6. Business-issued employee digital cards

- `POST /businesses/{id}/employees/{eid}/digital-card` `{ email, template_id?, design?, locked_fields? }` (people.manage) →
  invitation email (template `digital_card_invite`) to the employee; `dev_invite_url` in development.
- Personal side: `GET /personal/business-invites` · `POST /personal/business-invites/{id}/accept|decline`. Accepting creates a
  business-linked DigitalCard (company branding/template applied, locked fields) on the personal account (or on a new
  personal account via `/register?card_invite=<token>`).
- Deactivating the employee (or the business being suspended) sets the linked card `inactive` (shares fail with
  `card_unavailable`; public page neutral). Business analytics include taps/exchanges of linked cards (by employee).
- `GET /businesses/{id}/employees/{eid}` gains `digital_card: { status, user_email, accepted_at } | null`.

## 7. Web

- Personal dashboard at `/me/*`: Overview (stats, primary card preview, share panel), My Cards (gallery + editor with live
  preview: template picker with thumbnails, colour pickers + presets, background style, font, radius, photo/cover/logo upload
  with crop, fields editor, per-field visibility, share settings, set primary, rotate link), Contacts (search/tags/favourites,
  detail with card render, notes, export vCard/CSV), Activity, Share (public link, QR, "Sign in on your phone" QR login,
  download app), Business invites, Settings (profile, sessions/devices with revoke, privacy defaults).
- Register: third option **Personal** (simple one-step form). Landing page: a "Digital card" section (phone-to-phone exchange
  animation, templates showcase) + personal plans in pricing. Docs: "Digital cards" guide (sharing, exchange, templates,
  privacy/visibility, iPhone behaviour, business-issued cards) and the terminal-side `digital_card` payload.

## 8. Mobile

- Setup offers: **Personal digital card** (sign in / create account / scan the web "Sign in on your phone" QR) and
  **Terminal** (existing developer/business registration). Both can be active; bottom navigation shows the spaces that are set up.
- My Card space: primary card rendered with its template/design (same layouts as web); big **Share** state ("Hold your phone
  near another phone or reader" with an animated NFC ripple) — HCE active; **Scan** button (reader mode to receive someone's
  card → exchange → success sheet with their card); card switcher (set primary); **Edit** (templates, colours, background style,
  font, photo from camera/gallery with crop, fields, visibility, share settings) fully usable on the phone; QR share fallback
  (exchange QR + public link QR); Contacts (list, search, detail, notes, tags, save to phone contacts via vCard, share);
  Activity; business invites; Settings (sessions, sign out, auto-exchange, NFC sharing on/off, web page on/off).
- Terminal space: unchanged, plus the digital-card read path (§3 reader side, §5 result display: show the person's card).


## 9. Backend implementation notes (additions / clarifications)

- **Session auth errors:** `401 invalid_session_token` (unknown/revoked `nfcs_`), `403 personal_account_required`
  (a non-personal account signing into the My Card space or calling `/personal/*`). `POST /personal/sessions` is rate
  limited like login (per IP). Activity/request logs record the actor as `personal_session`.
- **Templates:** 9 seeded (`classic, modern, minimal, gradient, glass, bold, split, photo_hero, business` — `business`
  uses the `compact` layout). Business-issued cards default to the invite's `template_id` (or `modern`).
- **Cards:** `PATCH /personal/cards/{id}` also accepts `status` and `slug` (`409 slug_taken`). `fields` is a partial merge;
  `design` merges onto the current design (switching `template_id` resets to the new template's defaults + your overrides).
  Logo images are fitted inside 512×512 (not cropped). Locked image kinds (`photo`/`logo`/`cover` in `locked_fields`)
  can't be uploaded/removed. Business-linked cards don't count towards the personal plan's card limit.
- **Status:** `status` is the *effective* status — a business-linked card reports `inactive` while its employee is
  inactive or the business is suspended/deleted (restored automatically when reactivated).
- **Public page:** `card` = `{ id, slug, design, template (full template object), fields (public only), photo_url,
  cover_url, logo_url, business, public_url }`. Views are counted per request (bots excluded); `via=nfc` also counts an NFC tap.
- **Leads:** a filled honeypot returns `201 { "status": "received" }` without storing anything (bots get no signal).
  An email **or** a phone is required. Stricter limit: 5 leads / 10 min per IP per card (`429 rate_limited`), on top of
  the public per-IP bucket. Leads don't count against the contacts limit (exchanges and manual contacts do →
  `402 plan_limit_reached`, `details.limit = "contacts"`).
- **Exchanges:** body accepts optional `via: "nfc"|"qr"` (source `nfc_exchange` / `qr_exchange`). Mutual needs the
  scanner to have an active card (otherwise one-way). If B's contacts limit is full, B's side is skipped silently.
- **Contacts:** `card` snapshot = `{ card_id, share_id, template_id, design, fields, photo_url, cover_url, logo_url,
  public_url, business }` filtered to the level you're entitled to; manual/lead contacts have `card = { fields }`.
  `PATCH` edits `fields` only for manual contacts. CSV cells starting with `= + - @` are prefixed with `'`.
- **Exchange QR** (`GET /personal/cards/{id}/exchange-qr`) also returns the raw `token`. Web-generated tokens are signed
  with a server-side key (an internal, non-listed session); revoking phone sessions doesn't affect it.
- **Terminals (§5):** the `POST /device/events` response gains `digital_card: { verified, error_code, error_ref }`
  whenever a token was sent. The developer payload's `digital_card` always has the keys `id, verified, full_name,
  headline, company, job_title, photo_url, public_url` (non-public values are `null`); unverified → `{ id, verified: false }`.
  `security` is `{ authenticated: false, level: "signed_token" }` for verified digital cards, `uid_only` otherwise.
  Business result for a verified non-linked card: `"digital_card"` with `assignee: { type: "person", … }`; unverified →
  `"unknown_card"` (message "Digital card could not be verified"). A linked employee's card → `"recognized"` +
  a `reader` CardTap (`card_kind = "digital"`, `card_id = null`).
- **Employee digital cards (§6):** `POST /businesses/{id}/employees/{eid}/digital-card` → `201 { id, email, status,
  expires_at, dev_invite_url }` (7-day invitation; re-issuing revokes the previous pending one). Default
  `locked_fields: ["company"]`. The invite link is `{PUBLIC_WEB_URL}/register?card_invite=<token>`; registering with
  `card_invite` creates a personal account (email marked verified) with the linked card. Invitations are matched to
  personal accounts by email (`GET /personal/business-invites`); a wrong email → `403 invitation_email_mismatch`,
  used/declined/expired → `410 card_invite_unavailable`. Employee `digital_card.status` ∈
  `invited | active | inactive | declined | expired | removed`.
- **Plans:** `personal_free` (3 cards, 1,000 contacts) and `personal_pro` (499 cents/month, 20 cards, unlimited contacts);
  `Plan.max_contacts` added. `signups_enabled.personal` is honoured (missing = enabled).
- **Web alignments (agreed):**
  - `Contact.card` snapshot includes `template_id` **and** `layout` (plus `design`, `fields`, `photo_url`, `cover_url`,
    `logo_url`, `public_url`, `business`, `card_id`, `share_id`).
  - New cards honour `user.preferences.personal_defaults` = `{ visibility: {...}, share_settings: {...} }` when the
    request doesn't specify `visibility` / `share_settings` (unknown keys/values are ignored).
  - `POST /businesses/{id}/employees/{eid}/digital-card` → `201 { digital_card: { status: "invited", user_email,
    accepted_at: null, invite_id, expires_at }, dev_invite_url? }`.
  - Activity items: `{ id, type: "view"|"nfc_tap"|"exchange"|"lead"|"terminal_read", card_id, card_label,
    source: "nfc"|"qr"|"link"|null, counterpart_name|null, detail (human-readable sentence)|null, created_at }`.
    `counterpart_name` = the other person (exchange), the lead's name, or the reading application/business.
  - `POST /auth/register` accepts the §6 invite token as `card_invite_token` (alias `card_invite`).
