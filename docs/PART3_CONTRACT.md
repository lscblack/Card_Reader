# Part 3 Contract — Branding, Pricing & Promotions, Emails, Admin Error Center, User Profiles

Extends Part 1 (`API_CONTRACT.md`) and Part 2 (`PART2_CONTRACT.md`). Same conventions, error envelope with
`ref`/`request_id`, every new error code must be in the catalog, every admin mutation audited (`admin.*`),
every change additive/backward compatible.

## 1. Branding (admin-controlled, applied everywhere at runtime)

`Branding` = `{ product_name, tagline, logo_url|null, logo_dark_url|null, favicon_url|null,
fonts: { heading, body, mono }, theme: { accent_light: hex, accent_dark: hex, default_mode: "dark"|"light"|"system" },
support_email, company_address|null, social_links: [{platform, url}], updated_at }`
Defaults: product "nexTap", accent_light `#B91C1C`, accent_dark `#E5484D`, default_mode `dark`,
fonts Inter / Inter / JetBrains Mono.

- `GET /meta/branding` (public, cached ≤ 60 s, ETag) → `Branding`.
- `GET /meta/fonts` (public) → curated list `[{ family, category: "sans"|"serif"|"mono"|"display", google: true, weights: [...] }]`
  (Inter, Manrope, Plus Jakarta Sans, DM Sans, Outfit, Sora, Space Grotesk, IBM Plex Sans, Poppins, Figtree,
  Lexend, Urbanist, Playfair Display, Fraunces, JetBrains Mono, IBM Plex Mono, Fira Code …). Only these are accepted.
- `PATCH /admin/branding` (partial `Branding`) → `Branding`. Hex validated; the API rejects accent colours whose
  contrast against the theme background is < 3:1 (`422 branding_low_contrast`).
- `POST /admin/branding/assets?variant=logo|logo_dark|favicon` (multipart png/svg/webp ≤ 1 MB; SVG sanitised —
  no scripts/foreign objects/external refs) → `Branding`. `DELETE /admin/branding/assets?variant=` → `Branding`.
- The web app loads branding at startup and applies it (CSS variables for accent, Google Fonts link for the chosen
  families, logo component, document title, favicon). Emails use it too (logo, accent, product name, address).

## 2. Plans & promotions (admin-managed pricing)

`Plan` gains: `price_yearly_cents|null, is_active, is_featured, sort_order, badge|null, description|null,
promotion: AppliedPromotion|null` (public responses only show active plans).

- `GET /admin/plans` (incl. inactive) · `POST /admin/plans` · `PATCH /admin/plans/{code}` · `POST /admin/plans/{code}/activate|deactivate`.
  Plans with active subscriptions can't be deleted, only deactivated (`409 plan_in_use`). `code` immutable.
- `Promotion` = `{ id, name, code|null (checkout coupon, uppercase), description, discount_type: "percent"|"amount",
  discount_value, currency (amount only), audience: "developer"|"business"|"all", plan_codes: [] (empty = all plans of the
  audience), starts_at|null, ends_at|null, is_active, show_on_landing: bool, banner_text|null, max_redemptions|null,
  redemptions, created_at }`
  `status` (computed): `scheduled|active|expired|inactive|exhausted`.
- `GET/POST /admin/promotions`, `GET/PATCH/DELETE /admin/promotions/{id}`, `POST /admin/promotions/{id}/activate|deactivate`.
- Public: `GET /billing/plans` attaches the best currently active promotion per plan as
  `promotion: { id, name, banner_text, discount_type, discount_value, discounted_price_monthly_cents, ends_at, code }`.
  `GET /billing/promotions/active` → active promotions with `show_on_landing = true` (landing banner/ribbons).
  `POST /billing/promotions/validate` `{ code, plan_code }` (auth) → `{ valid, promotion, discounted_price_monthly_cents }`
  (checkout itself is still "coming soon").

## 3. Emails

Professional, branded HTML email templates (Jinja2, inline CSS, table layout, 600 px, dark-mode-friendly
`color-scheme` meta + `prefers-color-scheme` styles, preheader, accessible, plain-text alternative, logo from branding,
accent button, footer with product name/address/support email and why-you-got-this line).
Templates: `verify_email`, `password_reset`, `invitation`, `welcome`, `admin_message`, `password_changed`.
All existing emails switch to these templates.

`EmailLog` = `{ id, campaign_id|null, to_email, user_id|null, template, subject, status: "queued"|"sent"|"failed"|
"logged" (email disabled), error|null, sent_by|null, created_at, sent_at|null }`.
Rendered HTML is stored (≤ 200 KB) for preview; bodies never contain secrets except the intended one-time links,
which are **not** stored — stored HTML has links replaced with `[link removed]`.

- Admin: `POST /admin/emails` `{ user_ids?: uuid[], filter?: { account_type?, status?, email_verified?, plan_code? },
  subject, body_markdown, cta?: { label, url } }` (exactly one of user_ids/filter; max 5000 recipients) →
  `202 { campaign_id, recipients }`. Sent by the worker, throttled, retried twice on SMTP failure.
  Markdown rendered safely (no raw HTML).
