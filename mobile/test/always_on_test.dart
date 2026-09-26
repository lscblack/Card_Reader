// Always-on card detection, background guest launches, terminal auto-run and theme mode.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/app_settings.dart';
import 'package:nfc_terminal/core/config.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/business.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/personal_state.dart';
import 'package:nfc_terminal/services/reader_controller.dart';
import 'package:nfc_terminal/services/tag_dispatch.dart';
import 'package:nfc_terminal/ui/widgets/business_result.dart';
import 'package:nfc_terminal/ui/widgets/guest_tap.dart';

import 'fakes.dart';
import 'guest_tap_test.dart' show FakeGuestTap, frames;
import 'part2_test.dart' show businessConfig, recognizedJson;
import 'personal_fakes.dart';

final _server = Uri.parse(AppConfig.defaultServerUrl);
final _base = '${_server.scheme}://${_server.host}${_server.hasPort ? ':${_server.port}' : ''}';

AppState _app(MemorySecureStore store, {FakeTagDispatch? dispatch, Map<String, dynamic>? cfg}) => AppState(
  credentials: CredentialStore(store),
  httpClient: MockClient((req) async {
    if (cfg != null && req.url.path.endsWith('/device/register')) {
      return http.Response.bytes(utf8.encode(jsonEncode({'device': {}, 'device_token': 'nfcd_t', 'config': cfg})), 201);
    }
    if (cfg != null && req.url.path.endsWith('/device/config')) return http.Response.bytes(utf8.encode(jsonEncode(cfg)), 200);
    return http.Response(jsonEncode({'status': 'active'}), 200);
  }),
  platform: FakePlatformInfo(),
  repository: InMemoryEventRepository(),
  tagDispatch: dispatch ?? FakeTagDispatch(),
);

PersonalState _personal(MemorySecureStore store, FakeHce hce) {
  final api = FakePersonalApi();
  return PersonalState(
    store: store,
    httpClient: MockClient((_) async => http.Response('', 404)),
    platform: FakePlatformInfo(),
    hce: hce,
    apiFactory: (_, token, _) => api..sessionToken = token,
  );
}

