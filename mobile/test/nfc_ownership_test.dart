// Regression tests: who owns Android reader mode (terminal reader, card programming, the
// personal "Scan a card" session) across pause/resume and tab switches.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/error_catalog.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/services/digital_card_scanner.dart';
import 'package:nfc_terminal/services/personal_state.dart';
import 'package:nfc_terminal/services/reader_controller.dart';

import 'fakes.dart';
import 'personal_fakes.dart';

/// Records reader-mode calls in order.
class RecordingNfc extends FakeNfcService {
  final log = <String>[];

  @override
  Future<void> startReading({required void Function(CardRead) onCard, required void Function(Object) onError}) async {
    log.add('start');
    await super.startReading(onCard: onCard, onError: onError);
  }

  @override
  Future<void> stopReading() async {
    log.add('stop');
    await super.stopReading();
  }
}

/// A scan that stays pending until cancelled; its cleanup (reader mode off) is logged.
class PendingScanner implements DigitalCardScanner {
  PendingScanner(this.log);
  final List<String> log;
  Completer<String>? _c;
  int scans = 0;

  @override
  Future<String> scanToken({Duration timeout = const Duration(seconds: 60)}) {
    scans++;
    return (_c = Completer<String>()).future;
  }

  @override
  Future<void> cancel() async {
    final c = _c;
    if (c == null || c.isCompleted) return;
    c.completeError(const ScanException(MobError.programmingTimeout));
    await Future<void>.delayed(const Duration(milliseconds: 10));
    log.add('scan-released'); // the real scanner disables reader mode here
  }
}

ReaderController _reader(RecordingNfc nfc) => ReaderController(
  nfc: nfc,
  repository: InMemoryEventRepository(),
  platform: FakePlatformInfo(),
  deliveryProvider: () => null,
  configProvider: () => null,
  haptic: () async {},
);

void main() {
  group('ReaderController.onPaused', () {
    test('does not kill a card-programming session (it owns reader mode)', () async {
      final nfc = RecordingNfc();
      final r = _reader(nfc);
      await r.init();
      await r.pauseForProgramming();
      nfc.log.clear();
      await r.onPaused();
      expect(nfc.log, isEmpty, reason: 'disabling reader mode here would abort the write');
      await r.onResumed();
      expect(nfc.log, isNot(contains('start')), reason: 'still programming');
      await r.resumeAfterProgramming();
      expect(nfc.log.last, 'start');
      r.dispose();
    });

    test('does not kill the personal scanner while suspended; owns it again when active', () async {
      final nfc = RecordingNfc();
      final r = _reader(nfc);
      await r.init();
      await r.suspend();
      nfc.log.clear();
      await r.onPaused();
      expect(nfc.log, isEmpty);
      await r.unsuspend();
      await r.onPaused();
      expect(nfc.log.last, 'stop');
      r.dispose();
    });
  });

  testWidgets('switching to the Reader tab ends a pending personal scan BEFORE the terminal reader starts',
      (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    final store = MemorySecureStore()
      ..values['server_url'] = 'https://api.example.com'
      ..values['device_token'] = 'nfcd_test';
    final repo = InMemoryEventRepository();
    final app = AppState(
      credentials: CredentialStore(store),
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      repository: repo,
      apiFactory: (_, _, _) => FakeDeviceApi(),
    );
    final api = FakePersonalApi();
    final hce = FakeHce();
    final p = PersonalState(
      store: store,
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      hce: hce,
      apiFactory: (_, token, _) => api..sessionToken = token,
    );
    await tester.runAsync(() async {
      await app.init();
      await p.init();
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    final nfc = RecordingNfc();
    final scanner = PendingScanner(nfc.log);
    await tester.pumpWidget(NfcTerminalApp(appState: app, repository: repo, nfc: nfc, personal: p, scanner: scanner));
    await tester.pump(const Duration(milliseconds: 300));

    await tester.tap(find.text('Scan a card'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.byKey(const Key('startScan')));
    await tester.pump(const Duration(milliseconds: 50));
    expect(scanner.scans, 1);
    nfc.log.clear();

    final nav = find.byKey(const Key('rootNav'));
    await tester.tap(find.descendant(of: nav, matching: find.text('Reader')));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
    expect(nfc.log, ['scan-released', 'start'], reason: 'the scan cleanup must not run after the reader started');

    // Signing out of My Card while a scan runs disposes My Card cleanly (no provider lookup in
    // dispose) and gives up the preferred-HCE request; the terminal keeps working.
    await tester.tap(find.descendant(of: nav, matching: find.text('My Card')));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byKey(const Key('startScan')));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.runAsync(() => p.signOut());
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.takeException(), isNull);
    expect(hce.calls.last, anyOf('preferred:false', 'clear', 'enabled:false'));
    expect(hce.calls, contains('preferred:false'));
    expect(app.phase, AppPhase.ready);
    expect(find.descendant(of: nav, matching: find.text('Reader')), findsOneWidget);

    app.onPaused();
    app.dispose();
    await tester.pumpWidget(const SizedBox());
  });
}
