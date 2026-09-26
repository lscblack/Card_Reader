import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/background_reading.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/reader_controller.dart';
import 'package:nfc_terminal/services/tag_dispatch.dart';

import 'fakes.dart';

const token = 'ATskEQHiu0JVjK9BNsVmqWIAAAAHarE7gM90i8kUJX1pX0lTwqQ5wgU';
const shareHex = '3B241101E2BB42558CAF4136C566A962';

void main() {
  test('dispatched phone with digital card → digital read; plain card → unchanged UID flow', () {
    final digital = DispatchedTag.fromMap({
      'uid': '08A1B2C3', 'techList': ['android.nfc.tech.IsoDep', 'android.nfc.tech.NfcA'],
      'digitalCardToken': token, 'fromBackground': false,
    }).toCardRead()!;
    expect(digital.isDigitalCard, isTrue);
    expect(digital.uid, shareHex);
    expect(digital.type, CardType.digitalCard);

    // Regression: IsoDep card that didn't answer the SELECT keeps its UID and type.
    final plain = DispatchedTag.fromMap({
      'uid': '04a1b2c3d4e5f6', 'techList': ['android.nfc.tech.IsoDep', 'android.nfc.tech.NfcA'], 'sak': 0x20,
    }).toCardRead()!;
    expect(plain.isDigitalCard, isFalse);
    expect(plain.uid, '04A1B2C3D4E5F6');
    expect(plain.type, CardType.isoDep);

    // Corrupt token → falls back to the UID.
    final bad = DispatchedTag.fromMap({'uid': '04A1B2C3', 'techList': ['android.nfc.tech.IsoDep'], 'digitalCardToken': 'xx'}).toCardRead()!;
    expect(bad.uid, '04A1B2C3');
  });

  group('terminal delivery of a digital card', () {
    late InMemoryEventRepository repo;
    late FakeDeviceApi api;
    late ReaderController reader;

    setUp(() async {
      repo = InMemoryEventRepository();
      api = FakeDeviceApi();
    });

    Future<EventRecord?> read(DeviceConfig cfg, CardRead card, {http.Client? endpoint}) async {
      final delivery = DeliveryService(
        api: api, httpClient: endpoint ?? MockClient((_) async => http.Response('', 200)), repository: repo);
      reader = ReaderController(
        nfc: FakeNfcService(), repository: repo, platform: FakePlatformInfo(),
        deliveryProvider: () => delivery, configProvider: () => cfg, haptic: () async {});
      await reader.init(autoStart: false);
      return reader.handleCard(card);
    }

    test('relay: token + share_id hex + card_type digital_card; result card stored', () async {
      api.onSubmit = (s) async => EventSubmitResult.fromJson({
        'event_id': s.eventId, 'status': 'delivered', 'status_code': 200, 'latency_ms': 40, 'error': null,
        'digital_card': {
          'id': '3b241101-e2bb-4255-8caf-4136c566a962', 'verified': true, 'full_name': 'Jane Doe',
          'headline': 'Designer', 'company': 'Acme', 'public_url': 'https://w/p/jane',
        },
      });
      final card = digitalCardRead(token, const ['IsoDep', 'NfcA'], DateTime.now().toUtc())!;
      final r = (await read(testConfig(), card))!;
      final body = api.submissions.single.toJson();
      expect(body['digital_card_token'], token);
      expect(body['card_id'], shareHex);
      expect(body['card_type'], 'digital_card');
      expect(r.status, EventStatus.delivered);
      expect(r.digitalCard!.fullName, 'Jane Doe');
      expect(r.digitalCard!.verified, isTrue);
      expect(backgroundResultText(shareHex, r).title, 'Jane Doe ✓');
      reader.dispose();
    });

    test('UID events keep the Part 1 body (no digital_card_token key)', () async {
      await read(testConfig(), CardRead(uid: '04A1B2C3', technologies: const ['NfcA'], type: 'mifare_classic', detectedAt: DateTime.now().toUtc()));
      expect(api.submissions.single.toJson().containsKey('digital_card_token'), isFalse);
      reader.dispose();
    });

    test('invalid token response: stored with verified=false and error ref', () async {
      api.onSubmit = (s) async => EventSubmitResult.fromJson({
        'event_id': s.eventId, 'status': 'delivered', 'error_code': 'invalid_card_token', 'error_ref': 'NFC-4101',
        'digital_card': {'id': 'x', 'verified': false},
      });
      final r = (await read(testConfig(), digitalCardRead(token, const ['IsoDep'], DateTime.now().toUtc())!))!;
      expect(r.digitalCard!.verified, isFalse);
      expect(r.errorRef, 'NFC-4101');
      reader.dispose();
    });

    test('direct mode payload: card.type digital_card, uid_only level (unverified), digital_card block', () async {
      late Map<String, dynamic> sent;
      final endpoint = MockClient((req) async {
        sent = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response('', 200);
      });
      await read(testConfig(mode: DeliveryMode.direct, secret: 'a' * 64),
          digitalCardRead(token, const ['IsoDep'], DateTime.now().toUtc())!, endpoint: endpoint);
      expect(sent['card_id'], shareHex);
      expect(sent['card']['type'], 'digital_card');
      expect(sent['security'], {'authenticated': false, 'level': 'uid_only'});
      expect(sent['digital_card'], {'id': '3b241101-e2bb-4255-8caf-4136c566a962', 'token': token, 'verified': false});
      reader.dispose();
    });
  });
}
