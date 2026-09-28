# nexTap

Turn any NFC-enabled Android phone or iPhone into a programmable NFC card reader.

**NFC detection → Card ID → Secure delivery.** The platform reads the card identifier and delivers a
signed event to the developer's endpoint. What the ID *means* (attendance, access, loyalty, ticketing, …)
is entirely up to the developer.

```
NFC card → Android phone / iPhone (Flutter nexTap) → [platform relay | direct] → Developer endpoint
```

## Repository layout

| Path | What | Stack |
|---|---|---|
| [`backend/`](backend/) | REST API, auth, API keys, devices, event logging, signed webhook delivery, usage, billing architecture | Python, FastAPI, SQLAlchemy, PostgreSQL, Redis, JWT |
| [`web/`](web/) | Developer dashboard | React, TypeScript, Tailwind CSS |
| [`mobile/`](mobile/) | nexTap app for Android and iPhone (reader, terminal and digital card) | Flutter, Dart (Android, iOS) |
| [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) | The API contract shared by all three | — |

## Quick start (local)

```bash
# 1. Postgres + Redis (or use locally installed services)
docker compose up -d postgres redis

# 2. Backend
cd backend && conda activate fastapi_setup
pip install -r requirements.txt && cp .env.example .env   # set EMAIL_ENABLED=false for local dev
alembic upgrade head && uvicorn app.main:app --reload     # http://127.0.0.1:8000/docs

# 3. Dashboard
cd web && npm install && cp .env.example .env && npm run dev   # http://localhost:5173

# 4. Mobile (physical Android device with NFC)
cd mobile && flutter run --dart-define=API_BASE_URL=http://<your-lan-ip>:8000
```

Then: register on the dashboard → create an application (copy the API key and webhook secret, shown once) →
set the endpoint → enter the API key in the phone app → tap a card.

## Production server

Web: https://tap.nexventures.net · API: https://tap.api.nexventures.net. The code lives in `/var/www/Card_Reader`,
Python runs in the `fastapi_setup` conda env, the API is the systemd service `nextap-api`. Run everything as root
from `/var/www/Card_Reader`.

### Deploy

```bash
git pull
bash deploy/deploy.sh                          # full deploy (safe to rerun: finished steps are skipped)
bash deploy/deploy.sh --no-certbot             # same, without touching TLS certificates
bash deploy/deploy.sh --backend-only --no-certbot    # API only (deps, migrations, restart)
bash deploy/deploy.sh --frontend-only --no-certbot   # dashboard only (rebuild + publish, no API restart)
bash deploy/deploy.sh --install-deps           # force pip install -r backend/requirements.txt
bash deploy/deploy.sh --force-build            # rebuild the dashboard even if nothing changed
```

A deploy restarts the API, which **kills an APK build in progress**. Deploy between builds.

### Everyday commands (`nextap`, installed by the deploy)

| Command | What it does |
|---|---|
| `nextap status` | API service, nginx, postgres, redis and the API health check |
| `nextap start` · `stop` · `restart` | Control the API service |
| `nextap logs [n]` | Follow the API log · `nextap logs-tail [n]` last n lines · `nextap errors` errors only |
| `nextap nginx-logs` · `nextap nginx-test` | Follow nginx logs · test the config and reload |
| `nextap update` | `git pull` + full redeploy |
| `nextap build` · `nextap backend` | Redeploy the dashboard only · the API only |
| `nextap migrate` | Apply database migrations |
| `nextap env` | Edit `backend/.env` (then `nextap restart`) |
| `nextap psql` · `nextap shell` | Database shell · Python shell in the conda env |
| `nextap where` · `nextap port` | Paths, port, database, domains · the local API port |
| `nextap cert` · `nextap renew` | Get missing TLS certificates · renew them |
| `nextap backup` | Database dump + media/releases archive into `.deploy/backups/` |
| `nextap apk-check [--build]` | Check the server can build APKs (`--build` runs a real test build) |

### Android APK builds (admin → Releases)

```bash
bash deploy/setup-android-build.sh     # one time: JDK 17, Flutter, Android SDK, signing key, APP_BUILD_ENABLED=true
bash deploy/check-apk-build.sh         # what is missing or wrong (read-only)
bash deploy/check-apk-build.sh --build # real test build, same command as the admin page
```

Admins then build from https://tap.nexventures.net/admin/releases. The first build takes 10–25 min (Gradle
downloads); later builds take 2–5 min. Back up `/root/nextap-release.jks` and its password: without them no
update can be installed over the existing app.

Is a build really running?

```bash
ps -eo pid,etime,%cpu,rss,cmd | grep -E 'flutter|GradleDaemon' | grep -v grep | cut -c1-120
redis-cli get nfc:build:lock; redis-cli ttl nfc:build:lock
sudo -u postgres psql nfc_platform -c "select version_name, status, started_at, error from app_releases order by created_at desc limit 5;"
```

Stuck build (status `building` but no flutter/gradle process, e.g. after a restart):

```bash
redis-cli del nfc:build:lock && nextap restart   # the orphaned build is marked failed; build again
```

Gradle killed ("daemon disappeared"): check memory with
`journalctl -k --since "1 hour ago" | grep -i killed`. Gradle is capped at 3 GB in
`mobile/android/gradle.properties`.

Build by hand, without the admin page:

```bash
cd /var/www/Card_Reader/mobile
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_SDK_ROOT=/opt/android-sdk ANDROID_HOME=/opt/android-sdk
export GRADLE_USER_HOME=/var/www/Card_Reader/.deploy/home/.gradle
/opt/flutter/bin/flutter build apk --release --build-name=1.0.0 --build-number=99 \
  --dart-define=API_BASE_URL=https://tap.api.nexventures.net
/opt/android-sdk/build-tools/35.0.0/apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk
```

The signer must be `CN=nexTap`, never `CN=Android Debug`.

## Delivery modes

- **Relay (default):** phone → platform → your endpoint. The platform signs with your webhook secret, logs every
  attempt and retries server-side. The secret never leaves the server.
- **Direct:** phone → your endpoint. The phone signs with a per-device key derived from your webhook secret
  (`HMAC_SHA256(webhook_secret, "device:" + device_id)`), then reports the result to the platform for logging.

Every request carries `X-NFC-Timestamp`, `X-NFC-Nonce`, `X-NFC-Event-Id` and
`X-NFC-Signature: v1=HMAC_SHA256(secret, "{timestamp}.{nonce}.{raw_body}")`. See
[`backend/README.md`](backend/README.md) for verification examples.

## Security note

A card UID is an **identifier, not proof of identity** — many UIDs can be cloned or are randomised.
Every event is marked `security.authenticated = false` / `level = "uid_only"`. Do not use the UID alone for
payments, high-security access control or anything where impersonation matters.
![alt text](image.png)