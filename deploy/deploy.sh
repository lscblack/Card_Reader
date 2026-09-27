#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  nexTap — one-shot production deploy (Ubuntu/Debian, systemd, nginx, PostgreSQL)
#
#  • Web : https://tap.nexventures.net      → nginx serving web/dist (static SPA)
#  • API : https://tap.api.nexventures.net  → uvicorn on a free local port (systemd: nextap-api)
#  • Code: deployed in place (this checkout; override with APP_DIR=…)
#  • Python: the conda env $CONDA_ENV (default fastapi_setup, Python ≥ 3.11; a name or an absolute prefix);
#            deps pip-installed into it when requirements.txt changes (or with --install-deps)
#
#  Before the first run copy the production env onto the server as backend/.env.p (or backend/.env).
#
#  Usage (on the server, as a sudoer):
#     sudo bash deploy/deploy.sh                 # full install / update (idempotent)
#     sudo bash deploy/deploy.sh --backend-only  # skip the frontend build
#     sudo bash deploy/deploy.sh --frontend-only # rebuild + publish the SPA only
#     sudo bash deploy/deploy.sh --no-certbot    # don't touch TLS certificates
#     sudo bash deploy/deploy.sh --install-packages  # allow apt-get for missing tools (off by default: this
#                                                # server hosts other apps and apt triggers needrestart)
#     sudo bash deploy/deploy.sh --set-db-password   # allow changing the password of an EXISTING database role
#                                                # (off by default — other apps on this server may use that role)
#     sudo bash deploy/deploy.sh --install-deps      # force pip install -r backend/requirements.txt
#     sudo bash deploy/deploy.sh --force-build       # rebuild the SPA even when the sources are unchanged
#
#  Re-running is cheap: the frontend build and pip install are skipped when nothing changed, the database
#  is only created when missing, migrations are idempotent, certificates are reused.
#
#  Scope: only nextap-api.service, the nginx site files for our two domains (nginx is *reloaded*, never
#  restarted) and — with --set-db-password — the PostgreSQL role password are touched.
#  Afterwards manage it with:  nextap status|start|stop|restart|logs|update …
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
trap 'printf "\e[1;31m✖ deploy failed at line %s: %s\e[0m\n" "$LINENO" "$BASH_COMMAND" >&2; echo "   (run again with --verbose for a full trace; nextap logs shows the API journal)"' ERR

# Deploys in place by default: the checkout this script lives in is the application directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="${APP_DIR:-$SRC_DIR}"
CONF_FILE=/etc/nextap.conf
API_DOMAIN="${API_DOMAIN:-tap.api.nexventures.net}"
WEB_DOMAIN="${WEB_DOMAIN:-tap.nexventures.net}"
SERVICE="nextap-api"
RUN_USER="${RUN_USER:-www-data}"
CONDA_ENV="${CONDA_ENV:-fastapi_setup}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-tech@nexventures.net}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/web"
STATE_DIR="$APP_DIR/.deploy"
DO_BACKEND=1; DO_FRONTEND=1; DO_CERTBOT=1; INSTALL_PKGS=0; SET_DB_PASSWORD=0; INSTALL_DEPS=0; FORCE_BUILD=0
for a in "$@"; do case "$a" in
  --backend-only) DO_FRONTEND=0;; --frontend-only) DO_BACKEND=0;; --no-certbot) DO_CERTBOT=0;; --install-packages) INSTALL_PKGS=1;;
  --set-db-password) SET_DB_PASSWORD=1;; --install-deps) INSTALL_DEPS=1;; --force-build) FORCE_BUILD=1;; --verbose|-v) set -x;;
  -h|--help) sed -n 2,28p "$0"; exit 0;; *) echo "unknown option $a"; exit 1;; esac; done

log()  { printf '\e[1;34m▶ %s\e[0m\n' "$*"; }
ok()   { printf '\e[1;32m✔ %s\e[0m\n' "$*"; }
die()  { printf '\e[1;31m✖ %s\e[0m\n' "$*" >&2; exit 1; }
apt_install() {
  ((INSTALL_PKGS)) || die "missing: $* — install them yourself (apt-get install $*) or rerun with --install-packages"
  NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive apt-get install -y -qq -o Dpkg::Options::=--force-confold "$@"
}
[[ $EUID -eq 0 ]] || die "run with sudo"
printf '\e[1m\n═══ nexTap — deploy ═══\e[0m\n'
echo "   app dir : $APP_DIR"
echo "   web     : https://$WEB_DOMAIN"
echo "   api     : https://$API_DOMAIN"
echo

