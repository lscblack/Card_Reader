# Sign-in, sessions, codes, passkeys and country

## Rules
- **One browser + one phone per account.** Signing in on a new browser signs the previous browser out; signing in on a
  new phone signs the previous phone out. Browser and phone never sign each other out.
- Before another device is signed out, the new device **confirms** ("This will sign you out of Chrome on Computer").
- **Emailed 6-digit code** on password sign-in when `LOGIN_OTP_REQUIRED` (default: on everywhere except
  `ENVIRONMENT=development`). Email-code sign-in and passkeys already prove the user → no extra code, but the
  "sign out the other device" confirmation still applies.
- The same browser (same `client_id`) / same phone (same `installation_id`) signing in again needs no confirmation.
- **Country is required** on every account (ISO-3166 alpha-2). Accounts without one must pick it on next sign-in.
- Profile photo is optional.

## Web (`/api/v1/auth`)
The web app sends `X-Client-Id: <random id kept in localStorage>` on every request (or `client_id` in bodies).

| Endpoint | Body | Answer |
|---|---|---|
| `POST /login` | `{email, password}` | `LoginOut` |
| `POST /login/confirm` | `{challenge_id, code?}` | `LoginOut` (`status: ok`) |
| `POST /login/resend` | `{challenge_id}` | `{status: "sent", expires_at, dev_code?}` |
| `POST /email-code` | `{email}` | `{challenge_id, sent_to, expires_at, dev_code?}` (same answer for unknown emails) |
| `POST /email-code/verify` | `{challenge_id, code}` | `LoginOut` |
| `POST /passkeys/login/options` | `{}` | `{challenge_id, options}` (WebAuthn request options JSON) |
| `POST /passkeys/login/verify` | `{challenge_id, credential}` | `LoginOut` |
| `GET /passkeys` · `POST /passkeys/register/options` · `POST /passkeys/register/verify {challenge_id, credential, name?}` · `DELETE /passkeys/{id}` | (signed in) | manage passkeys |
| `POST /logout` | — | 204, ends this browser session |
| `GET /sessions` | — | `{web: {id, device_name, last_seen_at, current} \| null, mobile: {...} \| null}` |
| `DELETE /sessions/mobile` | — | 204, signs the phone out |
| `POST /register` | adds **`country`** (required unless `business.country`) | `TokenOut` (`status: ok`) |
| `PATCH /me` | `country` can change, never be cleared (`""` → 422) | `UserOut` |

`LoginOut`:
- `{status: "ok", access_token, token_type, expires_in, user}` — signed in.
- `{status: "confirm", challenge_id, otp_required, otp_sent_to, existing_session: {kind, device_name, last_seen_at} | null,
  expires_at, dev_code?}` — show one screen: the code input when `otp_required`, and the warning when
  `existing_session` is set; then `POST /login/confirm`.

`dev_code` only appears in development with email disabled (for testing without an inbox).

Errors: `invalid_login_code` (401), `login_challenge_expired` (400), `too_many_attempts` (429),
`session_replaced` (401 on any request: "You were signed out because your account signed in on another browser/phone"),
`token_revoked` (401), `passkey_invalid` / `passkey_unknown` (400).

Passkeys need a secure context: `https://…` or `http://localhost`. They don't work on `http://192.168.x.x`.

## Phone (`/api/v1/personal`, personal accounts)
| Endpoint | Body | Answer |
|---|---|---|
| `POST /sessions` | `{email, password}` or `{login_code}` or `{email_code_challenge_id, email_code}` + device fields (`installation_id`, …) | `201 {status: "ok", session_token, session, user, share_key, cards}` or `202 {status: "confirm", …same fields as LoginOut confirm}` |
| `POST /sessions/confirm` | `{challenge_id, code?}` | `201 {status: "ok", …}` |
| `POST /sessions/resend` | `{challenge_id}` | `{status: "sent", dev_code?}` |
| `POST /email-code` | `{email}` | `{challenge_id, sent_to, dev_code?}` |
| `GET /account` · `PATCH /account {full_name?, country?, phone?}` | | user |
| `POST /account/avatar` (multipart `file`) · `DELETE /account/avatar` | | user |

A replaced phone gets `401 session_replaced` on its next request.

## Admin
- `GET /api/v1/admin/demographics` → `{total_users, countries, without_country, active_30d, new_30d,
  by_account_type: {developer, business, personal}, by_country: [{country, users, developer, business, personal,
  active_30d, new_30d}], signups_by_month: [{month: "2026-09", users}] (12)}`
- `GET /api/v1/admin/accounts?country=RW` (or `country=none`).
