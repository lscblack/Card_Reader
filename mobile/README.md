# nexTap (Android)

A generic NFC terminal: it turns an NFC-capable Android phone into a card reader.

**Tap a card → read its UID → deliver the event to the developer's endpoint.**

The app has no business logic. It does not know what a card means. A UID is an
identifier, **not proof of identity**: every read is labelled *"Card detected · UID only
(not authenticated)"*, and every event carries `security.authenticated = false`,
`security.level = "uid_only"`.

The API it talks to is defined in [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) (sections 2–4 and
"Device API").

## Requirements

- Flutter 3.41+ (Dart 3.11+), Android SDK with API 36 platform
- A **physical Android phone with NFC** (minSdk 24 / Android 7.0). The Android emulator has no
  NFC hardware, so the reader screen shows "NFC not supported" there. You can still test
  registration, config sync and history on an emulator.

## Run

```bash
cd mobile
flutter pub get

# Physical device on the same network as your backend (HTTPS in production):
flutter run --dart-define=API_BASE_URL=https://api.example.com

# Emulator talking to a backend on your machine (http://10.0.2.2 = host's localhost):
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000
```

`API_BASE_URL` only pre-fills the "Server URL" field on the setup screen. You can type another
URL there. `https://…/api/v1` is also accepted: the suffix is stripped.

**Debug builds** allow plain `http://` to any host, so a phone on the same Wi-Fi can use your PC's
LAN IP, e.g. `flutter run --dart-define=API_BASE_URL=http://192.168.1.74:8000` (run the backend with
`--host 0.0.0.0`). The dashboard shows this URL with a copy button (Overview and Devices pages), set
by `DEVICE_SERVER_URL` in the backend `.env`. The debug-only rule lives in
`android/app/src/debug/res/xml/network_security_config.xml`.

**Release builds** allow plain `http://` only for `10.0.2.2`, `localhost` and `127.0.0.1`
(`android/app/src/main/res/xml/network_security_config.xml`); use HTTPS everywhere else.

Build an APK:

```bash
flutter build apk --debug      # build/app/outputs/flutter-apk/app-debug.apk
flutter build apk --release    # needs a release keystore, see "Release signing"
```

### Release signing

Release APKs must be signed with your own upload/release key. Without one, the build still
succeeds but falls back to the **debug key** and Gradle prints
`WARNING: nexTap release build is signed with the DEBUG key …` — never publish such an APK
(anyone with the public Android debug key could ship an "update" of it).

1. Create a keystore once and keep it (and its passwords) safe — losing it means you can no
   longer publish updates that install over the existing app:

   ```bash
   keytool -genkeypair -v -keystore ~/nextap-release.jks -alias nextap \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Either create `mobile/android/key.properties` (git-ignored, like `*.jks`/`*.keystore`, see
   `android/.gitignore`):

   ```properties
   # absolute, or relative to mobile/android/ (no trailing comments in .properties values)
   storeFile=/home/you/nextap-release.jks
   storePassword=…
   keyAlias=nfc-terminal
   keyPassword=…
   ```

   or, on CI / the admin build pipeline, set the environment variables `NFC_KEYSTORE_PATH`,
   `NFC_KEYSTORE_PASSWORD`, `NFC_KEY_ALIAS` and `NFC_KEY_PASSWORD` (`key.properties` wins when both
   are present).

3. `flutter build apk --release` — check with
   `apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk` that the
   certificate is yours and not `CN=Android Debug`.

Release builds only accept `https://` servers (plain `http://` only for `10.0.2.2`, `localhost`,
`127.0.0.1`): the setup/sign-in forms and pairing/sign-in QR codes reject LAN `http://` URLs with a
clear message, and the OS network security config blocks them anyway.

**Troubleshooting: "What went wrong: 25.0.3".** The generated project uses Gradle 8.14,
which cannot run on JDK 25 (the JDK bundled with recent Android Studio). You have two fixes:

- Point Flutter at JDK 17 or 21: `flutter config --jdk-dir=/usr/lib/jvm/java-17-openjdk-amd64`
- Or build with Gradle directly:
  `cd android && JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleDebug`

## First-time setup on the phone

1. In the web dashboard, create an application (or open an existing one) and go to
   **API keys**. Create a key and copy it. It starts with `nfc_` and is only shown once.
