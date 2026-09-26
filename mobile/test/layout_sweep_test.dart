// Small-screen / large-text sweep: every main screen at 320×568 dp with a 1.3× text scale,
// light and dark, must lay out without RenderFlex overflows or other exceptions.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/error_catalog.dart';
import 'package:nfc_terminal/core/pairing.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/services/digital_card_scanner.dart';
import 'package:nfc_terminal/services/personal_state.dart';
import 'package:nfc_terminal/ui/personal/activity_screen.dart';
import 'package:nfc_terminal/ui/personal/card_editor_screen.dart';
import 'package:nfc_terminal/ui/personal/contact_detail_screen.dart';
import 'package:nfc_terminal/ui/personal/invites_screen.dart';
import 'package:nfc_terminal/ui/personal/exchange_flow.dart';
import 'package:nfc_terminal/ui/personal/personal_auth_screen.dart';
import 'package:nfc_terminal/ui/personal/personal_settings_screen.dart';
import 'package:nfc_terminal/ui/personal/qr_share_screen.dart';
import 'package:nfc_terminal/ui/screens/pair_confirm_screen.dart';
import 'package:nfc_terminal/ui/screens/settings_screen.dart';
import 'package:nfc_terminal/ui/screens/setup_screen.dart';

import 'fakes.dart';
import 'personal_fakes.dart';
import 'personal_fixtures.dart';

Future<(AppState, PersonalState, InMemoryEventRepository)> _spaces(WidgetTester tester,
    {bool terminal = true, bool personal = true, List<DigitalCard>? cards}) async {
  final store = MemorySecureStore();
  if (terminal) {
    store.values['server_url'] = 'https://api.example.com';
    store.values['device_token'] = 'nfcd_test';
  }
  final repo = InMemoryEventRepository();
  final app = AppState(
    credentials: CredentialStore(store),
    httpClient: MockClient((_) async => http.Response('', 404)),
    platform: FakePlatformInfo(),
    repository: repo,
    apiFactory: (_, _, _) => FakeDeviceApi(),
  );
  final api = FakePersonalApi();
  if (cards != null) api.serverCards = cards;
  final p = PersonalState(
    store: store,
    httpClient: MockClient((_) async => http.Response('', 404)),
    platform: FakePlatformInfo(),
    hce: FakeHce(),
    assetLoader: (path) => File(path).readAsString(),
    apiFactory: (_, token, _) => api..sessionToken = token,
  );
  await tester.runAsync(() async {
    await app.init();
    await p.init();
    await p.designDataReady;
    if (personal) await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
    await Future<void>.delayed(const Duration(milliseconds: 50));
  });
  return (app, p, repo);
}

