import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/core/app_settings.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/services/background_reading.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/reader_controller.dart';
import 'package:nfc_terminal/services/tag_dispatch.dart';

import 'fakes.dart';

DispatchedTag _tag({String uid = '04A1B2C3D4E5', bool fromBackground = true}) => DispatchedTag(
  uidHex: uid,
  techList: const ['android.nfc.tech.NfcA', 'android.nfc.tech.MifareUltralight'],
  sak: 0,
  productType: 4,
  launchedFromBackground: fromBackground,
  receivedAt: DateTime.now().toUtc(),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('DispatchedTag', () {
    test('map from Kotlin → CardRead with the same normalisation and type guessing', () {
      final t = DispatchedTag.fromMap({
        'uid': '04a1b2c3d4e5',
        'techList': ['android.nfc.tech.NfcA', 'android.nfc.tech.MifareUltralight', 'android.nfc.tech.Ndef'],
        'sak': 0,
        'atqa': '4400',
        'productType': 4,
        'fromBackground': true,
      });
      expect(t.launchedFromBackground, isTrue);
      final c = t.toCardRead()!;
      expect(c.uid, '04A1B2C3D4E5');
      expect(c.technologies, ['NfcA', 'MifareUltralight', 'Ndef']);
      expect(c.type, CardType.ntag);
      expect(DispatchedTag.fromMap({'uid': '', 'techList': []}).toCardRead(), isNull);
    });

    test('Android channel: pending tags, pushed tags and alias toggling (mock channel)', () async {
      const channel = MethodChannel('net.nexventures.nfc_terminal/tags');
      final calls = <MethodCall>[];
      final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return switch (call.method) {
          'takePendingTags' => [
            {'uid': '04A1B2C3', 'techList': ['android.nfc.tech.NfcA'], 'sak': 8, 'fromBackground': true},
          ],
          'isDispatchEnabled' => true,
          _ => null,
        };
      });
      final d = AndroidTagDispatch();
      final pending = await d.takePending();
      expect(pending.single.uidHex, '04A1B2C3');
      expect(pending.single.toCardRead()!.type, CardType.mifareClassic);

      final pushed = d.tags.first;
      await messenger.handlePlatformMessage(
        channel.name,
        const StandardMethodCodec().encodeMethodCall(const MethodCall('onTag', {
          'uid': 'BEEF0001', 'techList': ['android.nfc.tech.NfcF'], 'fromBackground': false,
        })),
        (_) {},
      );
      final t = await pushed;
      expect(t.uidHex, 'BEEF0001');
      expect(t.launchedFromBackground, isFalse);

      await d.setDispatchEnabled(false);
      expect(await d.isDispatchEnabled(), isTrue);
      expect(calls.map((c) => c.method), contains('setDispatchEnabled'));
      expect(calls.firstWhere((c) => c.method == 'setDispatchEnabled').arguments, false);
      messenger.setMockMethodCallHandler(channel, null);
    });
  });

  group('return-to-background decision', () {
    test('only when the tap launched the app', () {
      expect(shouldReturnToBackground(_tag(fromBackground: true)), isTrue);
      expect(shouldReturnToBackground(_tag(fromBackground: false)), isFalse);
    });

    test('notification texts', () {
      final e = testEvent().copyWith(status: EventStatus.delivered, lastStatusCode: () => 200, latencyMs: () => 80);
      expect(backgroundResultText('04A1B2C3D4E5', e).title, 'Card 04:A1:B2:C3:D4:E5 delivered ✓');
      expect(backgroundResultText('04A1', e.copyWith(status: EventStatus.queued)).title,
          'Card 04:A1 failed — queued for retry');
      expect(backgroundResultText('04A1', null).body, contains('Still sending'));
    });
  });

  group('BackgroundReading', () {
    late FakeTagDispatch dispatch;
    late List<CardRead> handled;
    var registered = true;
    var flushes = 0;
    Future<EventRecord?> Function(CardRead) handler = (_) async => null;

    BackgroundReading build({Duration timeout = const Duration(seconds: 8)}) => BackgroundReading(
      dispatch: dispatch,
      handleCard: (c) {
        handled.add(c);
        return handler(c);
      },
      isRegistered: () => registered,
      flushRetries: () => flushes++,
      timeout: timeout,
    );

    setUp(() {
      dispatch = FakeTagDispatch();
      handled = [];
      registered = true;
      flushes = 0;
      handler = (c) async => testEvent().copyWith(status: EventStatus.delivered, lastStatusCode: () => 200);
    });

    test('launched by tag: pipeline → notification → move to back; retry queue flushed', () async {
      dispatch.pending.add(_tag());
      await build().start();
      expect(handled.single.uid, '04A1B2C3D4E5');
      expect(flushes, 1);
      expect(dispatch.notifications.single, 'Card 04:A1:B2:C3:D4:E5 delivered ✓');
      expect(dispatch.movedToBack, 1);
    });

    test('app already in foreground: no notification, no move to back', () async {
      await build().handle(_tag(fromBackground: false));
      expect(handled, hasLength(1));
      expect(dispatch.notifications, isEmpty);
      expect(dispatch.movedToBack, 0);
    });

    test('not registered → ignored silently', () async {
      registered = false;
      await build().handle(_tag());
      expect(handled, isEmpty);
      expect(flushes, 0);
      expect(dispatch.notifications, isEmpty);
      expect(dispatch.movedToBack, 0);
    });

    test('slow delivery: after the timeout, notify "still sending" and go back', () async {
      final never = Completer<EventRecord?>();
      handler = (_) => never.future;
      await build(timeout: const Duration(milliseconds: 30)).handle(_tag());
      expect(dispatch.notifications.single, contains('read'));
      expect(dispatch.movedToBack, 1);
    });

    test('duplicate (debounced) tap: no notification, still returns to the previous app', () async {
      handler = (_) async => null;
      await build().handle(_tag());
      expect(dispatch.notifications, isEmpty);
      expect(dispatch.movedToBack, 1);
    });
  });

  test('debounce is shared by reader mode and tag dispatch: one tap → one event', () async {
    final nfc = FakeNfcService();
    final repo = InMemoryEventRepository();
    final api = FakeDeviceApi();
    final delivery = DeliveryService(
      api: api, httpClient: MockClient((_) async => http.Response('', 500)), repository: repo);
    final reader = ReaderController(
      nfc: nfc, repository: repo, platform: FakePlatformInfo(),
      deliveryProvider: () => delivery, configProvider: () => testConfig(), haptic: () async {});
    await reader.init();
    final dispatch = FakeTagDispatch();
    final bg = BackgroundReading(
      dispatch: dispatch, handleCard: reader.handleCard, isRegistered: () => true, flushRetries: () {});

    nfc.onCard!(CardRead(
      uid: '04A1B2C3D4E5', technologies: const ['NfcA'], type: CardType.unknown, detectedAt: DateTime.now().toUtc()));
    await bg.handle(_tag(fromBackground: false));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(api.submissions, hasLength(1));
    expect(repo.rows, hasLength(1));

    await bg.handle(_tag(uid: 'CAFE0001', fromBackground: false));
    expect(api.submissions, hasLength(2));
    reader.dispose();
  });

  group('"Read cards when app is closed" toggle', () {
    Map<String, dynamic> config() => {
      'device_id': 'dev-1', 'device_name': 'Pixel', 'application': {'id': 'app-1', 'name': 'Gym'},
      'delivery_mode': 'relay', 'endpoint_url': null, 'endpoint_enabled': true, 'timeout_seconds': 10,
      'max_retries': 3, 'custom_headers': {}, 'signing_secret': null,
    };

    AppState build(MemorySecureStore store, FakeTagDispatch d) => AppState(
      credentials: CredentialStore(store),
      httpClient: MockClient((req) async {
        if (req.url.path.endsWith('/device/register')) {
          return http.Response(jsonEncode({'device': {}, 'device_token': 'nfcd_t', 'config': config()}), 201);
        }
        if (req.url.path.endsWith('/device/config')) return http.Response(jsonEncode(config()), 200);
        return http.Response(jsonEncode({'status': 'active'}), 200);
      }),
      platform: FakePlatformInfo(),
      repository: InMemoryEventRepository(),
      tagDispatch: d,
    );

    test('alias always on (guest taps); background-reading choice persisted and kept on unregister', () async {
      final store = MemorySecureStore();
      final d = FakeTagDispatch();
      final app = build(store, d);
      await app.init();
      expect(app.backgroundReading, isTrue);
      expect(d.enabledCalls, [true], reason: 'guest taps while not registered');

      await app.register(serverUrl: 'https://api.example.com', apiKey: 'nfc_k', deviceName: 'x');
      expect(d.enabledCalls.last, isTrue);
      expect(d.permissionRequests, 1);

      await app.setBackgroundReading(false);
      expect(d.enabledCalls.last, isTrue, reason: 'the switch only decides events vs actions');
      expect(await AppSettings(store).backgroundReading, isFalse);

      // A fresh start restores the choice.
      final d2 = FakeTagDispatch();
      final again = build(store, d2);
      await again.init();
      expect(again.backgroundReading, isFalse);
      expect(d2.enabledCalls, [true]);

      await again.setBackgroundReading(true);
      expect(d2.enabledCalls.last, isTrue);
      await again.unregister();
      expect(d2.enabledCalls.last, isTrue);
      expect(await AppSettings(store).backgroundReading, isTrue, reason: 'preference survives unregister');
      app.dispose();
      again.dispose();
    });
  });
}