# ── 0. code in place ────────────────────────────────────────────────────────
mkdir -p "$APP_DIR" "$STATE_DIR"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  log "Syncing code $SRC_DIR → $APP_DIR"
  command -v rsync >/dev/null || apt_install rsync
  rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude __pycache__ \
        --exclude 'backend/.env' --exclude 'backend/media' --exclude 'backend/releases' --exclude '.deploy' \
        --exclude 'mobile/build' --exclude 'mobile/.dart_tool' "$SRC_DIR/" "$APP_DIR/"
fi
cd "$APP_DIR"

# ── 1. environment file ─────────────────────────────────────────────────────
ENV_FILE="$BACKEND_DIR/.env"
PROD_ENV=""; for f in "$SRC_DIR/backend/.env.p" "$BACKEND_DIR/.env.p"; do [[ -f "$f" ]] && { PROD_ENV="$f"; break; }; done
# a development .env copied from a laptop must not run in production: swap it for .env.p and keep a backup
if [[ -f "$ENV_FILE" && -n "$PROD_ENV" ]] && grep -qE '^ENVIRONMENT=development' "$ENV_FILE"; then
  cp "$ENV_FILE" "$ENV_FILE.dev.bak.$(date +%s)"; cp "$PROD_ENV" "$ENV_FILE"
  ok "Replaced development .env with .env.p (backup kept next to it)"
fi
if [[ ! -f "$ENV_FILE" ]]; then
  [[ -n "$PROD_ENV" ]] || die "no backend/.env or backend/.env.p found.
   Copy the production env onto the server first (it is not in git):
       nano $BACKEND_DIR/.env.p      # paste the contents, save, rerun
   The .env.example template is never used as-is: its placeholder values would be written to live services."
  cp "$PROD_ENV" "$ENV_FILE"
  ok "Created $ENV_FILE from $(basename "$PROD_ENV")"