void main() {
  for (final dark in [false, true]) {
    testWidgets('320dp @1.3x text (${dark ? 'dark' : 'light'}): all tabs and main screens lay out', (tester) async {
      tester.view.physicalSize = const Size(640, 1136);
      tester.view.devicePixelRatio = 2;
      tester.platformDispatcher.textScaleFactorTestValue = 1.3;
      tester.platformDispatcher.platformBrightnessTestValue = dark ? Brightness.dark : Brightness.light;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearAllTestValues);

      final (app, p, repo) = await _spaces(tester);
      await tester.pumpWidget(NfcTerminalApp(
        appState: app, repository: repo, nfc: FakeNfcService(), personal: p,
        scanner: FakeScanner(() async => throw const ScanException(MobError.notADigitalCard)),
      ));
      await tester.pump(const Duration(milliseconds: 300));
      expect(tester.takeException(), isNull);

      final nav = find.byKey(const Key('rootNav'));
      for (final tab in ['Contacts', 'Reader', 'History', 'Settings', 'My Card']) {
        await tester.tap(find.descendant(of: nav, matching: find.text(tab)));
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.takeException(), isNull, reason: tab);
      }
      await tester.tap(find.text('Scan a card'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(tester.takeException(), isNull, reason: 'scan panel');

      final ctx = tester.element(nav);
      final card = p.primary!;
      final pages = <String, Widget>{
        'terminal settings': const SettingsScreen(),
        'setup': const SetupScreen(),
        'pair confirm': PairConfirmScreen(
          pairing: PairingPayload.parse(
              'nfcterminal://pair?v=1&server=https%3A%2F%2Fa-rather-long-server-name.example.com&code=nfcp_abcdefghijklmnopqrstuvwx'),
        ),
        'contact detail': ContactDetailScreen(
          contact: Contact.fromJson({'id': 'c', 'source': 'nfc_exchange', 'card': cardJson(name: 'A Very Long Person Name Indeed'),
            'tags': ['conference-2026', 'follow-up'], 'met_at': '2026-09-25T10:00:00Z', 'live': true}),
        ),
        'invites': const InvitesScreen(),
        'activity': const ActivityScreen(),
        'personal auth': const PersonalAuthScreen(),
        'personal settings': const PersonalSettingsScreen(),
        'editor': CardEditorScreen(card: card),
        'qr share': QrShareScreen(card: card),
        'exchange result': Scaffold(
          body: ExchangeResultSheet(
            result: ExchangeResult(
              contact: Contact.fromJson({'id': 'c', 'source': 'nfc_exchange', 'card': cardJson(name: 'A Very Long Person Name Indeed')}),
              mutual: true,
              alreadyConnected: false,
            ),
            layout: 'centered',
          ),
        ),
      };
      for (final e in pages.entries) {
        Navigator.of(ctx).push(MaterialPageRoute<void>(builder: (_) => e.value));
        await tester.pump(const Duration(milliseconds: 500));
        await tester.pump(const Duration(milliseconds: 500));
        expect(tester.takeException(), isNull, reason: e.key);
        Navigator.of(ctx).pop();
        await tester.pump(const Duration(milliseconds: 500));
      }

      app.onPaused();
      app.dispose();
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('320dp @1.3x text (${dark ? 'dark' : 'light'}): welcome screen lays out', (tester) async {
      tester.view.physicalSize = const Size(640, 1136);
      tester.view.devicePixelRatio = 2;
      tester.platformDispatcher.textScaleFactorTestValue = 1.3;
      tester.platformDispatcher.platformBrightnessTestValue = dark ? Brightness.dark : Brightness.light;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      final (app, p, repo) = await _spaces(tester, terminal: false, personal: false);
      await tester.pumpWidget(NfcTerminalApp(appState: app, repository: repo, nfc: FakeNfcService(), personal: p));
      await tester.pump(const Duration(milliseconds: 300));
      expect(tester.takeException(), isNull);
      app.dispose();
      await tester.pumpWidget(const SizedBox());
    });
  }

  for (final dark in [false, true]) {
    for (final template in ['diagonal_crimson', 'badge_wave']) {
      testWidgets('320dp @1.3x (${dark ? 'dark' : 'light'}): v2 card $template — My Card + every editor tab', (tester) async {
        tester.view.physicalSize = const Size(640, 1136);
        tester.view.devicePixelRatio = 2;
        tester.platformDispatcher.textScaleFactorTestValue = 1.3;
        tester.platformDispatcher.platformBrightnessTestValue = dark ? Brightness.dark : Brightness.light;
        addTearDown(tester.view.reset);
        addTearDown(tester.platformDispatcher.clearAllTestValues);
        final (app, p, repo) = await _spaces(tester, terminal: false, cards: [v2Card(template)]);
        await tester.pumpWidget(NfcTerminalApp(appState: app, repository: repo, nfc: FakeNfcService(), personal: p));
        await tester.pump(const Duration(milliseconds: 400));
        expect(tester.takeException(), isNull, reason: 'my card');
        final ctx = tester.element(find.byKey(const Key('rootNav')));
        Navigator.of(ctx).push(MaterialPageRoute<void>(builder: (_) => CardEditorScreen(card: p.primary!)));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 600));
        expect(tester.takeException(), isNull, reason: 'editor');
        final tabs = DefaultTabController.of(tester.element(find.byKey(const Key('editorPreview'), skipOffstage: false)));
        for (var i = 0; i < 7; i++) {
          tabs.animateTo(i);
          await tester.pump(const Duration(milliseconds: 400));
          await tester.pump(const Duration(milliseconds: 400));
          expect(tester.takeException(), isNull, reason: 'editor tab $i');
          if (i == 0) {
            for (final cat in ['badge', 'minimal', 'classic', 'business']) {
              await tester.ensureVisible(find.byKey(Key('cat_$cat'), skipOffstage: false));
              await tester.pump();
              await tester.tap(find.byKey(Key('cat_$cat')));
              await tester.pump(const Duration(milliseconds: 300));
              expect(tester.takeException(), isNull, reason: 'gallery $cat');
            }
          }
        }
        app.dispose();
        await tester.pumpWidget(const SizedBox());
      });
    }
  }
}
