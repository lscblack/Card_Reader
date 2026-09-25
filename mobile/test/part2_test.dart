import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/core/app_error.dart';
import 'package:nfc_terminal/core/error_catalog.dart';
import 'package:nfc_terminal/data/api_client.dart';
import 'package:nfc_terminal/data/event_repository.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/business.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/background_reading.dart';
import 'package:nfc_terminal/services/card_programmer.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/nfc_writer.dart';
import 'package:nfc_terminal/services/reader_controller.dart';
import 'package:nfc_terminal/ui/theme.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fakes.dart';

Map<String, dynamic> part1Config() => {
  'device_id': 'dev-1',
  'device_name': 'Pixel',
  'application': {'id': 'app-1', 'name': 'Gym'},
  'delivery_mode': 'relay',
  'endpoint_url': null,
  'endpoint_enabled': true,
  'timeout_seconds': 10,
  'max_retries': 3,
  'custom_headers': {},
  'signing_secret': null,
};

Map<String, dynamic> businessConfig({List<String> caps = const ['cards.register', 'cards.program']}) => {
  ...part1Config(),
  'account_type': 'business',
  'business': {'id': 'b1', 'name': 'Acme Café', 'slug': 'acme-cafe', 'logo_url': null},
  'assigned_employee': {'id': 'e1', 'name': 'John Doe'},
  'capabilities': caps,
};

const recognizedJson = {
  'result': 'recognized',
  'card': {'id': 'c1', 'name': 'John badge', 'kind': 'card', 'status': 'active', 'effective_status': 'active'},
  'assignee': {'type': 'employee', 'id': 'e1', 'name': 'John Doe', 'position': 'Sales Manager', 'photo_url': null},
  'action': {'type': 'employee_profile', 'label': 'Open profile', 'url': 'https://acme.example/b/acme/john'},
  'message': 'John Doe · Sales Manager',
};

const unknownJson = {'result': 'unknown_card', 'card': null, 'assignee': null, 'action': null, 'message': 'Unknown card'};

/// Scriptable writer; records whether the reader was paused during the write.
class FakeNfcWriter implements NfcWriter {
  FakeNfcWriter(this.onWrite);
  Future<String> Function(String uri) onWrite;
  final uris = <String>[];

  @override
  Future<String> writeUri(String uri, {Duration timeout = const Duration(seconds: 60)}) {
    uris.add(uri);
    return onWrite(uri);
  }

  @override
  Future<void> cancel() async {}
}

