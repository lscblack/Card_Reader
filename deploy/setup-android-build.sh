#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  nexTap — one-time server setup for APK builds from the admin page (Part 3)
#
#  Installs what is missing (JDK 17, Flutter, Android SDK), creates the release signing key,
#  turns builds on in backend/.env and restarts the API. Safe to rerun: done steps are skipped.
#
#  Usage (on the server, as root):   bash deploy/setup-android-build.sh
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
trap 'printf "\e[1;31m✖ failed at line %s: %s\e[0m\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f /etc/nextap.conf ]] && source /etc/nextap.conf
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUN_USER="${RUN_USER:-root}"
ENV_FILE="$APP_DIR/backend/.env"
FLUTTER_DIR=/opt/flutter
SDK=/opt/android-sdk
KEYSTORE=/root/nextap-release.jks
KEY_ALIAS=nextap
KEY_PROPS="$APP_DIR/mobile/android/key.properties"
CMDLINE_ZIP=https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip

log() { printf '\e[1;34m▶ %s\e[0m\n' "$*"; }
ok()  { printf '\e[1;32m✔ %s\e[0m\n' "$*"; }
die() { printf '\e[1;31m✖ %s\e[0m\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"
[[ -f "$ENV_FILE" ]] || die "no $ENV_FILE — run bash deploy/deploy.sh first"
envset() { sed -i '/^'"$1"'=/d' "$ENV_FILE"; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; }
apt_get() { NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"; }

# ── 1. JDK 17 ───────────────────────────────────────────────────────────────
JAVA_HOME="$(ls -d /usr/lib/jvm/java-17-openjdk-* 2>/dev/null | head -1 || true)"
if [[ -z "$JAVA_HOME" || ! -x "$JAVA_HOME/bin/javac" ]]; then
  log "Installing JDK 17"
  apt_get openjdk-17-jdk-headless unzip wget git
  JAVA_HOME="$(ls -d /usr/lib/jvm/java-17-openjdk-* | head -1)"
fi
export JAVA_HOME
ok "JDK 17: $JAVA_HOME"

# ── 2. Flutter ──────────────────────────────────────────────────────────────
if [[ ! -x "$FLUTTER_DIR/bin/flutter" ]]; then
  log "Installing Flutter (stable) to $FLUTTER_DIR"
  command -v git >/dev/null || apt_get git
  git clone -q --depth 1 -b stable https://github.com/flutter/flutter.git "$FLUTTER_DIR"
fi
"$FLUTTER_DIR/bin/flutter" --version >/dev/null 2>&1 || die "flutter does not run: $FLUTTER_DIR/bin/flutter --version"
ok "Flutter: $("$FLUTTER_DIR/bin/flutter" --version 2>/dev/null | head -1)"

# ── 3. Android SDK ──────────────────────────────────────────────────────────
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$SDKMANAGER" ]]; then
  log "Installing Android command-line tools to $SDK"
  command -v unzip >/dev/null || apt_get unzip
  tmp="$(mktemp -d)"
  wget -q -O "$tmp/tools.zip" "$CMDLINE_ZIP"
  unzip -q "$tmp/tools.zip" -d "$tmp"
  mkdir -p "$SDK/cmdline-tools"; rm -rf "$SDK/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"; rm -rf "$tmp"
fi
log "Accepting SDK licenses + installing platform-tools, platform 35, build-tools 35"
yes | "$SDKMANAGER" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
"$SDKMANAGER" --sdk_root="$SDK" "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/dev/null
ok "Android SDK: $SDK"

# ── 4. release signing key ──────────────────────────────────────────────────
if [[ -f "$KEY_PROPS" ]]; then
  ok "signing: $KEY_PROPS already exists (kept)"
else
  if [[ -f "$KEYSTORE" ]]; then
    echo "   $KEYSTORE already exists — enter its password to reuse it"
    read -rsp "   keystore password: " PW; echo
  else
    log "Creating the release signing key $KEYSTORE"
    echo "   Pick a password (6+ chars). BACK UP $KEYSTORE AND THIS PASSWORD — without them you can never"
    echo "   publish an update that installs over the app on users' phones."
    read -rsp "   password: " PW; echo; read -rsp "   again:    " PW2; echo
    [[ "$PW" == "$PW2" ]] || die "passwords differ"
    (( ${#PW} >= 6 )) || die "password must be at least 6 characters"
    "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KEYSTORE" -alias "$KEY_ALIAS" -keyalg RSA -keysize 4096 \
      -validity 10000 -storepass "$PW" -keypass "$PW" -dname "CN=nexTap, O=Nexventures" >/dev/null 2>&1
    chmod 600 "$KEYSTORE"
  fi
  "$JAVA_HOME/bin/keytool" -list -keystore "$KEYSTORE" -storepass "$PW" -alias "$KEY_ALIAS" >/dev/null 2>&1 \
    || die "wrong password for $KEYSTORE (or no alias '$KEY_ALIAS' in it)"
  printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=%s\nkeyPassword=%s\n' "$KEYSTORE" "$PW" "$KEY_ALIAS" "$PW" > "$KEY_PROPS"
  chmod 600 "$KEY_PROPS"
  ok "signing key ready ($KEY_PROPS)"
fi

# ── 5. backend settings + ownership + restart ──────────────────────────────
sed -i 's/\r$//' "$ENV_FILE"
envset APP_BUILD_ENABLED true
envset FLUTTER_BIN "$FLUTTER_DIR/bin/flutter"
envset MOBILE_PROJECT_DIR "$APP_DIR/mobile"
envset JAVA_HOME "$JAVA_HOME"
envset ANDROID_SDK_ROOT "$SDK"
grep -q '^APP_BUILD_TIMEOUT_SECONDS=' "$ENV_FILE" || envset APP_BUILD_TIMEOUT_SECONDS 1800
ok "backend/.env: builds enabled"
if [[ "$RUN_USER" != root ]]; then
  chown -R "$RUN_USER:$RUN_USER" "$FLUTTER_DIR" "$SDK" "$APP_DIR/mobile"; chown "$RUN_USER" "$KEYSTORE" "$KEY_PROPS"
fi
systemctl restart "${SERVICE:-nextap-api}"
ok "API restarted"

echo
bash "$SCRIPT_DIR/check-apk-build.sh"