2. Open nexTap. Enter the server URL, paste the API key and confirm the device name
   (it is pre-filled from the phone model). Then tap **Register device**.
3. The app calls `POST /api/v1/device/register` and keeps **only** the device token
   (`nfcd_…`), the server URL and an installation ID. It stores them in Android Keystore-backed
   secure storage. The API key is never stored.
4. The device appears in the dashboard under **Devices**. There you can rename or revoke it.
   A revoked device is signed out automatically at its next API call, with an explanation.

## Pairing with a QR code (recommended)

In the dashboard, open the application and generate a pairing QR code. On the phone, tap
**Scan QR code** and point the camera at it. The phone then shows the server host. Tap
**Pair this device**.

The QR code holds `nfcterminal://pair?v=1&server=…&code=nfcp_…&name=…`. The code works once,
expires after 10 minutes and is never stored. Scanning it with the system camera also opens
the app on the same confirmation screen (deep link).

Entering an API key manually still works as a fallback.

## Reading cards in the background

Android only hands NFC tags to apps while the screen is **on and unlocked**. No service can read
tags with the screen off, so the app covers the rest in two ways.

- **App open.** Reader mode starts automatically once the device is registered and NFC is on.
  It starts again when the app resumes and when NFC is switched back on. **Stop reader** pauses
  it until the app is next started.
- **App closed or in the background.** An `activity-alias` (`.NfcTagLauncher`) registers for
  `TECH_DISCOVERED` and `TAG_DISCOVERED`. The tech list is in `res/xml/nfc_tech_filter.xml`:
  NfcA, NfcB, NfcF, NfcV, IsoDep, MifareClassic, MifareUltralight and Ndef.
  - Tapping a card opens or brings up the app.
  - The tag goes through the same read → debounce → deliver pipeline as reader mode, and the
    retry queue is flushed.
  - The app shows a notification in the "Card reads" channel, then calls
    `moveTaskToBack(true)` so you return to the previous app. It gives up waiting after about
    8 s, and if delivery failed the event stays queued for retry.
  - If the app was already in front, it behaves normally and stays open.
- **Setting.** **Settings → "Read cards when app is closed"** is ON by default and enables or
  disables the alias.
  - The alias is disabled until the device is registered, and again on unregister or
    revocation.
  - Turning it on asks for notification permission on Android 13+. If you refuse, reading
    still works but you get no notification.
  - If another NFC app is installed, Android may ask which app to use. Choose nexTap and
    "Always".

## Personal digital card (Part 4)

On first launch the app asks how the phone will be used. It can be a **Personal digital card**,
a **Terminal**, or both. The bottom navigation shows the spaces that are set up:
My Card + Contacts, Reader + History, and Settings.

- **Sign in.** Use email and password, create an account, or scan the web's "Sign in on your
  phone" QR code (`nfcterminal://login?...`). The QR works in the in-app scanner and from the
  system camera through a deep link.
  - The session token (`nfcs_…`), the share key and a card cache are kept in secure storage.
  - The login code is never stored.
  - Sign-out revokes the session, wipes everything and disables card emulation.
- **Share (phone as a card).** `CardHostApduService` (HCE, category `other`) answers two AIDs.
  - `F04E4643444301` returns `NFCDC` followed by a fresh 41-byte signed token.
  - `D2760000850101` emulates an NFC Forum Type 4 Tag with the public page URL
    (`…/p/{slug}?via=nfc`), so iPhones get the web card.
  - The service reads an AES-GCM cache encrypted with an Android Keystore key, written by the
    app. It works with the app closed while the phone is unlocked.
  - The service component is only enabled while signed in and sharing.
  - While this app is scanning, Android suspends card emulation. The UI therefore separates
    **Share my card** from **Scan a card**. With both spaces set up, terminal reader mode only
    runs on the Reader tab.
- **Scan.** The app sends the SELECT (150 ms) to the other device. If it answers with a token,
  the app calls `POST /personal/exchanges` and shows their card with "mutual ✓".
  - If NFC isn't available, use the exchange QR `nfcterminal://card?v=1&t=…`. The phone
    generates it itself, offline, with the same token generator.
  - The public-link QR is also available.
