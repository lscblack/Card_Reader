import 'dart:convert';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/services/signing.dart';

void main() {
  group('Signer', () {
    test('matches a known HMAC-SHA256 vector over "{timestamp}.{nonce}.{raw_body}"', () {
      // Reference computed independently with Python's hmac module.
      final body = utf8.encode('{"event_id":"7f1c2d3e-0000-4000-8000-000000000001","card_id":"04A1B2C3D4E5"}');
      final sig = Signer.sign(
        secret: '0f3a' * 16,
        timestamp: '1758789021',
        nonce: '00112233445566778899aabbccddeeff',
        bodyBytes: body,
      );
      expect(sig, 'v1=1ed2132c3614cb63c88315b76c83e35ec05b8b4d5bdc63d8d291171b4f30e7e1');
    });

    test('any change to body, timestamp or nonce changes the signature', () {
      String s(String ts, String nonce, String body) =>
          Signer.sign(secret: 'k', timestamp: ts, nonce: nonce, bodyBytes: utf8.encode(body));
      final base = s('1', 'n', '{}');
      expect(s('2', 'n', '{}'), isNot(base));
      expect(s('1', 'm', '{}'), isNot(base));
      expect(s('1', 'n', '{ }'), isNot(base));
    });

    test('device key derivation = hex(HMAC_SHA256(webhook_secret, "device:"+device_id))', () {
      expect(
        Signer.deriveDeviceKey(
          webhookSecret: 'whsec_test_secret_0123456789abcdefghijklmnopq',
          deviceId: '3b241101-e2bb-4255-8caf-4136c566a962',
        ),
        '7798afb07c9b8344f752644a7c8562f6e24c8cdf685fc2019c0ef374627d307d',
      );
    });

    test('end-to-end: derived signing_secret is used as a UTF-8 string key, not hex-decoded', () {
      final secret = Signer.deriveDeviceKey(
        webhookSecret: 'whsec_test_secret_0123456789abcdefghijklmnopq',
        deviceId: '3b241101-e2bb-4255-8caf-4136c566a962',
      );
      final sig = Signer.sign(
        secret: secret,
        timestamp: '1758789021',
        nonce: '00112233445566778899aabbccddeeff',
        bodyBytes: utf8.encode('{"card_id":"04A1B2C3D4E5"}'),
      );
      // Python: hmac.new(secret.encode(), ...) -- the hex-decoded key would give 58efcc05...
      expect(sig, 'v1=6283dc4f726bcc9d79b7b183299d55bd9191b046a817f598eb7897911aa9d673');
      expect(sig, isNot(contains('58efcc05')));
    });

    test('nonce is 32 lowercase hex chars and random', () {
      final a = Signer.nonce();
      final b = Signer.nonce();
      expect(a, matches(RegExp(r'^[0-9a-f]{32}$')));
      expect(a, isNot(b));
      expect(Signer.nonce(Random(1)), Signer.nonce(Random(1)));
    });
  });
}
