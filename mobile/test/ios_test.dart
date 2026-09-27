import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/error_catalog.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/core/tap_links.dart';
import 'package:nfc_terminal/data/event_repository.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/services/background_reading.dart';
import 'package:nfc_terminal/services/card_registrar.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/guest_tap.dart';
import 'package:nfc_terminal/services/ios_links.dart';
import 'package:nfc_terminal/services/nfc_writer.dart';
import 'package:nfc_terminal/services/reader_controller.dart';
import 'package:nfc_terminal/services/tag_dispatch.dart';
import 'package:nfc_terminal/ui/screens/reader_screen.dart';
import 'package:provider/provider.dart';

import 'fakes.dart';
import 'guest_tap_test.dart' show FakeGuestTap, frames;

CardRead _card(String uid) =>
    CardRead(uid: uid, technologies: const ['NfcA'], type: CardType.unknown, detectedAt: DateTime.now().toUtc());

DispatchedTag _link(String url) => DispatchedTag(
  uidHex: '',
  techList: const [],
  launchedFromBackground: true,
  receivedAt: DateTime.now().toUtc(),
  ndefUris: [url],
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('tap links', () {
    test('code of a tap link, and the browser marker for links the app opens itself', () {
      expect(tapCodeOf(Uri.parse('https://api.example.com/t/AbC_12-xyz')), 'AbC_12-xyz');
      expect(tapCodeOf(Uri.parse('https://api.example.com/t/AbC_12-xyz/')), 'AbC_12-xyz');
      expect(tapCodeOf(Uri.parse('https://api.example.com/p/jane')), isNull);
      expect(tapCodeOf(Uri.parse('nfcterminal://card?t=x')), isNull);

      expect(tapLinkForBrowser(Uri.parse('https://api.example.com/t/AbC_12-xyz')).toString(),
          'https://api.example.com/t/AbC_12-xyz?via=app');
      expect(tapLinkForBrowser(Uri.parse('https://example.com/menu')).toString(), 'https://example.com/menu');
    });

    test('iOS NFC errors map to the MOB catalog', () {
      MobError map(String message) => mobErrorForPlatform(PlatformException(code: 'Error', message: message));
      expect(map('Error Domain=NFCError Code=100 "Tag connection lost"'), MobError.tagLost);
      expect(map('Error Domain=NFCError Code=400 "Tag is not writable"'), MobError.tagReadOnly);
      expect(map('Error Domain=NFCError Code=402 "Tag size too small"'), MobError.tagTooSmall);
      expect(map('Error Domain=NFCError Code=401 "Tag update failure"'), MobError.ndefWriteFailed);
      // Android (pigeon: Java exception class) is unchanged.
      expect(map('android.nfc.TagLostException'), MobError.tagLost);
    });
  });

  group('IosLinkRouter', () {
    test('splits pairing links from tap links, buffering both until the app takes them', () async {
      final links = StreamController<Uri>();
      var foreground = false;
      final router = IosLinkRouter(links.stream, inForeground: () => foreground);
      links
        ..add(Uri.parse('https://api.example.com/t/AbCdEf12'))
        ..add(Uri.parse('nfcterminal://pair?v=1&server=x&code=nfcp_1'))
        ..add(Uri.parse('https://api.example.com/somewhere-else'))
        ..add(Uri.parse('nfcterminal://unknown'));
      await Future<void>.delayed(Duration.zero);

      expect(await router.deepLinks.initialLink(), 'nfcterminal://pair?v=1&server=x&code=nfcp_1');
      final pending = await router.tags.takePending();
      expect(pending, hasLength(1));
      expect(pending.single.uidHex, isEmpty);
      expect(pending.single.ndefUris, ['https://api.example.com/t/AbCdEf12']);
      expect(pending.single.launchedFromBackground, isTrue);

      // Later links are pushed.
      final tags = <DispatchedTag>[];
      final deep = <String>[];
      router.tags.tags.listen(tags.add);
      router.deepLinks.links.listen(deep.add);
      foreground = true;
      links
        ..add(Uri.parse('https://api.example.com/t/ZZZZZZZZ'))
        ..add(Uri.parse('nfcterminal://login?t=abc'));
      await Future<void>.delayed(Duration.zero);
      expect(tags.single.ndefUris, ['https://api.example.com/t/ZZZZZZZZ']);
      expect(tags.single.launchedFromBackground, isFalse);
      expect(deep, ['nfcterminal://login?t=abc']);
      expect(await router.tags.requestNotificationPermission(), isTrue);
      router.dispose();
      await links.close();
    });
  });

  group('iOS terminal (session-based reader)', () {
    late FakeNfcService nfc;
    late InMemoryEventRepository repo;
    late FakeDeviceApi api;
    late ReaderController reader;

    setUp(() async {
      nfc = FakeNfcService(sessionBased: true);
      repo = InMemoryEventRepository();
      api = FakeDeviceApi();
      final delivery = DeliveryService(
          api: api, httpClient: MockClient((_) async => http.Response('', 500)), repository: repo);
      reader = ReaderController(
        nfc: nfc,
        repository: repo,
        platform: FakePlatformInfo(),
        deliveryProvider: () => delivery,
        configProvider: () => testConfig(),
        haptic: () async {},
      );
      await reader.init();
    });

    tearDown(() => reader.dispose());

    test('the scan sheet never opens by itself; Scan cards opens it until it closes', () async {
      expect(nfc.starts, 0, reason: 'no sheet at launch');
      expect(reader.active, isFalse);
      expect(reader.phase, ReaderPhase.stopped);

      await reader.onResumed();
      await reader.unsuspend();
      expect(nfc.starts, 0, reason: 'resume / tab switches do not reopen it');

      await reader.start();
      expect(nfc.starts, 1);
      expect(reader.active, isTrue);
      expect(reader.phase, ReaderPhase.ready);

      nfc.onCard!(_card('04A1B2C3D4E5'));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(repo.rows.values.single.status, EventStatus.delivered);
      expect(nfc.sheetMessages.first, 'Sending…');
      expect(nfc.sheetMessages.last, contains('delivered ✓'));
      expect(nfc.sheetMessages.last, contains('Hold the next card'));

      // iOS closes the sheet (timeout / Cancel): the last result stays, Scan cards is offered again.
      nfc.endSession();
      expect(reader.active, isFalse);
      expect(reader.phase, ReaderPhase.delivered);
      await reader.onResumed();
      expect(nfc.starts, 1);
    });

    test('programming closes the sheet and does not reopen it afterwards', () async {
      await reader.start();
      await reader.pauseForProgramming();
      expect(reader.active, isFalse);
      await reader.resumeAfterProgramming();
      expect(nfc.starts, 1);
      expect(reader.phase, ReaderPhase.stopped);
    });

    test('Register cards: the form replaces the sheet, which reopens after saving', () async {
      final r = CardRegistrar(api: api, nfc: nfc, reader: reader, haptic: () async {});
      await r.start();
      expect(nfc.onCard, isNotNull);
      expect(r.needsScanButton, isFalse);

      nfc.onCard!(_card('04CC0001'));
      await Future<void>.delayed(Duration.zero);
      expect(r.phase, RegisterPhase.sheet);
      expect(nfc.onCard, isNull, reason: 'the sheet would cover the registration form');

      expect(await r.submit(name: 'Front desk', kind: 'card', assignToBusiness: true), isNull);
      expect(r.phase, RegisterPhase.success);
      expect(nfc.onCard, isNotNull, reason: 'straight on to the next card');
      expect(nfc.sheetMessages.last, contains('Registered · Front desk'));

      // Sheet closed by iOS: the screen offers "Scan the next card".
      nfc.endSession();
      expect(r.needsScanButton, isTrue);
      await r.scan();
      expect(nfc.onCard, isNotNull);
      await r.stop();
    });
  });

  group('iOS screens', _iosScreens);

  group('iOS background taps (universal links)', () {
    test('a tap link of this business is delivered as its card; other links run as a guest tap', () async {
      final dispatch = FakeTagDispatch();
      final handled = <CardRead>[];
      final foreign = <DispatchedTag>[];
      final lookups = <Uri>[];
      final bg = BackgroundReading(
        dispatch: dispatch,
        handleCard: (c) async {
          handled.add(c);
          return null;
        },
        isRegistered: () => true,
        flushRetries: () {},
        resolveTapLink: (link) async {
          lookups.add(link);
          return link.pathSegments.last == 'OurCard1' ? '04:a1:b2:c3' : null;
        },
        onForeignLink: foreign.add,
      );
      await bg.handle(_link('https://api.example.com/t/OurCard1'));
      expect(handled.single.uid, '04A1B2C3');
      expect(handled.single.technologies, isEmpty);

      await bg.handle(_link('https://api.example.com/t/TheirCard'));
      expect(handled, hasLength(1));
      expect(foreign.single.ndefUris, ['https://api.example.com/t/TheirCard']);
      expect(lookups, hasLength(2));

      // A real (Android) dispatched tag never asks the server.
      await bg.handle(DispatchedTag(
          uidHex: '04DD', techList: const [], launchedFromBackground: false, receivedAt: DateTime.now().toUtc()));
      expect(lookups, hasLength(2));
      expect(handled.last.uid, '04DD');
    });

    test('a failing lookup (offline) falls back to the guest flow', () async {
      final foreign = <DispatchedTag>[];
      final bg = BackgroundReading(
        dispatch: FakeTagDispatch(),
        handleCard: (_) async => null,
        isRegistered: () => true,
        flushRetries: () {},
        resolveTapLink: (_) async => throw const SocketExceptionLike(),
        onForeignLink: foreign.add,
      );
      await bg.handle(_link('https://api.example.com/t/OurCard1'));
      expect(foreign, hasLength(1));
    });
  });
}