- **Edit.** A live preview updates as you edit. You can change:
  - the template (9, rendered with the web's six layouts: `centered`, `left`, `split`,
    `hero_photo`, `banner`, `compact`), colours (presets, HSV or hex), background style,
    pattern, font, corner radius and the QR toggle;
  - the photo, cover and logo (camera or gallery with crop);
  - the fields, with add/remove rows;
  - per-field visibility and share settings.

  Fields locked by a business are read-only.
- **Contacts** (search, tags, favourites, notes, save to phone via a vCard intent, share),
  **Activity** and **Business invites** (accept or decline).
- **Terminals.** Every reader path (reader mode and background tag dispatch) tries the
  digital-card SELECT first on IsoDep tags. A phone sharing a card is sent as
  `card_type: digital_card`, `card_id` = share_id hex, plus `digital_card_token`. Everything
  else follows the unchanged UID flow.

Token format: see `docs/PART4_CONTRACT.md` §3. Dart (`lib/core/digital_card_token.dart`) and
Kotlin (`DigitalCardToken.kt`) are both tested against the contract's vectors. Kotlin tests:
`cd android && ./gradlew :app:testDebugUnitTest`.

## Tapping a card without signing in (guest tap)

When the phone is **not** a registered terminal (fresh install, setup, signed out, personal-only),
the welcome and setup screens keep NFC reading on ("Tap a card"). A tapped tag's NDEF message is read:

- a nexTap tap link (`http(s)://<host>/t/{code}`, code 8–16 URL-safe characters) or a digital-card
  page (`/p/{slug}`, what phones sharing a card expose) on this phone's server (or the build's
  `API_BASE_URL`) opens straight away in the browser — the server resolves the card's action;
- the same links on another host show the host and need a tap on **Open**;
- any other link is shown with an **Open** button (never opened automatically);
- a tag without a link shows "This card isn't set up yet" and its UID.

In My Card → **Scan a card**, a tag that is not a phone sharing a digital card gets the same handling.
Registered terminals are unchanged: every tap is an event.

**App closed:** the tag-dispatch alias (`.NfcTagLauncher`) is only enabled on registered terminals
with background reading on. Otherwise it stays disabled, so Android's own NDEF dispatch opens a
programmed card's link in the browser (or offers a chooser) without the app.

## Registering cards (business devices)

With the `cards.register` capability, Reader → **Register cards** (also "Register this card" on an
unknown-card result) starts a continuous flow: tap a card → name (prefilled "Card N" / "Tag N"),
card/tag, owner (company or unassigned) and an optional note → registered → tap the next one.
Kind and owner are remembered between taps. Already registered cards show their name instead.
With `cards.program`, **Also write the tap link to each card** writes the link right after
registering (only to that same card). Taps are not sent as events while this screen is open.

## Business devices (Part 2)

When the device config says `account_type: "business"`, the app changes in these ways:

- **Branding.** The business logo and name replace "Reader" in the app bar. Settings shows the
  business, the assigned employee and what this device is allowed to do.
- **Read results.** After each read, the platform's `business` result is shown as a card
  (it is also in History and in background-read notifications):
  - recognized is green, inactive is amber and unknown is neutral;
  - the card shows the card name and kind, the assignee (name, position and photo when there is
    one) and the platform's message, e.g. "John Doe · Sales Manager";
  - an **Open** button appears for `action.url`, but only for `http(s)`, `tel:` and `mailto:`
    links (this includes `wa.me`);
  - the status `logged` counts as a success.
- **Register this card.** For an unknown card, when the device has `cards.register`, this
  button opens a sheet asking for a name and whether it is a card or a tag. It then calls
  `POST /device/business/cards`. A `409 card_uid_exists` answer is explained in the sheet.
- **Program a card.** This screen is on the Reader app bar, only when the device has
  `cards.program`.
  1. Search the business cards; by default only unprogrammed ones are listed.
  2. Pick one and hold the physical card to the phone.
  3. The app writes an NDEF URI record containing the card's `tap_url`. It never makes the
     card read-only.
  4. It then calls `POST …/programmed`.

  Reading is paused while programming, so the tap used to write the card is not also sent as
  an event.

  The app does **not** write Wi-Fi records: the device card list only includes `tap_url`, not
  the action's configuration, and the Wi-Fi page behind `tap_url` already covers this.

Developer devices work exactly as before. The only visible changes are the theme and the error
references.

## Error references

When an API call fails, the app shows the message, the server's `ref` (e.g. `NFC-1003`) and the
`request_id`. Tapping this reference line copies it. Failures on the phone use `MOB-*` refs, listed
in [`ERROR_CODES.md`](ERROR_CODES.md) (source: `lib/core/error_catalog.dart`).

