# nfc_manager 4.2.1 (vendored)

Upstream: https://github.com/okadan/flutter-nfc-manager (MIT, see LICENSE). Copied from pub.dev 4.2.1
without `example/`, and used through `dependency_overrides` in `mobile/pubspec.yaml`.

Only `ios/nfc_manager/Sources/nfc_manager/NfcManagerPlugin.swift` is changed (search for "nexTap patch"):

1. `tagReaderSession(_:didInvalidateWithError:)` forwards the error only for the current session, then
   releases it. Upstream kept a session that iOS ended itself (timeout, Cancel), so the next
   `tagSessionBegin` threw `session_already_exists`; and a late invalidation of an old session could
   reach the callbacks of the next one.
2. `tagReaderSession(_:didDetect:)` restarts polling whenever a tag fails to connect or read. Upstream
   did that only with `invalidateAfterFirstRead: false`, so with `true` a quick or unreadable tap froze
   the scan sheet until its 60 s timeout.

The app always passes `invalidateAfterFirstReadIos: true` and restarts polling itself once it has
finished talking to a tag (`IosScanSheet.nextTag`), so it can still send commands to the tag
(digital-card SELECT, GET_VERSION, NDEF write) before polling moves on.

To upgrade: copy the new release here, re-apply both patches, and check the Android side is unchanged.
