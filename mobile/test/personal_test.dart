import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/error_catalog.dart';
import 'package:nfc_terminal/core/links.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/services/digital_card_scanner.dart';
import 'package:nfc_terminal/services/personal_state.dart';
import 'package:nfc_terminal/ui/personal/card_editor_screen.dart';
import 'package:nfc_terminal/ui/personal/exchange_flow.dart';
import 'package:nfc_terminal/ui/personal/qr_share_screen.dart';
import 'package:provider/provider.dart';

import 'fakes.dart';
import 'personal_fakes.dart';
import 'personal_fixtures.dart';

PersonalState buildPersonal(MemorySecureStore store, FakeHce hce, FakePersonalApi api) => PersonalState(
  store: store,
  httpClient: MockClient((_) async => http.Response('', 404)),
  platform: FakePlatformInfo(),
  hce: hce,
  apiFactory: (base, token, onUnauthorized) {
    api.sessionToken = token;
    api.onUnauthorized = onUnauthorized;
    return api;
  },
);

extension on FakePersonalApi {
  set onUnauthorized(void Function(ApiException) f) => _unauth[this] = f;
  void Function(ApiException)? get onUnauthorized => _unauth[this];
}

final _unauth = Expando<void Function(ApiException)>();

void main() {
  group('PersonalState', () {
    late MemorySecureStore store;
    late FakeHce hce;
    late FakePersonalApi api;

    setUp(() {
      store = MemorySecureStore();
      hce = FakeHce();
      api = FakePersonalApi();
    });

    test('signed out at start: HCE disabled and cache cleared', () async {
      final p = buildPersonal(store, hce, api);
      await p.init();
      expect(p.signedIn, isFalse);
      expect(hce.calls, containsAll(['clear', 'enabled:false']));
    });

    test('sign in stores session + share key securely, writes the HCE cache, enables the service', () async {
      final p = buildPersonal(store, hce, api);
      await p.init();
      expect(await p.signIn(server: 'https://api.example.com', email: 'jane@example.com', password: 'pw'), isNull);
      expect(p.signedIn, isTrue);
      expect(store.values['personal_session_token'], 'nfcs_testtoken');
      expect(store.values['personal_share_key'], contains('"key_id":7'));
      expect(store.values.values.any((v) => v == 'pw'), isFalse, reason: 'password never stored');
      expect(api.lastDevice!.installationId, isNotEmpty);
      expect(hce.cache, {
        'share_id': '3b241101-e2bb-4255-8caf-4136c566a962', 'key_id': 7,
        'secret': 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
        'public_url': 'https://cards.example.com/p/jane', 'web_page_enabled': true, 'nfc_sharing_enabled': true,
      });
      expect(hce.enabled, isTrue);
    });

    test('QR login uses the code once and never stores it', () async {
      final p = buildPersonal(store, hce, api);
      await p.init();
      final link = LoginPayload.parse('nfcterminal://login?v=1&server=https%3A%2F%2Fapi.example.com&code=nfcl_AbCdEfGhIjKlMnOpQrStUv');
      expect(await p.signInWithCode(link), isNull);
      expect(api.lastLoginCode, 'nfcl_AbCdEfGhIjKlMnOpQrStUv');
      expect(store.values.values.any((v) => v.contains('nfcl_')), isFalse);
    });

    test('invalid_login_code / invalid_credentials messages', () async {
      final p = buildPersonal(store, hce, api);
      await p.init();
      api.signInError = const ApiException(statusCode: 401, code: 'invalid_credentials', message: 'x', ref: 'NFC-1001');
      final e = (await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'x'))!;
      expect(e.message, 'Wrong email or password.');
      expect(e.ref, 'NFC-1001');
      expect(p.signedIn, isFalse);
    });

    test('turning NFC sharing + web page off disables the service; sign-out wipes everything', () async {
      final p = buildPersonal(store, hce, api);
      await p.init();
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      await p.updateShareSettings(const ShareSettings(nfcSharingEnabled: false, webPageEnabled: false));
      expect(hce.enabled, isFalse);
      expect(hce.cache, isNull);
      await p.updateShareSettings(const ShareSettings(nfcSharingEnabled: false, webPageEnabled: true));
      expect(hce.enabled, isTrue);
      expect(hce.cache!['nfc_sharing_enabled'], isFalse);
      expect(hce.cache!['web_page_enabled'], isTrue);

      await p.signOut();
      expect(api.revoked, ['sess-1']);
      expect(p.signedIn, isFalse);
      expect(hce.enabled, isFalse);
      expect(hce.cache, isNull);
      for (final k in ['personal_session_token', 'personal_share_key', 'personal_user', 'personal_cards_cache']) {
        expect(store.values.containsKey(k), isFalse, reason: k);
      }
    });

    test('revoked session (401) signs out locally with a notice', () async {
      final p = buildPersonal(store, hce, api);
      await p.init();
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      api.onUnauthorized!(const ApiException(statusCode: 401, code: 'session_revoked', message: 'x'));
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(p.signedIn, isFalse);
      expect(p.notice, contains('revoked'));
      expect(hce.cache, isNull);
    });

    test('restores the session and cached cards on restart', () async {
      final first = buildPersonal(store, hce, api);
      await first.init();
      await first.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      final again = buildPersonal(store, FakeHce(), FakePersonalApi()..cardsError = Exception('offline'));
      await again.init();
      expect(again.signedIn, isTrue);
      expect(again.primary!.fields.fullName, startsWith('Jane'));
      expect(again.shareKey!.keyId, 7);
    });

    test('locked business fields are never sent in the PATCH', () {
      final c = DigitalCard.fromJson(cardJson(businessLink: {
        'business_id': 'b1', 'business_name': 'Acme', 'employee_id': 'e1', 'locked_fields': ['company', 'job_title'],
        'template_locked': true, 'status': 'active',
      }));
      final patch = c.toPatch();
      final fields = patch['fields'] as Map;
      expect(fields.containsKey('company'), isFalse);
      expect(fields.containsKey('job_title'), isFalse);
      expect(fields['full_name'], isNotNull);
      expect(patch.containsKey('design'), isFalse);
      expect(patch.containsKey('template_id'), isFalse);
    });
  });

  test('local exchange QR uses the shared token generator', () {
    final card = DigitalCard.fromJson(cardJson());
    const key = ShareKey(keyId: 7, secret: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
    final qr = localExchangeQr(card, key, DateTime.fromMillisecondsSinceEpoch(1790000000 * 1000, isUtc: true));
    expect(qr, 'nfcterminal://card?v=1&t=ATskEQHiu0JVjK9BNsVmqWIAAAAHarE7gM90i8kUJX1pX0lTwqQ5wgU');
    expect(localExchangeQr(card, null, DateTime.now()), isNull);
  });

  testWidgets('exchange: scan → POST /personal/exchanges → success sheet with their card + mutual ✓', (tester) async {
    final store = MemorySecureStore();
    final hce = FakeHce();
    final api = FakePersonalApi();
    final p = buildPersonal(store, hce, api);
    await tester.runAsync(() async {
      await p.init();
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      // Let the background refresh + HCE sync (real async zone) finish before pumping.
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: p,
      child: MaterialApp(home: Scaffold(body: Builder(builder: (context) => TextButton(
        onPressed: () => runExchange(context, 'ATskEQHiu0JVjK9BNsVmqWIAAAAHarE7gM90i8kUJX1pX0lTwqQ5wgU'),
        child: const Text('go'),
      )))),
    ));
    await tester.tap(find.text('go'));
    await tester.pumpAndSettle();
    expect(api.exchanges.single, startsWith('ATsk'));
    expect(find.byKey(const Key('exchangeResult')), findsOneWidget);
    expect(find.text('Mutual ✓ — they received your card too'), findsOneWidget);
    expect(find.textContaining('Paul Otieno'), findsWidgets);
    expect(find.byKey(const ValueKey('card_split')), findsOneWidget, reason: 'their template layout');

    // Self exchange → message, no sheet.
    Navigator.of(tester.element(find.byKey(const Key('exchangeResult')))).pop();
    await tester.pumpAndSettle();
    api.exchangeError = const ApiException(statusCode: 409, code: 'self_exchange', message: 'x', ref: 'NFC-4201');
    await tester.tap(find.text('go'));
    await tester.pumpAndSettle();
    expect(find.textContaining('That\'s your own card.'), findsOneWidget);
    expect(find.textContaining('NFC-4201'), findsOneWidget);
  });

  testWidgets('editor: edit name + add phone row → Save sends PATCH; preview updates', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    final api = FakePersonalApi();
    final p = buildPersonal(MemorySecureStore(), FakeHce(), api);
    await tester.runAsync(() async {
      await p.init();
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      // Let the background refresh + HCE sync (real async zone) finish before pumping.
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: p,
      child: MaterialApp(home: CardEditorScreen(card: p.primary!, imagePicker: (_, _) async => '/tmp/x.jpg')),
    ));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('editorPreview')), findsOneWidget);

    void tab(int i) => DefaultTabController.of(tester.element(find.byKey(const Key('editorPreview')))).animateTo(i);
    tab(3);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('field_full_name')), 'Jane M.');
    await tester.pump();
    expect(find.descendant(of: find.byKey(const Key('editorPreview')), matching: find.text('Jane M.')), findsOneWidget);

    tab(0);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('template_classic')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('saveCard')));
    await tester.pumpAndSettle();
    final patch = api.patches.single;
    expect((patch['fields'] as Map)['full_name'], 'Jane M.');
    expect(patch['template_id'], 'classic');
    expect(patch['design'], isA<Map>());
    expect(p.primary!.fields.fullName, 'Jane M.');
    expect(find.text('Card saved ✓'), findsOneWidget);

    // Photo upload via the (mocked) picker.
    tab(2);
    await tester.pumpAndSettle();
    await tester.tap(find.descendant(of: find.byKey(const Key('image_photo')), matching: find.byIcon(Icons.add_a_photo_outlined)));
    await tester.pumpAndSettle();
    expect(p.primary!.photoUrl, 'https://img.example/photo.jpg');
  });

  testWidgets('bottom navigation adapts to the spaces set up', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    final store = MemorySecureStore();
    final hce = FakeHce();
    final api = FakePersonalApi();
    final p = buildPersonal(store, hce, api);
    final repo = InMemoryEventRepository();
    final app = AppState(
      credentials: CredentialStore(store),
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      repository: repo,
    );
    await tester.runAsync(() async {
      await app.init();
      await p.init();
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      // Let the background refresh + HCE sync (real async zone) finish before pumping.
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpWidget(NfcTerminalApp(
      appState: app, repository: repo, nfc: FakeNfcService(), personal: p,
      scanner: FakeScanner(() async => throw const ScanException(MobError.notADigitalCard)),
    ));
    await tester.pump(const Duration(milliseconds: 200));
    final nav = find.byKey(const Key('rootNav'));
    expect(find.descendant(of: nav, matching: find.text('My Card')), findsOneWidget);
    expect(find.descendant(of: nav, matching: find.text('Contacts')), findsOneWidget);
    expect(find.descendant(of: nav, matching: find.text('Reader')), findsNothing);
    expect(find.byKey(const Key('sharePanel')), findsOneWidget);
    expect(hce.calls, contains('preferred:true'));

    // Scan role: a non-digital card shows MOB-1022.
    await tester.tap(find.text('Scan a card'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('startScan')));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('MOB-1022'), findsOneWidget);

    // Contacts tab lists contacts.
    await tester.tap(find.descendant(of: nav, matching: find.text('Contacts')));
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Paul Otieno'), findsOneWidget);

    app.onPaused();
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });
}
