/// Local catalog of mobile-side failures (`MOB-*` refs, Part 2 A1).
///
/// Mirrored by the backend's `GET /errors` (source: "mobile") and documented
/// in `mobile/ERROR_CODES.md`. Refs are stable: never renumber.
class MobError {
  const MobError(this.ref, this.code, this.title, this.description, this.fix);

  final String ref;
  final String code;
  final String title;
  final String description;
  final String fix;

  static const nfcUnsupported = MobError('MOB-1001', 'nfc_unsupported', 'NFC not supported',
      'This phone has no NFC hardware.', 'Use an NFC-capable Android phone.');
  static const nfcDisabled = MobError('MOB-1002', 'nfc_disabled', 'NFC is turned off',
      'NFC is disabled in the system settings.', 'Turn on NFC in Settings → Connections.');
  static const tagLost = MobError('MOB-1003', 'tag_lost', 'Card moved away',
      'The card left the NFC field before the operation finished.', 'Hold the card still against the phone and retry.');
  static const uidUnavailable = MobError('MOB-1004', 'uid_unavailable', 'No usable card ID',
      'The card returned an empty or invalid UID.', 'Try again; some cards/phones use random UIDs that cannot be used.');
  static const offline = MobError('MOB-1005', 'offline', 'Phone is offline',
      'No network connection. The event is queued and sent when the network is back.', 'Check Wi-Fi or mobile data.');
  static const serverUnreachable = MobError('MOB-1006', 'server_unreachable', 'Server unreachable',
      'The platform server could not be reached (DNS, refused connection, network).',
      'Check the server URL and that the phone can reach it.');
  static const tlsError = MobError('MOB-1007', 'tls_error', 'Secure connection failed',
      'The TLS handshake failed (invalid or untrusted certificate).', 'Use a valid HTTPS certificate on the server/endpoint.');
  static const timeout = MobError('MOB-1008', 'timeout', 'Request timed out',
      'The server or endpoint did not answer in time.', 'Retry; check server load or the endpoint timeout.');
  static const signingFailed = MobError('MOB-1009', 'signing_failed', 'Cannot sign direct delivery',
      'Direct mode needs a signing secret, but the device config has none.',
      'Re-sync the configuration (Settings → Re-sync); check the application is in direct mode.');
  static const domainNotAllowed = MobError('MOB-1010', 'domain_not_allowed', 'Endpoint domain not allowed',
      'Direct mode: the endpoint host is not in the application\'s allowed domains, so it was not contacted.',
      'Add the host to the allowlist or change the endpoint URL in the dashboard.');
  static const cameraDenied = MobError('MOB-1011', 'camera_permission_denied', 'Camera permission denied',
      'The QR scanner needs camera access.', 'Allow camera access in app settings, or enter an API key manually.');
  static const invalidQr = MobError('MOB-1012', 'invalid_qr', 'Invalid pairing QR code',
      'The scanned QR code is not a valid nexTap pairing code.', 'Generate a new pairing code in the dashboard.');
  static const ndefWriteFailed = MobError('MOB-1013', 'ndef_write_failed', 'Writing the card failed',
      'The NDEF write was rejected by the card.', 'Retry holding the card still; try another card.');
  static const tagReadOnly = MobError('MOB-1014', 'tag_read_only', 'Card is read-only',
      'The card is locked and cannot be written.', 'Use a new, writable card.');
  static const tagTooSmall = MobError('MOB-1015', 'tag_too_small', 'Card memory too small',
      'The link does not fit in the card\'s NDEF memory.', 'Use a card with more memory (e.g. NTAG215/216).');
  static const notificationsDenied = MobError('MOB-1016', 'notification_permission_denied',
      'Notifications not allowed', 'Background reads work, but their result cannot be shown as a notification.',
      'Allow notifications for nexTap in the system settings.');
  static const tagNotNdef = MobError('MOB-1017', 'tag_not_ndef', 'Card cannot store a link',
      'The card does not support NDEF and cannot be formatted for it (e.g. MIFARE Classic on many phones).',
      'Use an NDEF-compatible card (NTAG21x, MIFARE Ultralight, DESFire).');
  static const invalidServerResponse = MobError('MOB-1018', 'invalid_server_response', 'Unexpected server response',
      'The server answered with data the app does not understand.', 'Update the app/server; contact support with the request id.');
  static const programmingTimeout = MobError('MOB-1019', 'programming_timeout', 'No card presented',
      'No card was held to the phone while programming.', 'Start again and hold the card to the back of the phone.');
  static const endpointUnreachable = MobError('MOB-1020', 'endpoint_unreachable', 'Endpoint unreachable',
      'Direct mode: the developer endpoint could not be reached.', 'Check the endpoint URL/host is reachable from the phone.');
  static const endpointNotConfigured = MobError('MOB-1021', 'endpoint_not_configured', 'Endpoint not configured',
      'Direct mode: the application has no enabled endpoint.', 'Set and enable the endpoint in the dashboard.');

  static const notADigitalCard = MobError('MOB-1022', 'not_a_digital_card', 'Not a digital card',
      'The tapped phone or card does not share an nexTap digital card.',
      'Ask the other person to open My Card → Share, or scan their exchange QR code.');
  static const hceUnsupported = MobError('MOB-1023', 'hce_unsupported', 'Phone can\'t share by NFC',
      'This phone does not support NFC card emulation (HCE), so it cannot act as a card.',
      'Share with the QR code or your public link instead.');
  static const sessionExpired = MobError('MOB-1024', 'session_expired', 'Signed out',
      'Your personal session was revoked or expired.', 'Sign in again.');
  static const invalidLoginQr = MobError('MOB-1025', 'invalid_login_qr', 'Invalid sign-in QR code',
      'The QR code is not a valid "Sign in on your phone" code.', 'Create a new code on the web (Share → Sign in on your phone).');
  static const imagePickFailed = MobError('MOB-1026', 'image_pick_failed', 'Photo not available',
      'The photo could not be picked, cropped or read.', 'Allow photo/camera access and try again.');

  static const all = <MobError>[
    nfcUnsupported, nfcDisabled, tagLost, uidUnavailable, offline, serverUnreachable, tlsError, timeout,
    signingFailed, domainNotAllowed, cameraDenied, invalidQr, ndefWriteFailed, tagReadOnly, tagTooSmall,
    notificationsDenied, tagNotNdef, invalidServerResponse, programmingTimeout, endpointUnreachable,
    endpointNotConfigured, notADigitalCard, hceUnsupported, sessionExpired, invalidLoginQr, imagePickFailed,
  ];

  static MobError? byRef(String? ref) {
    for (final e in all) {
      if (e.ref == ref) return e;
    }
    return null;
  }
}