void _iosScreens() {
  Future<AppState> appState(WidgetTester tester, EventRepository repo) async {
    final app = AppState(
      credentials: CredentialStore(MemorySecureStore()),
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      repository: repo,
    );
    await tester.runAsync(app.init);
    addTearDown(app.dispose);
    return app;
  }

  testWidgets('reader: "Scan cards" opens the sheet, and is offered again when iOS closes it', (tester) async {
    final repo = InMemoryEventRepository();
    final app = await appState(tester, repo);
    final nfc = FakeNfcService(sessionBased: true);
    final reader = ReaderController(
      nfc: nfc,
      repository: repo,
      platform: FakePlatformInfo(),
      deliveryProvider: () => null,
      configProvider: () => null,
      haptic: () async {},
    );
    await tester.runAsync(reader.init);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: app),
        ChangeNotifierProvider.value(value: reader),
        Provider<EventRepository>.value(value: repo),
      ],
      child: const MaterialApp(home: ReaderScreen()),
    ));
    await tester.pump();
    expect(find.text('Ready to scan'), findsOneWidget);
    expect(find.textContaining('top of the iPhone'), findsOneWidget);
    expect(nfc.starts, 0);

    await tester.tap(find.byKey(const Key('scanCards')));
    await tester.pump();
    expect(nfc.starts, 1);
    expect(find.text('Stop reader'), findsOneWidget);

    nfc.endSession();
    await tester.pump();
    expect(find.byKey(const Key('scanCards')), findsOneWidget);
    reader.dispose();
    await tester.pumpWidget(const SizedBox());
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));

  testWidgets('welcome: "Scan a card" opens the sheet, and a card with a link opens it', (tester) async {
    final repo = InMemoryEventRepository();
    final app = await appState(tester, repo);
    final guest = FakeGuestTap(manual: true);
    final opened = <Uri>[];
    await tester.pumpWidget(NfcTerminalApp(
      appState: app,
      repository: repo,
      nfc: FakeNfcService(sessionBased: true),
      guestTap: guest,
      cardResolver: (_) async => null,
      linkOpener: (u) async {
        opened.add(u);
        return true;
      },
    ));
    await frames(tester);
    expect(find.textContaining('even with the app closed'), findsOneWidget);
    await tester.tap(find.byKey(const Key('guestScan')));
    await tester.pump();
    expect(guest.scans, 1);

    final server = Uri.parse(app.serverUrl ?? 'http://10.0.2.2:8000');
    final link = '${server.scheme}://${server.host}${server.hasPort ? ':${server.port}' : ''}/t/AbCdEf12';
    guest.onTag!(GuestTag(uid: '04A1B2C3', uris: [link], hasNdef: true));
    await frames(tester);
    expect(opened.single.toString(), link);
    await tester.pumpWidget(const SizedBox());
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
}

class SocketExceptionLike implements Exception {
  const SocketExceptionLike();
}