void main() {
  tearDown(() => NfcClaims.count.value = 0);

  testWidgets('personal-only phone: detection on every tab except My Card while sharing by HCE', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    final store = MemorySecureStore();
    final app = _app(store);
    final p = _personal(store, FakeHce());
    await tester.runAsync(() async {
      await app.init();
      await p.init();
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    final guest = FakeGuestTap();
    await tester.pumpWidget(NfcTerminalApp(appState: app, repository: InMemoryEventRepository(), nfc: FakeNfcService(),
        personal: p, guestTap: guest));
    await frames(tester, 3);
    expect(guest.onTag, isNull, reason: 'My Card shares by HCE: reader mode would switch it off');

    final nav = find.byKey(const Key('rootNav'));
    for (final tab in ['Contacts', 'Settings']) {
      await tester.tap(find.descendant(of: nav, matching: find.text(tab)));
      await frames(tester, 3);
      expect(guest.onTag, isNotNull, reason: '$tab reads cards');
    }
    await tester.tap(find.descendant(of: nav, matching: find.text('My Card')));
    await frames(tester, 3);
    expect(guest.onTag, isNull);
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('NFC ownership: screens that claim NFC pause guest reading and give it back', (tester) async {
    final app = _app(MemorySecureStore());
    await tester.runAsync(app.init);
    final guest = FakeGuestTap();
    await tester.pumpWidget(NfcTerminalApp(appState: app, repository: InMemoryEventRepository(), nfc: FakeNfcService(), guestTap: guest));
    await frames(tester, 3);
    expect(guest.onTag, isNotNull);
    final nav = tester.state<NavigatorState>(find.byType(Navigator).first);
    nav.push(MaterialPageRoute<void>(builder: (_) => const NfcClaim(child: Scaffold(body: Text('owner')))));
    await frames(tester, 3);
    expect(guest.onTag, isNull, reason: 'e.g. Register cards / Program / Scan / QR');
    nav.pop();
    await frames(tester, 3);
    expect(guest.onTag, isNotNull);
    expect(guest.starts, 2);
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('app launched by a UID-only card: resolved by chip ID, action opened, back to the previous app',
      (tester) async {
    final d = FakeTagDispatch()
      ..pending.add(DispatchedTag(uidHex: '8C530107', techList: const ['android.nfc.tech.NfcA'],
          launchedFromBackground: true, receivedAt: DateTime.now().toUtc()));
    final app = _app(MemorySecureStore(), dispatch: d);
    await tester.runAsync(app.init);
    final opened = <Uri>[];
    final lookups = <String>[];
    await tester.pumpWidget(NfcTerminalApp(
      appState: app,
      repository: InMemoryEventRepository(),
      nfc: FakeNfcService(),
      guestTap: FakeGuestTap(),
      cardResolver: (uid) async {
        lookups.add(uid);
        return '$_base/t/Ol4a8ErXE9';
      },
      linkOpener: (u) async {
        opened.add(u);
        return true;
      },
    ));
    await frames(tester, 8);
    expect(lookups, ['8C530107']);
    expect(opened.single.toString(), '$_base/t/Ol4a8ErXE9');
    expect(d.movedToBack, 1);
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('registered terminal with background reading: dispatched taps stay events (no guest action)',
      (tester) async {
    final d = FakeTagDispatch()
      ..pending.add(DispatchedTag(uidHex: '04A1B2C3', techList: const ['android.nfc.tech.NfcA'],
          launchedFromBackground: true, receivedAt: DateTime.now().toUtc()));
    final app = _app(MemorySecureStore(), dispatch: d, cfg: businessConfig());
    await tester.runAsync(() async {
      await app.init();
      await app.register(serverUrl: 'https://api.example.com', apiKey: 'nfc_k', deviceName: 'x');
    });
    final opened = <Uri>[];
    await tester.pumpWidget(NfcTerminalApp(appState: app, repository: InMemoryEventRepository(), nfc: FakeNfcService(),
        guestTap: FakeGuestTap(), linkOpener: (u) async {
          opened.add(u);
          return true;
        }));
    await frames(tester, 5);
    expect(d.pending, isEmpty, reason: 'taken by the terminal');
    expect(opened, isEmpty);
    expect(d.enabledCalls.every((e) => e), isTrue, reason: 'alias always on');
    app.onPaused();
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });

  group('terminal auto-run', () {
    test('a recognized card with an action runs it after delivery; unknown cards do not', () async {
      final api = FakeDeviceApi();
      final repo = InMemoryEventRepository();
      final ran = <String?>[];
      final reader = ReaderController(
        nfc: FakeNfcService(),
        repository: repo,
        platform: FakePlatformInfo(),
        deliveryProvider: () => DeliveryService(api: api, httpClient: MockClient((_) async => http.Response('', 500)), repository: repo),
        configProvider: () => testConfig(),
        haptic: () async {},
        runAction: (b) async => ran.add(b.actionUrl),
      );
      api.onSubmit = (s) async => EventSubmitResult(
          eventId: s.eventId, status: 'logged', business: BusinessResult.fromJson(Map.of(recognizedJson)));
      await reader.handleCard(CardRead(uid: '04A1B2C3', technologies: const ['NfcA'], type: CardType.unknown,
          detectedAt: DateTime.now().toUtc()));
      expect(ran, ['https://acme.example/b/acme/john']);

      api.onSubmit = (s) async => EventSubmitResult(eventId: s.eventId, status: 'logged',
          business: BusinessResult.fromJson({'result': 'unknown_card', 'message': 'Unknown card'}));
      await reader.handleCard(CardRead(uid: '04FFFFFF', technologies: const ['NfcA'], type: CardType.unknown,
          detectedAt: DateTime.now().toUtc()));
      expect(ran, hasLength(1));
      reader.dispose();
    });

    test('"Run card actions automatically" defaults on and persists', () async {
      final store = MemorySecureStore();
      final app = _app(store);
      await app.init();
      expect(app.autoRunActions, isTrue);
      await app.setAutoRunActions(false);
      expect(await AppSettings(store).autoRunActions, isFalse);
      final again = _app(store);
      await again.init();
      expect(again.autoRunActions, isFalse);
      app.dispose();
      again.dispose();
    });

    testWidgets('result leads with the action ("Opening <host>…") when it ran automatically', (tester) async {
      final b = BusinessResult.fromJson(Map.of(recognizedJson));
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: BusinessResultCard(result: b, autoRun: true))));
      expect(find.text('Opening acme.example…'), findsOneWidget);
      expect(tester.getTopLeft(find.byKey(const Key('businessAction'))).dy,
          lessThan(tester.getTopLeft(find.byKey(const Key('businessMessage'))).dy), reason: 'action first, owner second');
    });
  });

  testWidgets('theme: Settings → Appearance switches instantly and persists', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    final store = MemorySecureStore();
    final app = _app(store, cfg: businessConfig());
    await tester.runAsync(() async {
      await app.init();
      await app.register(serverUrl: 'https://api.example.com', apiKey: 'nfc_k', deviceName: 'x');
    });
    await tester.pumpWidget(NfcTerminalApp(appState: app, repository: InMemoryEventRepository(), nfc: FakeNfcService(),
        guestTap: FakeGuestTap()));
    await frames(tester, 3);
    expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode, ThemeMode.system);
    await tester.tap(find.descendant(of: find.byKey(const Key('rootNav')), matching: find.text('Settings')));
    await frames(tester, 3);
    await tester.tap(find.text('Dark'));
    await frames(tester, 3);
    expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode, ThemeMode.dark);
    expect(Theme.of(tester.element(find.byKey(const Key('themeMode')))).brightness, Brightness.dark);
    expect(await AppSettings(store).themeMode, 'dark');
    final again = _app(store);
    await again.init();
    expect(again.themeMode, 'dark');
    app.onPaused();
    app.dispose();
    again.dispose();
    await tester.pumpWidget(const SizedBox());
  });
}