## How it works

| Screen | What it does |
|---|---|
| Setup | Server URL (with a warning for http), API key (hidden, with a paste button), device name |
| Reader | Big status indicator: Ready / Reading / Sending / Delivered / Failed / NFC off / Offline. Start or stop reader mode, last card (UID, technologies, type guess) and the connection panel |
| History | Local log of the last 1000 events. Filter by status, open details, retry now, clear |
| Settings | Device and connection info, re-sync config, security note, unregister |

- **Reader mode.** Android reader mode polls NfcA/NfcB/NfcF/NfcV (IsoDep and MIFARE are
  found through A/B) and skips NDEF, so no other app opens when a card is tapped. The same
  UID is ignored for 1.5 s. The phone vibrates on each read, and the screen stays on while
  the reader is active.
- **Card type.** This is a best-effort guess from Android techs and the SAK byte, plus
  GET_VERSION on Type 2 tags: `mifare_classic`, `mifare_ultralight`, `ntag`, `iso_dep`,
  `felica`, `iso15693`, `unknown`. `unknown` is sent as `null`.
- **Relay mode** (default). The app sends `POST /device/events` with an `event_id` generated
  on the phone. The platform signs the event, delivers it and retries server-side. When the
  platform answers `retrying`, the phone does **not** retry too.
- **Direct mode.** The app builds the section-4 payload and signs the exact body bytes with
  `v1=HMAC_SHA256(signing_secret, "{timestamp}.{nonce}.{body}")`. It posts the payload to
  the endpoint with every `X-NFC-*` header and `User-Agent: nexTap-Terminal/1.0`, and
  does not follow redirects. It then reports the outcome to `POST /device/events`
  (`direct_delivery`). Each attempt gets a fresh timestamp and nonce but keeps the same
  `event_id`.
- **Domain allowlist.** The config's `allowed_domains` is enforced in direct mode. A host
  that doesn't match (exact, or `*.x.com` for subdomains but not the apex) is never contacted.
  The attempt is reported as failed with `domain_not_allowed` and is not retried.
- **Retry queue** (sqflite). Network errors, timeouts, 408, 429 and 5xx are retried after
  5 s, 30 s, 2 min, then every 10 min, up to `max_retries` from the config. The queue also
  runs when the network comes back, when the app resumes, and on **Retry now**. While the
  phone is offline, events wait without using up attempts.
- **Config and heartbeat.** The app fetches `GET /device/config` at start, every 5 min, on
  resume and on pull-to-refresh. It sends `POST /device/heartbeat` every 60 s while in the
  foreground. The direct-mode signing secret lives only in memory and in secure storage.
- **Logs.** Logging is debug-only (`kDebugMode`) and passes through a redactor that masks
  `nfc_`, `nfcd_` and `whsec_` tokens, Bearer headers, signatures and 64-hex secrets.

## Project layout

```
lib/
  main.dart, app.dart
  core/      config, secure_store (CredentialStore), logger (redaction), http_client (no-redirect send, URL validation), time_utils
  data/      api_client.dart (DeviceApi interface + HTTP impl), event_repository.dart (sqflite), models/
  services/  nfc_service.dart (NfcService interface + nfc_manager 4.x impl), delivery_service.dart,
             signing.dart, retry_queue.dart (RetryPolicy + RetryQueue), config_sync.dart,
             app_state.dart (session), reader_controller.dart, platform_info.dart
  ui/        screens/, widgets/, theme.dart (Material 3, light/dark)
android/app/src/main/kotlin/.../MainActivity.kt   MethodChannel to open the system NFC settings
```

## Tests

```bash
flutter analyze
flutter test
```

The tests cover:

- A known HMAC signing vector and the device-key derivation formula
- UID normalisation and formatting, and card-type guessing
- Exact payload and header fields, and direct signing over the exact body bytes
- Retry backoff and retryable status codes
- Relay and direct delivery outcomes, including redirects not being followed and the
  pending-report path
- Offline queueing
- API client error-envelope parsing and `device_revoked` handling (using `MockClient`)
- The revoke flow wiping credentials
- The sqflite repository (via `sqflite_common_ffi`)
- Debounce and the reader flow
- A widget test for the setup screen
