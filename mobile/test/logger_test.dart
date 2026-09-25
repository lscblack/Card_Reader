import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/core/logger.dart';

void main() {
  test('redacts tokens, keys, secrets, bearer headers and signatures', () {
    final input = [
      'key nfc_AbCdEf123_-xyz',
      'token nfcd_ZZZ999',
      'secret whsec_abc-def',
      'pair nfcp_PairCode123',
      'Authorization: Bearer eyJhbGciOi.x.y',
      'X-NFC-Signature: v1=${'ab' * 32}',
      'derived ${'0f' * 32}',
      '{"signing_secret": "s3cr3t", "device_token":"t0k"}',
    ].join(' | ');
    final out = Log.redact(input);
    for (final leak in ['PairCode123', 'AbCdEf123', 'ZZZ999', 'abc-def', 'eyJhbGciOi', 'ab' * 32, '0f' * 32, 's3cr3t', 't0k']) {
      expect(out, isNot(contains(leak)), reason: leak);
    }
    expect(out, contains('nfc_[REDACTED]'));
    expect(out, contains('nfcd_[REDACTED]'));
    expect(out, contains('whsec_[REDACTED]'));
  });

  test('leaves ordinary text alone', () {
    expect(Log.redact('GET /device/config -> 200'), 'GET /device/config -> 200');
    expect(Log.redact('card 04A1B2C3D4E5'), 'card 04A1B2C3D4E5');
  });
}
