import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

/// Request signing for direct delivery (contract section 4).
///
/// `X-NFC-Signature: v1=<hex HMAC_SHA256(secret, "{timestamp}.{nonce}.{raw_body}")>`
class Signer {
  Signer._();

  /// Signs the exact [bodyBytes] that will be sent.
  static String sign({
    required String secret,
    required String timestamp,
    required String nonce,
    required List<int> bodyBytes,
  }) {
    final message = <int>[
      ...utf8.encode('$timestamp.$nonce.'),
      ...bodyBytes,
    ];
    final mac = Hmac(sha256, utf8.encode(secret)).convert(message);
    return 'v1=$mac';
  }

  /// `hex(HMAC_SHA256(key=webhook_secret, msg="device:" + device_id))`.
  ///
  /// The phone normally receives this already derived (`signing_secret`);
  /// it is here to document and test the formula developers must use.
  static String deriveDeviceKey({required String webhookSecret, required String deviceId}) =>
      Hmac(sha256, utf8.encode(webhookSecret)).convert(utf8.encode('device:$deviceId')).toString();

  static final Random _random = Random.secure();

  /// 32 lowercase hex chars (16 random bytes), fresh per attempt.
  static String nonce([Random? random]) {
    final r = random ?? _random;
    return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
}