- `POST /admin/emails/preview` `{ subject, body_markdown, cta? }` → `{ html, text }`.
- `GET /admin/emails?campaign_id=&status=&q=&page=` → paginated `EmailLog`; `GET /admin/emails/{id}` → `EmailLog & { html }`.
  `GET /admin/email-campaigns?page=` → `{ id, subject, recipients, sent, failed, logged, created_by, created_at }`.
- `GET /admin/email-templates` → `[{ name, description }]`; `GET /admin/email-templates/{name}/preview` → `{ html, text }` (sample data).
- Verification links: `POST /admin/accounts/{id}/send-verification` → `202` (dev: `dev_verification_url`);
  `POST /admin/accounts/send-verification` `{ user_ids }` → `202 { sent, skipped_already_verified }`.

## 4. User profile info & avatar

`User` gains `avatar_url|null, phone|null, company|null, country|null (ISO-2), job_title|null, last_login_at|null,
login_count`. (`PATCH /auth/me` accepts `full_name, phone, company, country, job_title`.)

- `POST /auth/me/avatar` (multipart png/jpeg/webp ≤ 2 MB, re-encoded & resized to 256×256) → `User`; `DELETE /auth/me/avatar` → `User`.
- Admin account detail (`GET /admin/accounts/{id}`) includes the above plus `memberships`, `email_logs` (last 20),
  `recent_logins` (last 10 from audit), and admin can `PATCH /admin/accounts/{id}` `{ full_name?, phone?, company?, country?, job_title? }`
  in addition to Part 2 fields, and `DELETE /admin/accounts/{id}/avatar`.

## 5. Admin Error Center

- `GET /admin/errors?range=24h|7d|30d&source=api|delivery|mobile&q=&only_occurring=` → every catalog entry
  (`code, ref, http_status, source, title, description, fix`) merged with
  `stats: { count, previous_count, last_seen_at|null, affected_users, affected_devices, trend: [{bucket, count}] }`
  (from request logs + deliveries; mobile errors have no server stats → `null` unless reported).
- `GET /admin/errors/{ref}?range=` → entry + stats + `top_routes`, `top_users` (id, email), `recent: RequestLog[] (20)`,
  `recent_deliveries: Delivery[] (20)` for delivery errors.

## 6. Security: no public Swagger

- `/docs`, `/redoc`, `/openapi.json` are **disabled** on the backend (setting `API_DOCS_ENABLED=false`, default false in
  every environment). The public web docs are the only API documentation. Web links to Swagger are removed.
- The public REST reference documents only developer/business-facing endpoints — never `/admin/*` or internal routes.

## 7. User preferences & product tours

`User` gains `preferences: { tours_completed: string[], tours_dismissed: bool, ... }` (free-form JSON ≤ 8 KB).
- `PATCH /auth/me/preferences` (merge patch) → `User`.
- Tour ids: `developer.dashboard`, `developer.sandbox`, `business.dashboard`, `admin.console`. A tour auto-starts on the
  first visit if not in `tours_completed` and not `tours_dismissed`; it can be replayed from the help menu.

## 8. Live run mode (see what happens when a card is tapped)

Server-Sent Events over `fetch` (Authorization header; the browser `EventSource` API is not used):
`GET /live/applications/{id}` (owner or business member with `api.view`) → `text/event-stream`, heartbeat comment every 15 s.
Events (JSON `data:`), published via Redis pub/sub when they happen:
- `event.received` `{ event_id, card_id, card_type, card_technologies, device_id, device_name, detected_at, delivery_mode }`
- `delivery.attempt` `{ event_id, attempt, mode, url, success, status_code, latency_ms, error_code, error_ref,
  response_excerpt (≤ 2 KB), response_headers (content-type, content-length only), request_payload (the exact JSON sent) }`
