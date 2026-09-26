import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/config.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/core/tap_links.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/services/guest_tap.dart';

import 'fakes.dart';
import 'part2_test.dart' show part1Config;

class FakeGuestTap implements GuestTapReader {
  void Function(GuestTag)? onTag;
  int starts = 0, stops = 0;

  @override
  Future<bool> start(void Function(GuestTag tag) onTag) async {
    starts++;
    this.onTag = onTag;
    return true;
  }

  @override
  Future<void> stop() async {
    stops++;
    onTag = null;
  }
}

/// The ripple animates forever while reading: pump frames instead of settling.
Future<void> frames(WidgetTester tester, [int n = 6]) async {
  for (var i = 0; i < n; i++) {
    await tester.pump(const Duration(milliseconds: 200));
  }
}

void main() {
  final server = Uri.parse(AppConfig.defaultServerUrl);
  final base = '${server.scheme}://${server.host}${server.hasPort ? ':${server.port}' : ''}';

  group('tap links', () {
    const known = ['https://api.nextap.example', null];

    test('nexTap tap links: /t/{8–16 url-safe chars}, http(s) only, trusted by host (port ignored)', () {
      final t = classifyTapLink('https://api.nextap.example/t/Ab3_x-9Z', known)!;
      expect(t.kind, TapLinkKind.tap);
      expect(t.trusted, isTrue);
      expect(t.autoOpen, isTrue);
      expect(classifyTapLink('https://api.nextap.example:8443/t/Ab3_x-9Zq1', known)!.autoOpen, isTrue);
      expect(classifyTapLink('https://api.nextap.example/t/short7x', known)!.kind, TapLinkKind.other);
      expect(classifyTapLink('https://api.nextap.example/t/${'a' * 17}', known)!.kind, TapLinkKind.other);
      expect(classifyTapLink('https://api.nextap.example/t/abc.defgh', known)!.kind, TapLinkKind.other);
      final foreign = classifyTapLink('https://evil.example/t/Ab3_x-9Z', known)!;
      expect(foreign.kind, TapLinkKind.tap);
      expect(foreign.autoOpen, isFalse, reason: 'unknown host → confirm first');
      expect(classifyTapLink('https://user:pw@api.nextap.example/t/Ab3_x-9Z', known)!.autoOpen, isFalse);
      expect(classifyTapLink('ftp://api.nextap.example/t/Ab3_x-9Z', known)!.kind, TapLinkKind.other);
      expect(classifyTapLink('', known), isNull);
    });

    test('digital-card pages /p/{slug} (phones sharing a card) open like tap links', () {
      final p = classifyTapLink('https://api.nextap.example/p/jane-doe?via=nfc', known)!;
      expect(p.kind, TapLinkKind.card);
      expect(p.autoOpen, isTrue);
      expect(classifyTapLink('https://api.nextap.example/p/jane/extra', known)!.kind, TapLinkKind.other);
    });

    test('NDEF URI records (RTD-U prefixes, absolute URI) and link choice', () {
      final payload = [0x04, ...utf8.encode('api.nextap.example/t/Ab3_x-9Z')];
      expect(ndefRecordUri(1, [0x55], payload), 'https://api.nextap.example/t/Ab3_x-9Z');
      expect(ndefRecordUri(3, utf8.encode('https://x.example/'), const []), 'https://x.example/');
      expect(ndefRecordUri(1, [0x54], payload), isNull, reason: 'text record');
      final pick = pickTapLink(['https://shop.example/', 'https://api.nextap.example/t/Ab3_x-9Z'], known)!;
      expect(pick.kind, TapLinkKind.tap);
      expect(pickTapLink(const [], known), isNull);
    });
  });

  group('guest flow (not a terminal)', () {
    Future<(FakeGuestTap, List<Uri>)> open(WidgetTester tester) async {
      final repo = InMemoryEventRepository();
      final app = AppState(
        credentials: CredentialStore(MemorySecureStore()),
        httpClient: MockClient((_) async => http.Response('', 404)),
        platform: FakePlatformInfo(),
        repository: repo,
      );
      await tester.runAsync(app.init);
      final guest = FakeGuestTap();
      final opened = <Uri>[];
      await tester.pumpWidget(NfcTerminalApp(
        appState: app,
        repository: repo,
        nfc: FakeNfcService(),
        guestTap: guest,
        linkOpener: (u) async {
          opened.add(u);
          return true;
        },
      ));
      await frames(tester);
      addTearDown(() async {
        app.dispose();
        await tester.pumpWidget(const SizedBox());
      });
      return (guest, opened);
    }

    testWidgets('welcome reads cards: a tap link on the default server opens right away (no sign-in)', (tester) async {
      final (guest, opened) = await open(tester);
      expect(find.byKey(const Key('tapACard')), findsOneWidget);
      expect(guest.starts, 1);
      guest.onTag!(GuestTag(uid: '04A1B2C3D4', uris: ['$base/t/Ab3_x-9Z'], hasNdef: true));
      await frames(tester);
      expect(opened.single.toString(), '$base/t/Ab3_x-9Z');
      expect(find.byKey(const Key('guestTitle')), findsNothing, reason: 'sheet closes after opening');
    });

    testWidgets('unprogrammed tag: "isn\'t set up yet" with its UID, no error styling, nothing opened', (tester) async {
      final (guest, opened) = await open(tester);
      guest.onTag!(const GuestTag(uid: '04A1B2C3D4'));
      await frames(tester);
      expect(find.byKey(const Key('guestNotSetUp')), findsOneWidget);
      expect(find.text('This card isn\'t set up yet'), findsOneWidget);
      expect(find.textContaining('04:A1:B2:C3:D4'), findsOneWidget);
      expect(opened, isEmpty);
    });

    testWidgets('other hosts and other links are shown with an Open button, never auto-opened', (tester) async {
      final (guest, opened) = await open(tester);
      guest.onTag!(const GuestTag(uid: '04A1B2C3D4', uris: ['https://evil.example/t/Ab3_x-9Z'], hasNdef: true));
      await frames(tester);
      expect(opened, isEmpty);
      expect(find.byKey(const Key('guestWarning')), findsOneWidget);
      expect(find.text('evil.example'), findsOneWidget);
      await tester.tap(find.byKey(const Key('guestOpen')));
      await frames(tester);
      expect(opened.single.host, 'evil.example');

      guest.onTag!(const GuestTag(uid: '04FFFFFFFF', uris: ['https://shop.example/menu'], hasNdef: true));
      await frames(tester);
      expect(opened, hasLength(1));
      expect(find.text('This card contains a link'), findsOneWidget);
    });

    testWidgets('setup screen keeps guest reading on (topmost screen gets the tap)', (tester) async {
      final (guest, opened) = await open(tester);
      await tester.tap(find.byKey(const Key('chooseTerminal')));
      await frames(tester);
      guest.onTag!(GuestTag(uid: '04A1B2C3D4', uris: ['$base/p/jane'], hasNdef: true));
      await frames(tester);
      expect(opened.single.path, '/p/jane');
      expect(guest.starts, 1, reason: 'one reader session for both screens');
    });
  });

  testWidgets('registered terminals: no guest reading, taps stay events (unchanged)', (tester) async {
    final cfg = part1Config();
    final repo = InMemoryEventRepository();
    final app = AppState(
      credentials: CredentialStore(MemorySecureStore()),
      httpClient: MockClient((req) async {
        if (req.url.path.endsWith('/device/register')) {
          return http.Response.bytes(utf8.encode(jsonEncode({'device': {}, 'device_token': 'nfcd_t', 'config': cfg})), 201);
        }
        if (req.url.path.endsWith('/device/config')) return http.Response.bytes(utf8.encode(jsonEncode(cfg)), 200);
        return http.Response(jsonEncode({'status': 'active'}), 200);
      }),
      platform: FakePlatformInfo(),
      repository: repo,
    );
    await tester.runAsync(() async {
      await app.init();
      await app.register(serverUrl: 'https://api.example.com', apiKey: 'nfc_k', deviceName: 'x');
    });
    final guest = FakeGuestTap();
    final nfc = FakeNfcService();
    await tester.pumpWidget(NfcTerminalApp(appState: app, repository: repo, nfc: nfc, guestTap: guest));
    await tester.pump(const Duration(milliseconds: 300));
    expect(guest.starts, 0);
    expect(nfc.onCard, isNotNull, reason: 'the terminal reader owns NFC');
    app.onPaused();
    await tester.pumpWidget(const SizedBox());
  });
}
