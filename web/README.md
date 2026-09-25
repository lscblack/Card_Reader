# NFC Platform — Web Dashboard

React dashboard for the NFC SaaS platform: developers create applications, get API keys, register
Android phones (via the Flutter NFC Terminal app) as card readers, configure the endpoint that receives
HMAC-signed card events, and inspect events, deliveries and usage.

The API it talks to is specified in [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) — the single
source of truth. All request/response types live in `src/api/types.ts` and mirror it field-for-field.

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind CSS v4 · react-router · TanStack Query · recharts ·
lucide-react · qrcode (pairing QR, rendered as SVG). UI primitives are hand-built (no component kit).

## Getting started

```bash
cp .env.example .env         # adjust VITE_API_BASE_URL if the backend isn't on 127.0.0.1:8000
npm install
npm run dev                  # http://localhost:5173
```

The backend must allow the dashboard origin via CORS and should expose `Retry-After` and
`X-RateLimit-*` headers (`Access-Control-Expose-Headers`) so rate-limit messages can show the wait time.

### Demo without a backend (mock mode)

```bash
VITE_USE_MOCKS=true npm run dev
```

Every API call is served by an in-memory mock of the contract (`src/api/mock/server.ts`) seeded with
sample applications, devices and ~200 events; a new “tap” is simulated every few seconds so
auto-refresh has something to show. Pairing codes are auto-redeemed by a fake phone ~8 s after creation,
and the first application has a sample domain allowlist. Any email plus a password of 10+ characters signs you in (as an
admin, so the Admin page is visible). State resets on reload. The mock module is loaded through a
dynamic import behind a compile-time constant, so it is **not included** in normal builds.

> If `npm run dev` crashes with `EMFILE: too many open files, watch`, your machine is out of inotify
> instances; run with `CHOKIDAR_USEPOLLING=1 npm run dev` (or raise `fs.inotify.max_user_instances`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 5173 |
| `npm run build` | `tsc -b` type-check + production build to `dist/` |
| `npm run lint` | ESLint (typescript-eslint, react-hooks, react-refresh) |
| `npm run preview` | Serve the production build locally |

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Backend origin; the client appends `/api/v1`. The Swagger link uses `${VITE_API_BASE_URL}/docs`. |
| `VITE_USE_MOCKS` | `false` | Dev-only in-memory API mock. |

## Project layout

```
src/
  api/          client.ts (fetch wrapper, ApiError), types.ts (contract types), one module per resource, mock/
  auth/         token store, AuthProvider/useAuth, route guards
  components/   ui/ primitives (Button, Input, Card, Badge, Table, Modal/Drawer, EmptyState, Spinner,
                Toast, CopyButton, SecretReveal, CodeBlock, Tabs, …) and feature components
  hooks/        TanStack Query hooks (queries.ts), theme, debounce, etc.
  layouts/      AppLayout (sidebar + top bar + mobile drawer), AuthLayout
  lib/          formatting, URL validation hints, signature-verification code samples
  pages/        one file per route
```

Routes: `/` Overview · `/applications[/:id]` · `/api-keys` · `/devices` · `/events` · `/endpoints` ·
`/webhooks` · `/docs` · `/usage` · `/settings` · `/admin` (role `admin` only) · `/login` ·
`/register` · `/forgot-password` · `/reset-password?token=`.

## Part 2 layout (web-core)

- **Routes:** developer dashboard under `/dashboard/*` (old top-level paths like `/applications` redirect),
  admin console under `/admin/*`, auth pages `/login`, `/register` (Developer | Business, `?invite=`),
  `/verify-email?token=`. After sign-in: admin → `/admin`, business → `/business`, developer → `/dashboard`
  (a same-origin `?next=` wins). Core routes live in `src/routes/coreRoutes.tsx`; other areas mount theirs in `App.tsx`.
- **Shell:** `DashboardShell` (`src/layouts/DashboardShell.tsx`) renders the sidebar/drawer, top bar, user menu,
  verify-email banner and a `w-11/12` content column. Props: `nav`, `label`, `homeTo`, `sidebarTop`,
  `sidebarFooter`, `header`, `settingsPath`, `userMenuItems`, `showVerifyBanner`; children default to `<Outlet/>`.
- **Theme:** dark red accent, warm neutrals, dark by default. Use `text-accent` for text/icons and
  `bg-accent-solid` for filled controls. Chart colours come from `src/lib/chartColors.ts` (CSS variables, validated
  for both themes and colour-vision deficiency).
- **Errors:** `ApiError` carries `ref`, `requestId`, `docsUrl`; use `<ErrorAlert error={e} />` or
  `toast.fromError(e)` to show them with a copyable request id and a "What does this mean?" link.
- **API base:** leave `VITE_API_BASE_URL` empty to use `<current host>:8000` (works from phones on the LAN).
- **Mock personas** (`VITE_USE_MOCKS=true`): any 10+ character password; an email containing `admin` opens the
  admin console, `business` a business account, anything else the developer dashboard.

## Behaviour notes

- **Errors:** every non-2xx response is parsed from the `{ error: { code, message, details } }`
  envelope into an `ApiError`. Validation `details` are mapped onto form fields. `429` shows the
  `Retry-After` wait; `402 plan_limit_reached` points to the Usage page.
- **Session:** a `401` on any authenticated request (except `invalid_credentials`, e.g. a wrong
  current password) clears the token and redirects to `/login?next=…`. Changing the password signs
  you out, since the backend invalidates existing JWTs.
- **QR pairing (contract §7.3):** “Pair a phone” (Devices, app → Devices tab, Overview checklist) creates a
  pairing code, renders `qr_payload` as a QR, counts down to `expires_at`, polls status every 2 s and cancels a
  still-pending code when the dialog closes. The plaintext code lives only in the dialog's state.
- **Allowlists (§7.1, §7.2):** per-application allowed endpoint domains (Endpoint Configuration and the app
  detail page) and admin-managed CORS origins (Admin page).
- **UID only:** events are labelled “UID only” everywhere — a card was *detected*, not
  cryptographically authenticated. The docs page explains why a UID is not proof of identity.

## Security notes

- Plaintext secrets (API keys, webhook signing secrets) appear once, in component state only, inside a
  dialog that can't be dismissed by accident. They are never written to storage, the query cache, the
  URL or logs, and are dropped when the dialog closes. Tables only show `prefix…last4`.
- The dashboard JWT is kept in `localStorage` for simplicity. That leaves it readable by any XSS on
  this origin. **Future hardening:** have the backend issue the session as an `httpOnly`,
  `Secure`, `SameSite=Strict` cookie (with CSRF protection) and remove client-side token storage.
- Post-login redirects only accept same-origin relative paths (no open redirects).
- Endpoint URLs are checked client-side (https, no credentials, no fragment, ≤ 2048 chars) for fast
  feedback only; the server remains authoritative, including SSRF checks.
- `no-console` is enforced by ESLint (only `console.warn/error` are allowed) to avoid accidental logging.