- `sandbox.request` `{ endpoint_id, request_id, event_id|null, signature_status, checks_failed: int, response_status }`
  (when the application's endpoint is a sandbox endpoint)
- `business.tap` `{ card_id, card_name, assignee_name, result, action_type }` (business apps)
Reconnect: `?since=<ISO>` replays up to 100 events from the last 10 minutes. Max 5 concurrent streams per user (`429 too_many_streams`).
If Redis pub/sub is unavailable, respond `503 live_unavailable` (the UI falls back to polling `/events` + `/deliveries`).

## 9. Mobile app releases (APK download + admin rebuild)

`AppRelease` = `{ id, version_name, build_number, channel: "stable"|"beta", build_type: "release"|"debug", api_base_url,
file_size, sha256, status: "queued"|"building"|"succeeded"|"failed"|"cancelled", is_published, notes|null,
log_excerpt (last 200 lines), started_at, finished_at, created_by, created_at, download_url|null }`

- Public: `GET /meta/app-release` → latest published stable release `{ version_name, build_number, file_size, sha256,
  published_at, download_url, min_android: "7.0" }` or `404 no_release`. `GET /downloads/android/latest` (and
  `/downloads/android/{id}`) → the APK (`application/vnd.android.package-archive`, `Content-Disposition` filename
  `nextap-<version>.apk`), counted in `downloads`.
- Admin: `POST /admin/app-releases` `{ version_name?, build_number? (default auto-increment), build_type, channel, api_base_url?
  (default PUBLIC_API_URL; must be http(s)), notes?, publish_on_success: bool }` → `202 AppRelease` (queued).
  `GET /admin/app-releases`, `GET /admin/app-releases/{id}` (incl. full log if requested `?log=full`),
  `POST /admin/app-releases/{id}/cancel`, `POST /admin/app-releases/{id}/publish|unpublish`, `DELETE` (not the published one).
- Builds run in the worker as a subprocess with a **fixed command** (`flutter build apk --<build_type>
  --build-name=<v> --build-number=<n> --dart-define=API_BASE_URL=<url>`) in `MOBILE_PROJECT_DIR` using `FLUTTER_BIN`
  and `JAVA_HOME`; no user-controlled shell, arguments validated; one build at a time (Redis lock → `409 build_in_progress`);
  timeout `APP_BUILD_TIMEOUT_SECONDS` (default 1800). Artifacts stored in `MEDIA_ROOT/releases/`. Disabled unless
  `APP_BUILD_ENABLED=true` (`403 app_builds_disabled`).

## 10. Notifications (in-app)

`Notification` = `{ id, type, title, body, link|null, severity: "info"|"success"|"warning"|"error", read_at|null, created_at }`
- `GET /notifications?unread=&page=` · `GET /notifications/unread-count` · `POST /notifications/{id}/read` · `POST /notifications/read-all`.
- Created for: app build finished/failed (the admin who started it + all admins), and reusable for future events.
- Dashboard shells show a bell with unread count (poll every 30 s or piggyback on the live stream).

## 11. Branding footer

"Powered by Nexventures" linking to `http://nexventures.net/` appears in the landing footer, docs footer/sidebar,
dashboard shells (subtle, sidebar bottom), public profile pages (small), email template footer, and the mobile app's About.

## 12. Backend implementation notes (additions / clarifications)

- **Branding:** `GET /admin/branding` (read) added. PATCH ignores logo fields (use the assets endpoint). Contrast is checked
  against `#FFFFFF` (accent_light) and `#0B0B0F` (accent_dark); the 422 `details[0]` has `contrast` and `background`.
  Assets: PNG/WebP are stored as-is, SVGs are rebuilt by an allowlist sanitiser (defusedxml; DOCTYPE/entities rejected).
  Emails skip SVG logos (most mail clients can't render them) and show the product name instead.
- **Plans:** `DELETE /admin/plans/{code}` exists; `free` and `biz_starter` (registration defaults) or plans with
  subscribers → `409 plan_in_use`. Admin plan objects include `subscribers`. Startup seeding is insert-only, so admin edits
  are never overwritten.
- **Promotions:** `GET /admin/promotions?status=` filter. `POST /billing/promotions/validate` also returns
  `reason` (`unknown_plan|unknown_code|promotion_<status>|not_applicable`, null when valid). Free plans never get a promotion.
  Demo promotion `LAUNCH20` (20% on `pro` + `biz_growth`) only with `SEED_DEMO_DATA` in development.
- **Emails:** `welcome` is sent after the first successful email verification; `password_changed` after change/reset.
  Campaign emails share one rendered HTML stored on the campaign (logs reference it). `GET /admin/emails` also accepts
  `user_id` and `template`; campaigns include `queued` and `filter`. `POST /admin/accounts/{id}/send-verification` →
  `202 { sent, already_verified, dev_verification_url }`. Template preview also returns `subject`.
  Worker throttle: `EMAIL_THROTTLE_PER_MINUTE` (default 120). Footer: "Powered by Nexventures" (§11).
- **Avatars** are centre-cropped, resized to 256×256 and re-encoded as WebP (metadata stripped).
- **Error Center:** stats merge request logs + delivery attempts; trend buckets 1 h (24h), 6 h (7d), 1 day (30d);
  `last_seen_at` is all-time; list sorted by occurrences.
- **Live stream:** first frames are `retry: 3000` and `: connected`; replayed frames carry `id:`; `business.tap` also has
  `source` (`web|reader`). Each frame's `data` is `{ type, at, data }`.
- **Releases:** extra fields `error`, `downloads`, `publish_on_success`; the full log only with `?log=full`.
  Deleting a building release → `409 build_in_progress`. Downloads are rate-limited per IP and send `X-Content-SHA256`.
  Interrupted builds (worker restart) are marked `failed` on worker start.
- **Notifications** list is paginated `{items,total,page,page_size}`.
- **Preferences** use JSON merge-patch semantics (`null` removes a key).
- **Docs:** `API_DOCS_ENABLED=false` also disables `/openapi.json`.
