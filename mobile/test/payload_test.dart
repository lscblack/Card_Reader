import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/signing.dart';

import 'fakes.dart';

void main() {
  test('endpoint payload has exactly the contract section 4 fields', () {
    final p = buildEndpointPayload(
      event: testEvent(),
      config: testConfig(mode: DeliveryMode.direct),
      mode: DeliveryMode.direct,
    );
    expect(p, {
      'event_id': '7f1c2d3e-0000-4000-8000-000000000001',
      'event': 'card.detected',
      'card_id': '04A1B2C3D4E5',
      'card': {
        'uid': '04A1B2C3D4E5',
        'uid_length': 6,
        'technologies': ['NfcA', 'MifareUltralight'],
        'type': 'mifare_ultralight',
      },
      'security': {'authenticated': false, 'level': 'uid_only'},
      'device_id': '3b241101-e2bb-4255-8caf-4136c566a962',
      'application_id': 'a1b2c3d4-0000-4000-8000-000000000000',
      'delivery_mode': 'direct',
      'test': false,
      'timestamp': '2026-09-25T08:30:21Z',
    });
  });

  test('signed direct request: headers, UA and signature over the exact body bytes', () {
    final now = DateTime.utc(2026, 9, 25, 8, 30, 30);
    final req = buildSignedDirectRequest(
      event: testEvent(),
      config: testConfig(
        mode: DeliveryMode.direct,
        customHeaders: {'X-Tenant': 'gym-1', 'User-Agent': 'evil', 'X-NFC-Signature': 'forged'},
      ),
      secret: 'a' * 64,
      now: now,
      nonce: '00112233445566778899aabbccddeeff',
    );
    final h = req.headers;
    expect(req.url.toString(), 'https://example.com/api/nfc/card');
    expect(h['Content-Type'], 'application/json');
    expect(h['User-Agent'], 'NFCPlatform-Terminal/1.0');
    expect(h['X-NFC-Event-Id'], '7f1c2d3e-0000-4000-8000-000000000001');
    expect(h['X-NFC-Timestamp'], '${now.millisecondsSinceEpoch ~/ 1000}');
    expect(h['X-NFC-Nonce'], '00112233445566778899aabbccddeeff');
    expect(h['X-NFC-Device-Id'], '3b241101-e2bb-4255-8caf-4136c566a962');
    expect(h['X-NFC-Delivery-Mode'], 'direct');
    expect(h['X-Tenant'], 'gym-1');
    expect(h.containsValue('evil'), isFalse);
    expect(h.containsValue('forged'), isFalse);
    expect(
      h['X-NFC-Signature'],
      Signer.sign(secret: 'a' * 64, timestamp: h['X-NFC-Timestamp']!, nonce: h['X-NFC-Nonce']!, bodyBytes: req.bodyBytes),
    );
    final decoded = jsonDecode(utf8.decode(req.bodyBytes)) as Map;
    expect(decoded['delivery_mode'], 'direct');
  });

  test('device event submission uses contract field names', () {
    const s = EventSubmission(
      eventId: 'e1',
      cardId: '04A1B2C3',
      technologies: ['NfcA'],
      cardType: null,
      detectedAt: '2026-09-25T08:30:21Z',
      directDelivery: DirectDeliveryReport(success: true, statusCode: 200, latencyMs: 80, error: null, attempt: 1),
    );
    expect(s.toJson(), {
      'event_id': 'e1',
      'card_id': '04A1B2C3',
      'card_technologies': ['NfcA'],
      'card_type': null,
      'detected_at': '2026-09-25T08:30:21Z',
      'direct_delivery': {'success': true, 'status_code': 200, 'latency_ms': 80, 'error': null, 'attempt': 1},
    });
    const relay = EventSubmission(
      eventId: 'e1', cardId: '04A1B2C3', technologies: [], cardType: 'iso_dep', detectedAt: 'x');
    expect(relay.toJson()['direct_delivery'], isNull);
    expect(relay.toJson().containsKey('direct_delivery'), isTrue);
  });

  test('config cache never contains the signing secret', () {
    final cfg = testConfig(mode: DeliveryMode.direct, secret: 'b' * 64);
    expect(cfg.toCacheJson(), isNot(contains('b' * 64)));
    expect(cfg.toString(), isNot(contains('b' * 64)));
    final back = DeviceConfig.fromJson(jsonDecode(cfg.toCacheJson()) as Map<String, dynamic>);
    expect(back.signingSecret, isNull);
    expect(back.deliveryMode, DeliveryMode.direct);
    expect(back.applicationName, 'Gym');
  });
}