void main() {
  group('C1 config', () {
    test('Part 1 configs (no new fields) parse as developer, unchanged', () {
      final c = DeviceConfig.fromJson(part1Config());
      expect(c.accountType, 'developer');
      expect(c.isBusiness, isFalse);
      expect(c.business, isNull);
      expect(c.assignedEmployee, isNull);
      expect(c.capabilities, isEmpty);
      expect(c.can(Capability.registerCards), isFalse);
      expect(c.applicationName, 'Gym');
    });

    test('business config parses and survives the offline cache', () {
      final c = DeviceConfig.fromJson(businessConfig());
      expect(c.isBusiness, isTrue);
      expect(c.business!.name, 'Acme Café');
      expect(c.assignedEmployee!.name, 'John Doe');
      expect(c.can(Capability.programCards), isTrue);
      final back = DeviceConfig.fromJson(jsonDecode(c.toCacheJson()) as Map<String, dynamic>);
      expect(back.isBusiness, isTrue);
      expect(back.business!.slug, 'acme-cafe');
      expect(back.assignedEmployee!.id, 'e1');
      expect(back.capabilities, ['cards.register', 'cards.program']);
    });

    test('developer devices never get business capabilities even if listed', () {
      final c = DeviceConfig.fromJson({...part1Config(), 'capabilities': ['cards.program']});
      expect(c.can(Capability.programCards), isFalse);
    });
  });

  group('A1 error refs', () {
    test('parses ref, request_id and docs_url from the envelope', () {
      final e = ApiClient.parseError(401, jsonEncode({
        'error': {
          'code': 'invalid_device_token', 'message': 'Invalid', 'details': null,
          'ref': 'NFC-1003', 'request_id': '3f9c0a', 'docs_url': 'http://web/docs/errors#NFC-1003',
        },
      }), const {});
      expect(e.ref, 'NFC-1003');
      expect(e.requestId, '3f9c0a');
      expect(e.docsUrl, endsWith('#NFC-1003'));
      final a = AppError.api(e);
      expect(a.referenceLine, 'NFC-1003 · 3f9c0a');
    });

    test('Part 1 envelopes without refs still parse; X-Request-ID header fallback', () {
      final e = ApiClient.parseError(422, '{"error":{"code":"validation_error","message":"bad"}}',
          const {'x-request-id': 'req-9'});
      expect(e.ref, isNull);
      expect(e.requestId, 'req-9');
      expect(AppError.api(e).referenceLine, 'req-9');
      expect(const AppError('x').referenceLine, isNull);
    });

    test('network failures map to MOB refs', () async {
      Future<NetworkException> fail(Object error) async {
        final api = ApiClient(
          client: MockClient((_) async => throw error),
          baseUrl: 'https://api.example.com',
          deviceToken: 'nfcd_t',
        );
        try {
          await api.getConfig();
        } on NetworkException catch (e) {
          return e;
        }
        throw StateError('no exception');
      }

      expect((await fail(const SocketException('refused'))).ref, 'MOB-1006');
      expect((await fail(const HandshakeException('bad cert'))).ref, 'MOB-1007');
      expect((await fail(TimeoutException('slow'))).ref, 'MOB-1008');
    });

    test('MOB catalog: unique, well-formed refs incl. the required ones', () {
      final refs = MobError.all.map((e) => e.ref).toList();
      expect(refs.toSet().length, refs.length);
      expect(MobError.all.map((e) => e.code).toSet().length, refs.length);
      for (final r in refs) {
        expect(r, matches(RegExp(r'^MOB-1\d{3}$')));
      }
      for (var i = 1001; i <= 1016; i++) {
        expect(refs, contains('MOB-$i'));
      }
      expect(MobError.byRef('MOB-1014'), MobError.tagReadOnly);
    });
  });

  group('C2 business events', () {
    late InMemoryEventRepository repo;
    late FakeDeviceApi api;

    setUp(() {
      repo = InMemoryEventRepository();
      api = FakeDeviceApi();
    });

    DeliveryService svc({bool online = true}) => DeliveryService(
      api: api, httpClient: MockClient((_) async => http.Response('', 500)), repository: repo,
      isOnline: () => online);

    test('recognized result is stored with the event; "logged" status is a success', () async {
      api.onSubmit = (s) async => EventSubmitResult.fromJson({
        'event_id': s.eventId, 'status': 'logged', 'status_code': null, 'latency_ms': null, 'error': null,
        'business': recognizedJson,
      });
      final r = (await svc().deliver(testEvent(), DeviceConfig.fromJson(businessConfig())))!;
      expect(r.status, EventStatus.logged);
      expect(r.isSuccess, isTrue);
      expect(r.business!.isRecognized, isTrue);
      expect(r.business!.assigneePosition, 'Sales Manager');
      expect(repo.rows.values.single.business!.message, 'John Doe · Sales Manager');
    });

    test('developer response without business block → unchanged', () async {
      final r = (await svc().deliver(testEvent(), testConfig()))!;
      expect(r.status, EventStatus.delivered);
      expect(r.business, isNull);
    });

    test('failures carry refs: API ref + request id, offline MOB-1005, direct domain MOB-1010', () async {
      api.onSubmit = (_) async => throw const ApiException(
        statusCode: 422, code: 'validation_error', message: 'bad', ref: 'NFC-2001', requestId: 'rq1');
      final a = (await svc().deliver(testEvent(id: 'a'), testConfig()))!;
      expect(a.errorRef, 'NFC-2001');
      expect(a.requestId, 'rq1');

      final b = (await svc(online: false).deliver(testEvent(id: 'b'), testConfig()))!;
      expect(b.errorRef, 'MOB-1005');

      api.onSubmit = null;
      final c = (await svc().deliver(testEvent(id: 'c'), testConfig(
        mode: DeliveryMode.direct, secret: 'x' * 64, allowedDomains: const ['other.com'])))!;
      expect(c.errorRef, 'MOB-1010');
    });

    test('background notification uses the business message', () {
      final e = testEvent().copyWith(status: EventStatus.delivered, businessJson: () => jsonEncode(recognizedJson));
      expect(backgroundResultText('04A1', e).title, 'John Doe · Sales Manager ✓');
      final u = testEvent().copyWith(status: EventStatus.logged, businessJson: () => jsonEncode(unknownJson));
      expect(backgroundResultText('04A1', u).title, 'Unknown card 04:A1');
      final i = testEvent().copyWith(status: EventStatus.delivered, businessJson: () => jsonEncode({
        ...recognizedJson, 'result': 'inactive', 'message': 'John Doe'}));
      expect(backgroundResultText('04A1', i).title, 'John Doe — inactive');
    });

    test('only http(s)/tel/mailto action URLs can be opened', () {
      final cases = {
        'https://acme.example/x': true,
        'http://192.168.1.74:5173/b/acme': true,
        'https://wa.me/15551234567?text=hi': true,
        'tel:+15551234567': true,
        'mailto:a@b.co': true,
        'javascript:alert(1)': false,
        'intent://scan#Intent;end': false,
        'file:///sdcard/x': false,
        'market://details?id=x': false,
        '': false,
        null: false,
      };
      cases.forEach((url, ok) => expect(isOpenableActionUrl(url), ok, reason: '$url'));
    });
  });

  group('C3 NDEF', () {
    test('URI record uses the NFC Forum prefix codes', () {
      final r = uriRecord('https://api.example.com/t/AbC123xyZ9');
      expect(r.type, [0x55]);
      expect(r.payload.first, 0x04);
      expect(utf8.decode(r.payload.sublist(1)), 'api.example.com/t/AbC123xyZ9');
      expect(uriRecord('http://192.168.1.74:8000/t/x').payload.first, 0x03);
      expect(uriRecord('https://www.acme.com').payload.first, 0x02);
      expect(uriRecord('custom:x').payload.first, 0x00);
      expect(uriMessage('https://a.b/t/1').byteLength, greaterThan(5));
    });

    test('write plan: writable NDEF, formatable, read-only, too small, not NDEF', () {
      expect(planNdefWrite(hasNdef: true, isWritable: true, maxSize: 137, formatable: false, messageSize: 40),
          NdefWriteMethod.write);
      expect(planNdefWrite(hasNdef: false, isWritable: false, maxSize: 0, formatable: true, messageSize: 40),
          NdefWriteMethod.format);
      NfcWriteException err(void Function() f) {
        try {
          f();
        } on NfcWriteException catch (e) {
          return e;
        }
        throw StateError('expected failure');
      }

      expect(err(() => planNdefWrite(hasNdef: true, isWritable: false, maxSize: 137, formatable: false, messageSize: 40))
          .error.ref, 'MOB-1014');
      expect(err(() => planNdefWrite(hasNdef: true, isWritable: true, maxSize: 30, formatable: false, messageSize: 40))
          .error.ref, 'MOB-1015');
      expect(err(() => planNdefWrite(hasNdef: false, isWritable: false, maxSize: 0, formatable: false, messageSize: 40))
          .error.ref, 'MOB-1017');
    });

    test('native errors map to MOB codes', () {
      expect(mobErrorForPlatform(PlatformException(code: 'TagLostException')).ref, 'MOB-1003');
      expect(mobErrorForPlatform(PlatformException(code: 'FormatException')).ref, 'MOB-1017');
      expect(mobErrorForPlatform(PlatformException(code: 'IOException')).ref, 'MOB-1013');
    });
  });

  group('C3 programming', () {
    late FakeNfcService nfc;
    late InMemoryEventRepository repo;
    late FakeDeviceApi api;
    late ReaderController reader;
    const card = BusinessCardItem(
      id: 'c9', name: 'Table 4', kind: 'tag', tapUrl: 'https://api.example.com/t/AbC123xyZ9', programmed: false);

    setUp(() async {
      nfc = FakeNfcService();
      repo = InMemoryEventRepository();
      api = FakeDeviceApi();
      final delivery = DeliveryService(
        api: api, httpClient: MockClient((_) async => http.Response('', 200)), repository: repo);
      reader = ReaderController(
        nfc: nfc, repository: repo, platform: FakePlatformInfo(),
        deliveryProvider: () => delivery, configProvider: () => DeviceConfig.fromJson(businessConfig()),
        haptic: () async {});
      await reader.init();
    });

    tearDown(() => reader.dispose());

    test('success: reader paused during the write, tap not delivered, programmed reported, reader resumed', () async {
      late bool pausedDuringWrite;
      late bool readerModeOffDuringWrite;
      EventRecord? tapDuringWrite;
      final writer = FakeNfcWriter((uri) async {
        pausedDuringWrite = reader.programming;
        readerModeOffDuringWrite = nfc.onCard == null;
        // The same tap arriving via dispatch/reader must not become an event.
        tapDuringWrite = await reader.handleCard(CardRead(
          uid: '04AABBCCDDEE01', technologies: const ['NfcA'], type: 'ntag', detectedAt: DateTime.now().toUtc()));
        return '04AABBCCDDEE01';
      });
      final outcome = await CardProgrammer(writer: writer, api: api, reader: reader).program(card);
      expect(outcome.ok, isTrue);
      expect(outcome.uid, '04AABBCCDDEE01');
      expect(writer.uris.single, card.tapUrl);
      expect(pausedDuringWrite, isTrue);
      expect(readerModeOffDuringWrite, isTrue);
      expect(tapDuringWrite, isNull);
      expect(api.submissions, isEmpty);
      expect(api.programmed.single, {'id': 'c9', 'uid': '04AABBCCDDEE01'});
      expect(reader.programming, isFalse);
      expect(nfc.onCard, isNotNull, reason: 'reader mode re-armed');
    });

    for (final (mob, name) in [
      (MobError.tagReadOnly, 'read-only'),
      (MobError.tagTooSmall, 'too small'),
      (MobError.tagLost, 'tag lost'),
      (MobError.tagNotNdef, 'not NDEF'),
      (MobError.programmingTimeout, 'timeout'),
    ]) {
      test('write failure ($name) → ${mob.ref}, nothing reported, reader resumed', () async {
        final writer = FakeNfcWriter((_) async => throw NfcWriteException(mob));
        final o = await CardProgrammer(writer: writer, api: api, reader: reader).program(card);
        expect(o.ok, isFalse);
        expect(o.error!.ref, mob.ref);
        expect(api.programmed, isEmpty);
        expect(reader.programming, isFalse);
      });
    }

    test('409 card_uid_exists when reporting → API ref kept', () async {
      api.programmedError = const ApiException(
        statusCode: 409, code: 'card_uid_exists', message: 'exists', ref: 'NFC-6021', requestId: 'r1');
      final o = await CardProgrammer(writer: FakeNfcWriter((_) async => '04AA'), api: api, reader: reader)
          .program(card);
      expect(o.ok, isFalse);
      expect(o.uid, '04AA');
      expect(o.error!.ref, 'NFC-6021');
      expect(o.error!.requestId, 'r1');
      expect(o.error!.message, contains('already registered'));
    });

    test('card list filters unprogrammed', () async {
      api.cards = [card, const BusinessCardItem(id: 'x', name: 'Old', kind: 'card', tapUrl: 'https://a/t/1', programmed: true)];
      expect((await api.listBusinessCards(programmed: false)).map((c) => c.id), ['c9']);
    });
  });

  group('C3 API client', () {
    test('list accepts array or {items}, register/programmed bodies', () async {
      final seen = <http.Request>[];
      var paginated = false;
      final api = ApiClient(
        client: MockClient((req) async {
          seen.add(req);
          if (req.method == 'GET') {
            final items = [{'id': 'c1', 'name': 'A', 'kind': 'card', 'assignee_name': 'Jo', 'uid_masked': '04••01',
              'tap_url': 'https://x/t/1', 'programmed': false}];
            // No charset in Content-Type (like FastAPI): must still decode as UTF-8.
            return http.Response.bytes(utf8.encode(jsonEncode(paginated ? {'items': items, 'total': 1} : items)), 200,
                headers: {'content-type': 'application/json'});
          }
          if (req.url.path.endsWith('/device/business/cards')) {
            return http.Response(jsonEncode({'error': {'code': 'card_uid_exists', 'message': 'exists', 'ref': 'NFC-6021'}}), 409);
          }
          return http.Response('{}', 200);
        }),
        baseUrl: 'https://api.example.com',
        deviceToken: 'nfcd_t',
      );
      final l = await api.listBusinessCards(query: 'A', programmed: false);
      expect(l.single.assigneeName, 'Jo');
      expect(l.single.uidMasked, '04••01');
      expect(seen.last.url.queryParameters, containsPair('programmed', 'false'));
      expect(seen.last.url.queryParameters, containsPair('q', 'A'));
      paginated = true;
      expect((await api.listBusinessCards()).single.id, 'c1');

      await expectLater(
        api.registerBusinessCard(uid: '04A1B2', name: 'Door', kind: 'tag'),
        throwsA(isA<ApiException>().having((e) => e.ref, 'ref', 'NFC-6021')),
      );
      expect(jsonDecode(seen.last.body), {'uid': '04A1B2', 'name': 'Door', 'kind': 'tag'});
      expect(registerCardError(const ApiException(statusCode: 409, code: 'card_uid_exists', message: 'x')).message,
          'This card is already registered in your business.');

      await api.markCardProgrammed(cardId: 'c1', uid: '04A1B2');
      expect(seen.last.url.path, '/api/v1/device/business/cards/c1/programmed');
      expect(jsonDecode(seen.last.body), {'uid': '04A1B2'});
    });
  });

  test('sqflite migration v1 → v2 keeps rows and adds the new columns', () async {
    sqfliteFfiInit();
    final dir = await Directory.systemTemp.createTemp('nfcdb');
    final path = '${dir.path}/events.db';
    final v1 = await databaseFactoryFfi.openDatabase(path, options: OpenDatabaseOptions(
      version: 1,
      onCreate: (db, _) => db.execute('''CREATE TABLE events (event_id TEXT PRIMARY KEY, card_id TEXT NOT NULL,
        technologies TEXT NOT NULL, card_type TEXT, detected_at INTEGER NOT NULL, delivery_mode TEXT NOT NULL,
        status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_status_code INTEGER, last_error TEXT,
        latency_ms INTEGER, next_attempt_at INTEGER, pending_report TEXT, updated_at INTEGER NOT NULL)'''),
    ));
    await v1.insert('events', {
      'event_id': 'old', 'card_id': '04A1', 'technologies': '["NfcA"]', 'detected_at': 1, 'delivery_mode': 'relay',
      'status': 'delivered', 'attempts': 1, 'updated_at': 1,
    });
    await v1.close();

    final repo = await SqfliteEventRepository.open(factory: databaseFactoryFfi, path: path);
    expect((await repo.get('old'))!.status, EventStatus.delivered);
    await repo.upsert(testEvent(id: 'new').copyWith(
      status: EventStatus.logged, errorRef: () => 'NFC-5001', requestId: () => 'r', businessJson: () => jsonEncode(recognizedJson)));
    final n = (await repo.get('new'))!;
    expect(n.status, EventStatus.logged);
    expect(n.errorRef, 'NFC-5001');
    expect(n.business!.message, 'John Doe · Sales Manager');
    await repo.close();
    await dir.delete(recursive: true);
  });

  test('theme: dark-red palette, no purple hues in either scheme', () {
    bool isPurple(Color c) {
      final hsv = HSVColor.fromColor(c);
      return hsv.saturation > 0.15 && hsv.value > 0.15 && hsv.hue >= 240 && hsv.hue <= 320;
    }

    for (final s in [AppTheme.lightScheme, AppTheme.darkScheme]) {
      final colors = [s.primary, s.primaryContainer, s.secondary, s.secondaryContainer, s.tertiary,
        s.tertiaryContainer, s.surface, s.surfaceContainer, s.surfaceContainerHigh, s.surfaceContainerHighest,
        s.surfaceContainerLow, s.outline, s.outlineVariant, s.inversePrimary, s.surfaceTint, s.onSurfaceVariant];
      for (final c in colors) {
        expect(isPurple(c), isFalse, reason: c.toString());
      }
    }
    expect(AppTheme.lightScheme.primary, const Color(0xFFB91C1C));
    expect(AppTheme.light().colorScheme.primary, const Color(0xFFB91C1C));
    expect(AppTheme.dark().colorScheme.surface, AppTheme.darkScheme.surface);
  });
}
