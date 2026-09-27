#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  nexTap — Part 3 check: can this server build APKs from the admin dashboard?
#
#  Read-only: installs, changes and restarts nothing. Checks every setting the build worker
#  (backend/app/services/app_builds.py) uses, as the service user, and prints what to fix.
#
#  Usage (on the server):   bash deploy/check-apk-build.sh      (or: nextap apk-check)
#            --build         also run a real debug build (slow the first time; writes mobile/build)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f /etc/nextap.conf ]] && source /etc/nextap.conf
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUN_USER="${RUN_USER:-root}"
BACKEND_DIR="$APP_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env"; [[ -f "$ENV_FILE" ]] || ENV_FILE="$BACKEND_DIR/.env.p"
DO_BUILD=0; for a in "$@"; do case "$a" in --build) DO_BUILD=1;; -h|--help) sed -n 2,10p "$0"; exit 0;; *) echo "unknown option $a"; exit 1;; esac; done

FAILS=0; WARNS=0
pass() { printf '  \e[1;32m✔\e[0m %s\n' "$*"; }
fail() { printf '  \e[1;31m✖\e[0m %s\n' "$1"; [[ -n "${2:-}" ]] && printf '      → %s\n' "$2"; FAILS=$((FAILS + 1)); }
warn() { printf '  \e[1;33m!\e[0m %s\n' "$1"; [[ -n "${2:-}" ]] && printf '      → %s\n' "$2"; WARNS=$((WARNS + 1)); }
head_() { printf '\n\e[1m%s\e[0m\n' "$*"; }
envget() { { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed 's/^"//;s/"$//;s/^'"'"'//;s/'"'"'$//'; }
as_user() { if [[ "$(id -un)" == "$RUN_USER" ]]; then "$@"; else sudo -u "$RUN_USER" "$@"; fi; }
abspath() { [[ "$1" == /* ]] && echo "$1" || echo "$BACKEND_DIR/${1#./}"; }   # the API runs in backend/

printf '\e[1m\n═══ nexTap — APK build check (Part 3) ═══\e[0m\n'
echo "   app dir : $APP_DIR"
echo "   env     : $ENV_FILE"
echo "   runs as : $RUN_USER (the API service user — builds run as this user)"
[[ -f "$ENV_FILE" ]] || { echo; fail "no backend/.env or backend/.env.p" "copy the production env onto the server first"; exit 1; }

# ── settings ────────────────────────────────────────────────────────────────
head_ "Settings (backend/.env)"
[[ "$(envget APP_BUILD_ENABLED)" == "true" ]] && pass "APP_BUILD_ENABLED=true" \
  || fail "APP_BUILD_ENABLED is not true — the admin Build button is disabled" "set APP_BUILD_ENABLED=true in $ENV_FILE, then: nextap restart"
FLUTTER_BIN="$(envget FLUTTER_BIN)"; FLUTTER_BIN="${FLUTTER_BIN:-flutter}"
MOBILE_DIR="$(envget MOBILE_PROJECT_DIR)"
JAVA_HOME_="$(envget JAVA_HOME)"
SDK="$(envget ANDROID_SDK_ROOT)"
RELEASES="$(abspath "$(envget RELEASES_ROOT)")"; [[ "$(envget RELEASES_ROOT)" ]] || RELEASES="$BACKEND_DIR/releases"
TIMEOUT="$(envget APP_BUILD_TIMEOUT_SECONDS)"
for k in FLUTTER_BIN MOBILE_PROJECT_DIR JAVA_HOME ANDROID_SDK_ROOT; do printf '      %-19s %s\n' "$k" "$(envget $k)"; done

# ── flutter ─────────────────────────────────────────────────────────────────
head_ "Flutter"
if [[ "$FLUTTER_BIN" != /* ]]; then
  fail "FLUTTER_BIN=$FLUTTER_BIN is not an absolute path" "the service PATH is minimal: set FLUTTER_BIN=/opt/flutter/bin/flutter"
elif [[ "$FLUTTER_BIN" == /snap/* ]]; then
  fail "FLUTTER_BIN is a snap ($FLUTTER_BIN) — snaps cannot run inside the systemd service" \
       "git clone https://github.com/flutter/flutter.git -b stable /opt/flutter; FLUTTER_BIN=/opt/flutter/bin/flutter"
elif [[ ! -x "$FLUTTER_BIN" ]]; then
  fail "FLUTTER_BIN=$FLUTTER_BIN does not exist" "git clone https://github.com/flutter/flutter.git -b stable /opt/flutter"
else
  FL_OUT="$(as_user env HOME="$APP_DIR/.deploy/home" CI=true "$FLUTTER_BIN" --version 2>&1)"
  if [[ $? -ne 0 ]]; then
    fail "flutter --version failed as $RUN_USER" "$(echo "$FL_OUT" | tail -n 2 | tr '\n' ' ')"
  else
    FL_VER="$(echo "$FL_OUT" | sed -nE 's/^Flutter ([0-9.]+).*/\1/p' | head -1)"
    DART_VER="$(echo "$FL_OUT" | sed -nE 's/.*Dart ([0-9.]+).*/\1/p' | head -1)"
    NEED_DART="$(sed -nE 's/^[[:space:]]+sdk:[[:space:]]*\^?([0-9.]+).*/\1/p' "${MOBILE_DIR:-$APP_DIR/mobile}/pubspec.yaml" 2>/dev/null | head -1)"
    if [[ -n "$NEED_DART" && -n "$DART_VER" ]] && ! printf '%s\n%s\n' "$NEED_DART" "$DART_VER" | sort -V -C; then
      fail "Flutter $FL_VER has Dart $DART_VER, the app needs Dart ≥ $NEED_DART" "$FLUTTER_BIN upgrade   (or git -C /opt/flutter pull)"
    else
      pass "Flutter $FL_VER (Dart $DART_VER${NEED_DART:+, app needs ≥ $NEED_DART})"
    fi
  fi
  FL_ROOT="$(dirname "$(dirname "$FLUTTER_BIN")")"
  as_user test -w "$FL_ROOT/bin/cache" 2>/dev/null || as_user test -w "$FL_ROOT" \
    && pass "$RUN_USER can write the Flutter SDK cache" \
    || fail "$RUN_USER cannot write $FL_ROOT (flutter updates bin/cache on its own)" "chown -R $RUN_USER:$RUN_USER $FL_ROOT"
  [[ "$FL_ROOT" == /root/* || "$FL_ROOT" == /home/* ]] && [[ "$RUN_USER" != root ]] \
    && warn "Flutter is under a home directory — the service sees /root and /home read-only" "move it to /opt/flutter"
fi

# ── java ────────────────────────────────────────────────────────────────────
head_ "Java (Gradle 8.14 needs JDK 17–24; 17 or 21 recommended)"
JAVA="${JAVA_HOME_:+$JAVA_HOME_/bin/java}"; JAVA="${JAVA:-$(command -v java || true)}"
if [[ -z "$JAVA_HOME_" ]]; then warn "JAVA_HOME is empty — the build uses whatever java is on PATH" "set JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64"; fi
if [[ -z "$JAVA" || ! -x "$JAVA" ]]; then
  fail "no java found${JAVA_HOME_:+ at $JAVA_HOME_/bin/java}" "apt-get install openjdk-17-jdk-headless"
else
  JV="$("$JAVA" -version 2>&1 | sed -nE 's/.*version "([0-9]+)(\.[0-9]+)*.*/\1/p' | head -1)"
  if [[ -z "$JV" ]]; then warn "could not read the Java version of $JAVA"
  elif (( JV < 17 || JV > 24 )); then fail "Java $JV at $JAVA — Gradle 8.14 does not run on it" "apt-get install openjdk-17-jdk-headless; JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64"
  else pass "Java $JV ($JAVA)"; fi
  [[ -x "$(dirname "$JAVA")/javac" ]] && pass "JDK (javac present)" || fail "$JAVA is a JRE — Gradle needs the full JDK" "apt-get install openjdk-17-jdk-headless"
fi

# ── android sdk ─────────────────────────────────────────────────────────────
head_ "Android SDK"
if [[ -z "$SDK" ]]; then
  fail "ANDROID_SDK_ROOT is empty" "install the command-line tools to /opt/android-sdk and set ANDROID_SDK_ROOT=/opt/android-sdk"
elif [[ ! -d "$SDK" ]]; then
  fail "ANDROID_SDK_ROOT=$SDK does not exist" "install the command-line tools to /opt/android-sdk"
else
  SDKMANAGER="$(ls -d "$SDK"/cmdline-tools/*/bin/sdkmanager 2>/dev/null | head -1)"
  [[ -n "$SDKMANAGER" ]] && pass "cmdline-tools ($SDKMANAGER)" || fail "no cmdline-tools in $SDK" "unzip commandlinetools-linux-*.zip to $SDK/cmdline-tools/latest"
  PLATS="$(ls "$SDK/platforms" 2>/dev/null | tr '\n' ' ')"
  [[ -n "$PLATS" ]] && pass "platforms: $PLATS" || warn "no platforms installed yet (Gradle will try to download them)" "sdkmanager \"platforms;android-35\""
  BT="$(ls "$SDK/build-tools" 2>/dev/null | tr '\n' ' ')"
  [[ -n "$BT" ]] && pass "build-tools: $BT" || warn "no build-tools installed yet (Gradle will try to download them)" "sdkmanager \"build-tools;35.0.0\""
  [[ -d "$SDK/platform-tools" ]] && pass "platform-tools" || warn "platform-tools missing" "sdkmanager \"platform-tools\""
  ls "$SDK/licenses/android-sdk-license" >/dev/null 2>&1 && pass "SDK licenses accepted" \
    || fail "SDK licenses not accepted — Gradle refuses to download missing components" "yes | ${SDKMANAGER:-sdkmanager} --licenses"
  as_user test -w "$SDK" && pass "$RUN_USER can write the SDK (Gradle installs missing platforms/NDK)" \
    || fail "$RUN_USER cannot write $SDK" "chown -R $RUN_USER:$RUN_USER $SDK"
fi

# ── mobile project ──────────────────────────────────────────────────────────
head_ "Mobile project"
if [[ -z "$MOBILE_DIR" ]]; then
  fail "MOBILE_PROJECT_DIR is empty" "set MOBILE_PROJECT_DIR=$APP_DIR/mobile"
elif [[ ! -f "$MOBILE_DIR/pubspec.yaml" ]]; then
  fail "no pubspec.yaml in MOBILE_PROJECT_DIR=$MOBILE_DIR" "set MOBILE_PROJECT_DIR=$APP_DIR/mobile"
else
  pass "project: $MOBILE_DIR (version $(sed -nE 's/^version:[[:space:]]*(.*)/\1/p' "$MOBILE_DIR/pubspec.yaml"))"
  as_user test -w "$MOBILE_DIR" && pass "$RUN_USER can write the project (build/, .dart_tool/)" \
    || fail "$RUN_USER cannot write $MOBILE_DIR" "chown -R $RUN_USER:$RUN_USER $MOBILE_DIR"
fi

# ── release signing ─────────────────────────────────────────────────────────
head_ "Release signing (the worker does not pass NFC_KEYSTORE_* — key.properties is required)"
KP="${MOBILE_DIR:-$APP_DIR/mobile}/android/key.properties"
kpget() { { grep -E "^$1=" "$KP" || true; } | tail -1 | cut -d= -f2-; }
if [[ ! -f "$KP" ]]; then
  fail "no $KP — release APKs would be signed with the DEBUG key (never publish those)" \
       "keytool -genkeypair -v -keystore /root/nextap-release.jks -alias nextap -keyalg RSA -keysize 4096 -validity 10000, then write key.properties (see mobile/README.md)"
else
  SF="$(kpget storeFile)"; [[ "$SF" == /* ]] || SF="$(dirname "$KP")/$SF"
  missing=""; for k in storeFile storePassword keyAlias keyPassword; do [[ -n "$(kpget $k)" ]] || missing+=" $k"; done
  [[ -z "$missing" ]] && pass "key.properties has storeFile, storePassword, keyAlias, keyPassword" || fail "key.properties is missing:$missing"
  if [[ ! -f "$SF" ]]; then
    fail "keystore $SF does not exist"
  elif ! as_user test -r "$SF"; then
    fail "$RUN_USER cannot read the keystore $SF" "chown $RUN_USER $SF"
  else
    KEYTOOL="${JAVA_HOME_:+$JAVA_HOME_/bin/keytool}"; KEYTOOL="${KEYTOOL:-$(command -v keytool || true)}"
    if [[ -x "$KEYTOOL" ]]; then
      if "$KEYTOOL" -list -keystore "$SF" -storepass "$(kpget storePassword)" -alias "$(kpget keyAlias)" >/dev/null 2>&1; then
        pass "keystore opens with storePassword and contains alias '$(kpget keyAlias)'"
      else
        fail "keystore $SF does not open with storePassword, or has no alias '$(kpget keyAlias)'" \
             "check with: keytool -list -keystore $SF"
      fi
    else
      warn "keytool not found — keystore password not verified"
    fi
  fi
fi

# ── output + service ────────────────────────────────────────────────────────
head_ "Output + service"
if [[ -d "$RELEASES" ]]; then
  as_user test -w "$RELEASES" && pass "releases dir writable: $RELEASES" || fail "$RUN_USER cannot write $RELEASES" "chown -R $RUN_USER:$RUN_USER $RELEASES"
else
  warn "releases dir $RELEASES does not exist yet (created on the first build)"
fi
[[ -z "$TIMEOUT" || "$TIMEOUT" -ge 900 ]] 2>/dev/null && pass "build timeout ${TIMEOUT:-1800}s" \
  || warn "APP_BUILD_TIMEOUT_SECONDS=$TIMEOUT is short — the first build (Gradle downloads) can take 15+ min" "APP_BUILD_TIMEOUT_SECONDS=1800"
FREE_GB="$(df -Pk "$APP_DIR" | awk 'NR==2 { printf "%d", $4/1048576 }')"
(( FREE_GB >= 10 )) && pass "free disk: ${FREE_GB} GB" || warn "only ${FREE_GB} GB free — Gradle caches + builds need ~10 GB"
MEM_GB="$(awk '/MemTotal/ { printf "%d", $2/1048576 }' /proc/meminfo)"
(( MEM_GB >= 4 )) && pass "memory: ${MEM_GB} GB" || warn "only ${MEM_GB} GB RAM — Gradle may be killed; add swap"
SERVICE="${SERVICE:-nextap-api}"
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  pass "$SERVICE is running"
  SVC_ENV="$(systemctl show -p Environment --value "$SERVICE" 2>/dev/null)"
  [[ "$SVC_ENV" == *GRADLE_USER_HOME=* ]] && pass "service has HOME/PUB_CACHE/GRADLE_USER_HOME set" \
    || warn "the service unit has no GRADLE_USER_HOME — it is from an older deploy" "bash deploy/deploy.sh --backend-only --no-certbot"
  SVC_START="$(systemctl show -p ActiveEnterTimestamp --value "$SERVICE" 2>/dev/null)"
  if [[ -n "$SVC_START" ]] && [[ "$(stat -c %Y "$ENV_FILE")" -gt "$(date -d "$SVC_START" +%s 2>/dev/null || echo 0)" ]]; then
    warn "$ENV_FILE changed after $SERVICE started — the running API still uses the old settings" "nextap restart"
  fi
else
  warn "$SERVICE is not running" "nextap start   (or bash deploy/deploy.sh)"
fi

# ── optional real build ─────────────────────────────────────────────────────
if (( DO_BUILD )) && (( FAILS == 0 )); then
  head_ "Test build (debug APK, same command and environment as the worker)"
  H="$APP_DIR/.deploy/home"; mkdir -p "$H"
  PATH_="$(dirname "$FLUTTER_BIN")${JAVA_HOME_:+:$JAVA_HOME_/bin}:/usr/local/bin:/usr/bin:/bin"
  if ( cd "$MOBILE_DIR" && as_user env -i PATH="$PATH_" HOME="$H" PUB_CACHE="$H/.pub-cache" GRADLE_USER_HOME="$H/.gradle" \
         LANG=C.UTF-8 CI=true FLUTTER_SUPPRESS_ANALYTICS=true ${JAVA_HOME_:+JAVA_HOME="$JAVA_HOME_"} \
         ANDROID_SDK_ROOT="$SDK" ANDROID_HOME="$SDK" \
         "$FLUTTER_BIN" build apk --debug --dart-define=API_BASE_URL="https://${API_DOMAIN:-tap.api.nexventures.net}" ); then
    pass "debug APK built: $MOBILE_DIR/build/app/outputs/flutter-apk/app-debug.apk"
  else
    fail "the test build failed — the error above is what the admin build log would show"
  fi
elif (( DO_BUILD )); then
  echo; echo "  (test build skipped: fix the ✖ items first)"
fi

# ── summary ─────────────────────────────────────────────────────────────────
echo
if (( FAILS == 0 )); then
  printf '\e[1;32m✔ Ready: admins can build APKs at https://%s/admin/releases\e[0m' "${WEB_DOMAIN:-tap.nexventures.net}"
  (( WARNS )) && printf ' \e[1;33m(%d warning(s) above)\e[0m' "$WARNS"; echo
  (( DO_BUILD )) || echo "   To prove it end to end: bash deploy/check-apk-build.sh --build"
  exit 0
fi
printf '\e[1;31m✖ Not ready: %d problem(s), %d warning(s) — fix the ✖ items above (→ shows how), then rerun.\e[0m\n' "$FAILS" "$WARNS"
exit 1
