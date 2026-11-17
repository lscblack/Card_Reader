import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/data/models/endpoint_reply.dart';
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
    expect(h['User-Agent'], 'nexTap-Terminal/1.0');
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

  group('signed body: ids, location opt-in, nonce', () {
    final now = DateTime.utc(2026, 9, 25, 8, 30, 30);
    final withFix = testEvent().copyWith(locationJson: () => jsonEncode({'lat': -1.95, 'lng': 30.06, 'accuracy_m': 12.5}));

    test('every body carries the phone device_id and the tap id, signed, and the headers agree with the body', () {
      final cfg = testConfig(mode: DeliveryMode.direct, secret: 'a' * 64);
      final req = buildSignedDirectRequest(event: testEvent(), config: cfg, secret: 'a' * 64, now: now, nonce: 'n1');
      final body = jsonDecode(utf8.decode(req.bodyBytes)) as Map<String, dynamic>;
      expect(body['device_id'], cfg.deviceId);
      expect(body['event_id'], testEvent().eventId);
      expect(req.headers['X-NFC-Device-Id'], body['device_id']);
      expect(req.headers['X-NFC-Event-Id'], body['event_id']);
      expect(
        req.headers['X-NFC-Signature'],
        Signer.sign(secret: 'a' * 64, timestamp: req.headers['X-NFC-Timestamp']!, nonce: 'n1', bodyBytes: req.bodyBytes),
      );
    });

    test('a location is in the body only when the application has sharing on', () {
      final on = testConfig(mode: DeliveryMode.direct, shareLocation: true);
      final off = testConfig(mode: DeliveryMode.direct);
      expect(buildEndpointPayload(event: withFix, config: on, mode: DeliveryMode.direct)['location'],
          {'lat': -1.95, 'lng': 30.06, 'accuracy_m': 12.5});
      expect(buildEndpointPayload(event: withFix, config: off, mode: DeliveryMode.direct).containsKey('location'), isFalse);
      expect(buildEndpointPayload(event: testEvent(), config: on, mode: DeliveryMode.direct).containsKey('location'), isFalse);
    });

    test('a location.update has its own id, the device id, and is signed like a tap', () {
      final cfg = testConfig(mode: DeliveryMode.direct, secret: 'b' * 64, shareLocation: true);
      final payload = buildLocationPayload(id: 'ping-1', config: cfg, fix: const GeoFix(lat: 1, lng: 2), now: now);
      final req = signDirectRequest(payload: payload, eventId: 'ping-1', config: cfg, secret: 'b' * 64, now: now, nonce: 'n2');
      final body = jsonDecode(utf8.decode(req.bodyBytes)) as Map<String, dynamic>;
      expect(body['event'], 'location.update');
      expect(body['event_id'], 'ping-1');
      expect(body['device_id'], cfg.deviceId);
      expect(body['location'], {'lat': 1.0, 'lng': 2.0});
      expect(req.headers['X-NFC-Event-Id'], 'ping-1');
      expect(req.headers['X-NFC-Device-Id'], cfg.deviceId);
    });

  });

  test('endpoint reply parsing: tones, clipping and junk', () {
    final r = EndpointReply.fromBody('{"display":{"title":"Checked out","message":"Ann, 8 h","tone":"SUCCESS"},'
        '"action_url":"https://a.example/x","session_open":true}')!;
    expect(r.tone, ReplyTone.success);
    expect(r.title, 'Checked out');
    expect(r.actionUrl, 'https://a.example/x');
    expect(r.sessionOpen, isTrue);
    expect(EndpointReply.fromBody('{"display":{"title":"x","tone":"purple"}}')!.tone, ReplyTone.neutral);
    expect(EndpointReply.fromBody('{"ok":true}'), isNull);
    expect(EndpointReply.fromBody('not json'), isNull);
    expect(EndpointReply.fromBody('[1]'), isNull);
    expect(EndpointReply.fromBody('{"display":{"title":"${'x' * 500}"}}')!.title!.length, EndpointReply.titleMax);
  });
}