fi
envget() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | sed 's/^"//;s/"$//;s/^'"'"'//;s/'"'"'$//'; }
envset() { local v="${2//&/\\&}"; if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$v|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi; }
# production values derived from the domains (kept in sync on every deploy)
envset ENVIRONMENT production
envset DEBUG false
envset API_BASE_URL "https://$API_DOMAIN"
envset DEVICE_SERVER_URL "https://$API_DOMAIN"
envset PUBLIC_API_URL "https://$API_DOMAIN"
envset PUBLIC_WEB_URL "https://$WEB_DOMAIN"
envset PASSWORD_RESET_URL "https://$WEB_DOMAIN/reset-password"
envset CORS_ORIGINS "https://$WEB_DOMAIN"
envset TRUST_PROXY_HEADERS true
envset SEED_DEMO_DATA false
# real signing secrets are mandatory in production (the API refuses to start otherwise) — generate once
for k in JWT_SECRET WEBHOOK_SIGNING_SECRET; do
  v="$(envget "$k")"
  if [[ ${#v} -lt 32 || "$v" == change-this* ]]; then envset "$k" "$(openssl rand -hex 48)"; ok "Generated $k"; fi
done
# a MOBILE_PROJECT_DIR copied from a laptop does not exist here: point it at this checkout
MPD="$(envget MOBILE_PROJECT_DIR)"
if [[ -n "$MPD" && ! -d "$MPD" && -d "$APP_DIR/mobile" ]]; then envset MOBILE_PROJECT_DIR "$APP_DIR/mobile"; ok "MOBILE_PROJECT_DIR → $APP_DIR/mobile"; fi
chown "$RUN_USER:$RUN_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"

DB_USER="$(envget DB_USER)"; DB_USER="${DB_USER:-postgres}"
DB_NAME="$(envget DB_NAME)"; DB_NAME="${DB_NAME:-nfc_platform}"
DB_PASSWORD="$(envget DB_PASSWORD)"
DB_HOST="$(envget DB_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(envget DB_PORT)"; DB_PORT="${DB_PORT:-5432}"
[[ -n "$DB_PASSWORD" ]] || die "DB_PASSWORD is empty in $ENV_FILE — set DB_PASSWORD=... and rerun"
case "$DB_PASSWORD" in
  YourStrongPassword|REPLACE-ME*|changeme|change-this*|password|postgres)
    die "DB_PASSWORD in $ENV_FILE is still the example placeholder — set a real password before deploying." ;;
esac
(( ${#DB_PASSWORD} >= 10 )) || die "DB_PASSWORD in $ENV_FILE is shorter than 10 characters — use a stronger one"
[[ -n "$(envget DATABASE_URL)" ]] || die "DATABASE_URL is empty in $ENV_FILE"
ok "env file: $ENV_FILE (db user $DB_USER, db $DB_NAME @ $DB_HOST:$DB_PORT)"

# ── 2. system tools ─────────────────────────────────────────────────────────
log "Checking required tools (nothing is installed or restarted unless --install-packages)"
need=(); command -v nginx >/dev/null || need+=(nginx)
command -v psql >/dev/null || need+=(postgresql-client); command -v curl >/dev/null || need+=(curl); command -v openssl >/dev/null || need+=(openssl)
((${#need[@]})) && apt_install "${need[@]}"
for svc in nginx postgresql; do
  systemctl is-active --quiet "$svc" && ok "$svc is running" || echo "   ! $svc is not active — start it yourself (systemctl start $svc)"
done

# ── 3. database: role password + database ───────────────────────────────────
pg_try() { PGPASSWORD="$1" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -w -tAc "select 1" >/dev/null 2>&1; }
pg_admin() { sudo -u postgres psql -w -tAc "select 1" >/dev/null 2>&1; }
log "Checking PostgreSQL access for role '$DB_USER'"
ESC_PW="${DB_PASSWORD//\'/\'\'}"
if pg_try "$DB_PASSWORD"; then
  ok "role $DB_USER accepts DB_PASSWORD"
elif pg_admin && [[ -z "$(sudo -u postgres psql -w -tAc "select 1 from pg_roles where rolname = '${DB_USER//\'/\'\'}'")" ]]; then
  sudo -u postgres psql -w -qc "CREATE ROLE \"$DB_USER\" LOGIN CREATEDB PASSWORD '$ESC_PW';"
  ok "created database role '$DB_USER' (LOGIN CREATEDB)"
elif (( SET_DB_PASSWORD )) && pg_admin; then
  sudo -u postgres psql -w -qc "ALTER ROLE \"$DB_USER\" WITH PASSWORD '$ESC_PW';"
  ok "password of existing role $DB_USER changed to DB_PASSWORD (--set-db-password)"
else
  die "role '$DB_USER' exists but rejects DB_PASSWORD from $ENV_FILE.
   Other applications on this server may use that role, so the password is NOT changed automatically. Either:
     • put that role's real password in $ENV_FILE (DB_PASSWORD and DATABASE_URL), or
     • use a dedicated role: set DB_USER=nextap (and in DATABASE_URL) and rerun — it is created automatically, or
     • rerun with --set-db-password to overwrite the password of '$DB_USER' (affects every app using it)."
fi
pg_try "$DB_PASSWORD" || die "PostgreSQL still rejects DB_PASSWORD for $DB_USER@$DB_HOST:$DB_PORT (check pg_hba.conf allows md5/scram from 127.0.0.1)"
if [[ -z "$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -w -tAc "select 1 from pg_database where datname = '${DB_NAME//\'/\'\'}'")" ]]; then
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -w -qc "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
  ok "created database '$DB_NAME'"
else
  ok "database '$DB_NAME' exists"
fi
URL_HOST="$(envget DATABASE_URL | sed -nE 's#^[^/]+//[^@]+@([^:/]+).*#\1#p')"
if [[ -n "$URL_HOST" && "$URL_HOST" != "$DB_HOST" ]]; then
  echo "   ! DATABASE_URL connects to '$URL_HOST' while DB_HOST is '$DB_HOST' — the API uses DATABASE_URL;"
  echo "     PostgreSQL must listen on that address and pg_hba.conf must allow it (checked by the migration step below)"
fi
REDIS_URL="$(envget REDIS_URL)"
if [[ -n "$REDIS_URL" ]] && command -v redis-cli >/dev/null; then
  if [[ "$(redis-cli -u "$REDIS_URL" ping 2>/dev/null)" == "PONG" ]]; then ok "Redis reachable (shared rate limits + retries)"
  else echo "   ! Redis did not answer at $REDIS_URL — the API runs degraded (rate limiting fails open)"; fi
fi

# ── 4. python: conda env ────────────────────────────────────────────────────
# Resolve the env prefix: an absolute path is used as is, a name is looked up with conda
# (sudo drops the activated shell, so fall back to the usual install locations).
if [[ "$CONDA_ENV" == /* ]]; then PY_ENV="$CONDA_ENV"
else
  CONDA_BIN="${CONDA_EXE:-$(command -v conda || true)}"
  if [[ -z "$CONDA_BIN" ]]; then
    for c in /root/miniconda3 /root/anaconda3 /root/miniforge3 /opt/conda /opt/miniconda3 /opt/anaconda3 /opt/miniforge3; do
      [[ -x "$c/bin/conda" ]] && { CONDA_BIN="$c/bin/conda"; break; }
    done
  fi
  [[ -n "$CONDA_BIN" ]] || die "conda not found — run from a conda shell or set CONDA_ENV=/path/to/envs/$CONDA_ENV"
  PY_ENV="$("$CONDA_BIN" run -n "$CONDA_ENV" python -c 'import sys; print(sys.prefix)' 2>/dev/null | tail -n1)" || true
  [[ -n "$PY_ENV" ]] || die "conda env '$CONDA_ENV' not found ($CONDA_BIN env list) — create it: conda create -n $CONDA_ENV python=3.13"
fi
PYTHON="$PY_ENV/bin/python"
[[ -x "$PYTHON" ]] || die "no python in conda env $PY_ENV"
"$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 11))' || die "conda env $PY_ENV has $("$PYTHON" --version 2>&1) — Python 3.11+ is required"
# the API runs as $RUN_USER, which must be able to reach the env (e.g. a conda under /root is not traversable by www-data)
sudo -u "$RUN_USER" "$PYTHON" -c '' 2>/dev/null \
  || die "$RUN_USER cannot execute $PYTHON — make the conda install traversable for $RUN_USER (chmod o+x on its parent dirs)
   or rerun with RUN_USER=<a user that can>, e.g. RUN_USER=root"
ok "conda env: $CONDA_ENV → $PY_ENV ($("$PYTHON" --version 2>&1))"
if ((DO_BACKEND)); then
  REQ_SHA="$(sha1sum "$BACKEND_DIR/requirements.txt" | cut -d' ' -f1)"
  if ((INSTALL_DEPS)) || [[ "$(cat "$STATE_DIR/requirements.sha" 2>/dev/null)" != "$REQ_SHA" ]]; then
    log "Installing Python dependencies into conda env $CONDA_ENV"
    "$PYTHON" -m pip install -q -r "$BACKEND_DIR/requirements.txt" || die "pip could not install backend/requirements.txt (see above)"
    echo "$REQ_SHA" > "$STATE_DIR/requirements.sha"
    ok "python deps installed"
  else
    ok "python deps unchanged — skipping pip install (--install-deps to force)"
  fi
  ( cd "$BACKEND_DIR" && "$PYTHON" -c "import app.main" ) >"$STATE_DIR/envcheck.log" 2>&1 || {
    echo "── error from 'import app.main' ──"; tail -n 15 "$STATE_DIR/envcheck.log" >&2
    die "the backend cannot be imported (see above) — fix backend/.env or rerun with --install-deps"; }
  ok "backend imports cleanly (production settings accepted)"
fi

# ── 5. pick (and remember) a free API port ─────────────────────────────────
if [[ -f "$STATE_DIR/api_port" ]]; then API_PORT="$(cat "$STATE_DIR/api_port")"
else API_PORT="$("$PYTHON" - <<'PY'
import socket, random
for _ in range(50):
    p = random.randint(20000, 60000)
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", p)); print(p); break
    except OSError: continue
    finally: s.close()
PY
)"; echo "$API_PORT" > "$STATE_DIR/api_port"; fi
ok "API port: $API_PORT"

# ── 6. permissions ──────────────────────────────────────────────────────────
mkdir -p "$BACKEND_DIR/media" "$BACKEND_DIR/releases" "$STATE_DIR/home"
chown -R "$RUN_USER:$RUN_USER" "$BACKEND_DIR" "$STATE_DIR"
# APK builds (Part 3) run `flutter build apk` as $RUN_USER inside mobile/ and need a usable Flutter SDK
if [[ "$(envget APP_BUILD_ENABLED)" == "true" ]]; then
  [[ -d "$APP_DIR/mobile" ]] && chown -R "$RUN_USER:$RUN_USER" "$APP_DIR/mobile"
  FLUTTER_BIN="$(envget FLUTTER_BIN)"
  if [[ "$FLUTTER_BIN" == /snap/* ]]; then
    echo "   ! FLUTTER_BIN=$FLUTTER_BIN is a snap — it cannot run inside the $SERVICE service (as $RUN_USER, NoNewPrivileges)."
    echo "     Install the Flutter tarball to /opt/flutter and set FLUTTER_BIN=/opt/flutter/bin/flutter (see deploy notes)."
  elif [[ -x "$FLUTTER_BIN" ]]; then
    chown -R "$RUN_USER:$RUN_USER" "$(dirname "$(dirname "$FLUTTER_BIN")")"   # flutter writes its own bin/cache
    ok "flutter for APK builds: $FLUTTER_BIN"
  else
    echo "   ! FLUTTER_BIN=$FLUTTER_BIN not found — APK builds will fail (APP_BUILD_ENABLED=false to turn them off)"
  fi
  JH="$(envget JAVA_HOME)"; [[ -z "$JH" || -x "$JH/bin/java" ]] || echo "   ! JAVA_HOME=$JH has no bin/java — APK builds will fail"
  SDK="$(envget ANDROID_SDK_ROOT)"
  if [[ -z "$SDK" ]]; then echo "   ! ANDROID_SDK_ROOT is not set in backend/.env — APK builds need the Android SDK"
  elif [[ -d "$SDK" ]]; then chown -R "$RUN_USER:$RUN_USER" "$SDK"   # gradle installs missing platforms / NDK into it
  else echo "   ! ANDROID_SDK_ROOT=$SDK does not exist — APK builds will fail"; fi
fi
chmod -R u+rwX,go+rX,go-w "$BACKEND_DIR"; chmod 640 "$ENV_FILE"

# ── 7. migrations + systemd service ─────────────────────────────────────────
if ((DO_BACKEND)); then
  log "Applying database migrations (alembic upgrade head)"
  ( cd "$BACKEND_DIR" && sudo -u "$RUN_USER" env PYTHONUNBUFFERED=1 "$PY_ENV/bin/alembic" upgrade head ) \
    || die "alembic upgrade head failed — the error above is why the API cannot start (check DATABASE_URL in $ENV_FILE)"
  log "Writing /etc/systemd/system/$SERVICE.service"
  WORKERS="${WORKERS:-$(( $(nproc) * 2 + 1 ))}"; (( WORKERS > 4 )) && WORKERS=4
  sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@PYENV@|$PY_ENV|g" -e "s|@PORT@|$API_PORT|g" -e "s|@USER@|$RUN_USER|g" -e "s|@WORKERS@|$WORKERS|g" \
      "$APP_DIR/deploy/nextap-api.service" > "/etc/systemd/system/$SERVICE.service"
  if [[ "$APP_DIR" == /root/* || "$APP_DIR" == /home/* ]]; then
    sed -i -e '/^ProtectHome=/d' "/etc/systemd/system/$SERVICE.service"
  fi
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null
  log "Starting $SERVICE"
  systemctl restart "$SERVICE" || true
  for i in $(seq 1 60); do
    sleep 1; printf '.'
    curl -fs "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1 && break
    systemctl is-failed --quiet "$SERVICE" && break
  done; echo
  if curl -fs "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1; then ok "$SERVICE is running on 127.0.0.1:$API_PORT"
  else echo; echo "── last journal lines of $SERVICE ──"; journalctl -u "$SERVICE" -n 80 --no-pager -o cat | grep -v '^░░' || true; die "$SERVICE is not answering on port $API_PORT (see journal above)"; fi
fi

# ── 8. frontend build ───────────────────────────────────────────────────────
if ((DO_FRONTEND)); then
  if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
    ((INSTALL_PKGS)) || die "Node.js 20+ is required to build the frontend (found: $(node -v 2>/dev/null || echo none)). Install it, or rerun with --install-packages, or build locally and rsync web/dist"
    log "Installing Node.js 22 (NodeSource)"; curl -fsSL https://deb.nodesource.com/setup_22.x | NEEDRESTART_SUSPEND=1 bash - >/dev/null; apt_install nodejs
  fi
  # skip the rebuild when neither the sources, the dependencies nor the API origin changed since the last deploy
  BUILD_STAMP="$STATE_DIR/frontend.sha"
  BUILD_SHA="$(
    { find "$FRONTEND_DIR/src" "$FRONTEND_DIR/public" -type f -print0 2>/dev/null | sort -z | xargs -0 sha1sum 2>/dev/null
      sha1sum "$FRONTEND_DIR/package.json" "$FRONTEND_DIR/package-lock.json" "$FRONTEND_DIR/index.html" \
              "$FRONTEND_DIR/vite.config.ts" 2>/dev/null
      echo "$API_DOMAIN"
    } | sha1sum | cut -d' ' -f1
  )"
  if ((! FORCE_BUILD)) && [[ -f "$BUILD_STAMP" && -f "$FRONTEND_DIR/dist/index.html" && "$(cat "$BUILD_STAMP")" == "$BUILD_SHA" ]]; then
    ok "frontend unchanged since the last deploy — skipping the build (--force-build to rebuild)"
    DO_FRONTEND=0
  fi
fi
if ((DO_FRONTEND)); then
  log "Building frontend (VITE_API_BASE_URL=https://$API_DOMAIN)"
  # variables already in the environment override web/.env* files at build time
  ( cd "$FRONTEND_DIR" && CI=true npm ci --no-audit --no-fund --loglevel=error \
      && VITE_API_BASE_URL="https://$API_DOMAIN" VITE_USE_MOCKS=false npm run build )
  chown -R "$RUN_USER:$RUN_USER" "$FRONTEND_DIR/dist"
  echo "$BUILD_SHA" > "$BUILD_STAMP"
  ok "frontend built → $FRONTEND_DIR/dist"
fi

# ── 9. nginx ────────────────────────────────────────────────────────────────
log "Writing nginx sites (our domains only)"
[[ -f "$FRONTEND_DIR/dist/index.html" ]] || die "$FRONTEND_DIR/dist/index.html is missing — run without --backend-only first"
# CSP: allow exactly the inline scripts of the built index.html (theme script applied before first paint)
SCRIPT_HASHES="$("$PYTHON" - "$FRONTEND_DIR/dist/index.html" <<'PY'
import base64, hashlib, re, sys
html = open(sys.argv[1], encoding="utf-8").read()
inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
print(" ".join("'sha256-%s'" % base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() for s in inline if s.strip()))
PY
)"
render() {  # $1 template, $2 domain — emits the TLS listen/redirect itself when a certificate exists
  local tpl="$1" d="$2" live="/etc/letsencrypt/live/$2" listen redirect
  if [[ -f "$live/fullchain.pem" ]]; then
    listen="    listen 443 ssl;\n    listen [::]:443 ssl;\n    http2 on;\n    ssl_certificate $live/fullchain.pem;\n    ssl_certificate_key $live/privkey.pem;"
    [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]] && listen+="\n    include /etc/letsencrypt/options-ssl-nginx.conf;"
    [[ -f /etc/letsencrypt/ssl-dhparams.pem ]] && listen+="\n    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
    redirect="# HTTP → HTTPS (ACME challenges still answered so renewals work)\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name $d;\n    location /.well-known/acme-challenge/ { root /var/www/html; }\n    location / { return 301 https://\$host\$request_uri; }\n}"
  else
    listen="    listen 80;\n    listen [::]:80;\n    location /.well-known/acme-challenge/ { root /var/www/html; }"; redirect=""
  fi
  sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@PORT@|$API_PORT|g" -e "s|@API_DOMAIN@|$API_DOMAIN|g" -e "s|@WEB_DOMAIN@|$WEB_DOMAIN|g" \
      -e "s|@SCRIPT_HASHES@|$SCRIPT_HASHES|g" "$tpl" \
    | awk -v L="$listen" -v R="$redirect" '{ if ($0=="@LISTEN@") { gsub(/\\n/,"\n",L); print L } else if ($0=="@REDIRECT@") { gsub(/\\n/,"\n",R); print R } else print }'
}
write_sites() {
  render "$APP_DIR/deploy/nginx-api.conf" "$API_DOMAIN" > "/etc/nginx/sites-available/$API_DOMAIN"
  render "$APP_DIR/deploy/nginx-web.conf" "$WEB_DOMAIN" > "/etc/nginx/sites-available/$WEB_DOMAIN"
}
mkdir -p /var/www/html
write_sites
ln -sf "/etc/nginx/sites-available/$API_DOMAIN" "/etc/nginx/sites-enabled/$API_DOMAIN"
ln -sf "/etc/nginx/sites-available/$WEB_DOMAIN" "/etc/nginx/sites-enabled/$WEB_DOMAIN"
for d in "$API_DOMAIN" "$WEB_DOMAIN"; do [[ -f "/etc/letsencrypt/live/$d/fullchain.pem" ]] && ok "$d: HTTPS (443) + redirect from 80" || echo "   $d: HTTP only until a certificate exists"; done
nginx -t && systemctl reload nginx && ok "nginx reloaded (our sites only)"

# ── 10. TLS (one certificate per domain) ────────────────────────────────────
TLS_MISSING=()
if ((DO_CERTBOT)) && command -v certbot >/dev/null; then
  cert_for() {
    local d="$1"
    if [[ -d "/etc/letsencrypt/live/$d" ]]; then ok "certificate present for $d"; return; fi
    if ! getent ahosts "$d" >/dev/null 2>&1; then echo "   ✖ $d has no DNS A record yet — add one pointing here, then:  nextap cert"; TLS_MISSING+=("$d"); return; fi
    log "Requesting Let's Encrypt certificate for $d"
    certbot certonly --webroot -w /var/www/html -d "$d" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" \
      || { echo "   ✖ certbot failed for $d — fix the issue above, then:  nextap cert"; TLS_MISSING+=("$d"); }
  }
  cert_for "$API_DOMAIN"
  cert_for "$WEB_DOMAIN"
  write_sites
  nginx -t && systemctl reload nginx
  ((${#TLS_MISSING[@]})) && echo "   TLS still missing for: ${TLS_MISSING[*]}" || ok "TLS in place (auto-renew via certbot.timer)"
elif ((DO_CERTBOT)); then
  echo "   certbot not installed — skipping TLS (apt-get install certbot, then: nextap cert)"
fi

# ── 11. management CLI ──────────────────────────────────────────────────────
install -m 755 "$APP_DIR/deploy/nextap" /usr/local/bin/nextap
printf 'APP_DIR=%s\nSERVICE=%s\nAPI_PORT=%s\nPY_ENV=%s\nAPI_DOMAIN=%s\nWEB_DOMAIN=%s\nRUN_USER=%s\nDB_NAME=%s\nDB_USER=%s\n' \
  "$APP_DIR" "$SERVICE" "$API_PORT" "$PY_ENV" "$API_DOMAIN" "$WEB_DOMAIN" "$RUN_USER" "$DB_NAME" "$DB_USER" > "$STATE_DIR/config"
install -m 644 "$STATE_DIR/config" "$CONF_FILE"   # fixed path so `nextap` finds the deployment wherever it lives

echo; ok "Deploy complete"
scheme() { [[ -d "/etc/letsencrypt/live/$1" ]] && echo https || echo http; }
echo "   Web : $(scheme "$WEB_DOMAIN")://$WEB_DOMAIN"
echo "   API : $(scheme "$API_DOMAIN")://$API_DOMAIN/api/v1/health"
echo "   Manage: nextap status | nextap logs | nextap restart | nextap update | nextap help"
