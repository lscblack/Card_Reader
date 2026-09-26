import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/digital_card_token.dart';
import 'package:nfc_terminal/core/http_client.dart';
import 'package:nfc_terminal/services/deep_links.dart';
import 'package:nfc_terminal/core/links.dart';
import 'package:nfc_terminal/core/pairing.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/ui/personal/personal_auth_screen.dart';
import 'package:nfc_terminal/ui/screens/pair_confirm_screen.dart';
import 'package:nfc_terminal/ui/widgets/server_trust.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/services/personal_state.dart';
import 'package:nfc_terminal/ui/personal/qr_share_screen.dart';
import 'package:provider/provider.dart';

import 'fakes.dart';
import 'personal_fakes.dart';
import 'personal_fixtures.dart';

void main() {
  testWidgets('QR share: no endless spinner when no exchange code can be made or the web page is off', (tester) async {
    // Signed-out state: no share key and no API → the exchange code cannot be produced.
    final p = PersonalState(
      store: MemorySecureStore(),
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      hce: FakeHce(),
    );
    final card = DigitalCard.fromJson(cardJson(web: false));
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: p,
      child: MaterialApp(home: QrShareScreen(card: card)),
    ));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('qrUnavailable')), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Try again'), findsOneWidget);

    await tester.tap(find.text('Public link'));
    await tester.pump();
    expect(find.textContaining('public web page is off'), findsOneWidget);
    expect(find.byKey(const Key('shareQr')), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  group('ServerTrust.warnings', () {
    test('known https server: no warning (port and trailing /api/v1 normalised)', () {
      expect(ServerTrust.warnings('https://api.example.com', ['https://api.example.com:443/api/v1/']), isEmpty);
    });
    test('unknown server and plain http are both flagged', () {
      final w = ServerTrust.warnings('http://evil.example', ['https://api.example.com', null]);
      expect(w, hasLength(2));
      expect(w.last, contains('api.example.com'));
    });
  });

  test('release builds reject LAN http:// with a message that says https is required', () {
    final msg = ServerUrl.validate('http://192.168.1.74:8000', allowLan: false);
    expect(msg, contains('https://'));
    expect(msg, contains('debug build'));
  });

  Future<(AppState, PersonalState)> states(WidgetTester tester, {String? terminalServer}) async {
    final store = MemorySecureStore();
    if (terminalServer != null) store.values['server_url'] = terminalServer;
    final app = AppState(
      credentials: CredentialStore(store),
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      repository: InMemoryEventRepository(),
      apiFactory: (_, _, _) => FakeDeviceApi(),
    );
    final p = PersonalState(
      store: store,
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      hce: FakeHce(),
    );
    await tester.runAsync(() async {
      await app.init();
      await p.init();
    });
    return (app, p);
  }

  Widget host(AppState app, PersonalState p, Widget child) => MultiProvider(
    providers: [ChangeNotifierProvider.value(value: app), ChangeNotifierProvider.value(value: p)],
    child: MaterialApp(home: child),
  );

  testWidgets('pair link to a foreign server: host shown, warning, Pair disabled until explicitly trusted', (tester) async {
    final (app, p) = await states(tester, terminalServer: 'https://api.example.com');
    final pairing = PairingPayload.parse('nfcterminal://pair?v=1&server=https%3A%2F%2Fevil.example&code=nfcp_abcdefghijklmnopqrstuvwx');
    await tester.pumpWidget(host(app, p, PairConfirmScreen(pairing: pairing)));
    await tester.pump();
    expect(find.text('evil.example'), findsWidgets);
    expect(find.byKey(const Key('serverWarning')), findsOneWidget);
    FilledButton button() => tester.widget<FilledButton>(find.ancestor(of: find.text('Pair this device'), matching: find.byType(FilledButton)));
    expect(button().onPressed, isNull);
    await tester.tap(find.byKey(const Key('trustServer')));
    await tester.pump();
    expect(button().onPressed, isNotNull);
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('pair link to the server this phone already uses needs no extra confirmation', (tester) async {
    final (app, p) = await states(tester, terminalServer: 'https://api.example.com');
    final pairing = PairingPayload.parse('nfcterminal://pair?v=1&server=https%3A%2F%2Fapi.example.com&code=nfcp_abcdefghijklmnopqrstuvwx');
    await tester.pumpWidget(host(app, p, PairConfirmScreen(pairing: pairing)));
    await tester.pump();
    expect(find.byKey(const Key('serverWarning')), findsNothing);
    expect(find.byKey(const Key('trustServer')), findsNothing);
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('login link to a foreign server: dialog warns and Sign in stays disabled until trusted', (tester) async {
    final (app, p) = await states(tester, terminalServer: 'https://api.example.com');
    final link = LoginPayload.parse('nfcterminal://login?v=1&server=https%3A%2F%2Fevil.example&code=nfcl_AbCdEfGhIjKlMnOpQrStUv');
    await tester.pumpWidget(host(app, p, PersonalAuthScreen(loginLink: link)));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('loginConfirm')), findsOneWidget);
    expect(find.byKey(const Key('serverWarning')), findsOneWidget);
    FilledButton button() => tester.widget<FilledButton>(find.byKey(const Key('loginConfirmButton')));
    expect(button().onPressed, isNull);
    await tester.tap(find.byKey(const Key('trustServer')));
    await tester.pump();
    expect(button().onPressed, isNotNull);
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('a card deep link never exchanges (and shares my card) without an explicit tap', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    final store = MemorySecureStore();
    final app = AppState(
      credentials: CredentialStore(store),
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      repository: InMemoryEventRepository(),
    );
    final api = FakePersonalApi();
    final p = PersonalState(
      store: store,
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      hce: FakeHce(),
      apiFactory: (_, token, _) => api..sessionToken = token,
    );
    await tester.runAsync(() async {
      await app.init();
      await p.init();
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    final links = _Links();
    await tester.pumpWidget(NfcTerminalApp(
      appState: app, repository: InMemoryEventRepository(), nfc: FakeNfcService(), personal: p, deepLinks: links));
    await tester.pump(const Duration(milliseconds: 300));

    final token = DigitalCardToken.encode(DigitalCardToken.generate(
      shareId: '00112233-4455-6677-8899-aabbccddeeff', keyId: 1, issuedAt: 1790000000, secret: List.filled(32, 1)));
    links.controller.add('nfcterminal://card?v=1&t=$token');
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byKey(const Key('cardLinkConfirm')), findsOneWidget);
    expect(api.exchanges, isEmpty);

    await tester.tap(find.text('Cancel'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(api.exchanges, isEmpty);

    links.controller.add('nfcterminal://card?v=1&t=$token');
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.byKey(const Key('cardLinkExchange')));
    await tester.pump(const Duration(milliseconds: 300));
    expect(api.exchanges, [token]);
    expect(api.lastVia, 'qr');

    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });
}

class _Links implements DeepLinkSource {
  final controller = StreamController<String>.broadcast();
  @override
  Future<String?> initialLink() async => null;
  @override
  Stream<String> get links => controller.stream;
}
