import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/error_catalog.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/business.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/services/card_programmer.dart';
import 'package:nfc_terminal/services/card_registrar.dart';
import 'package:nfc_terminal/services/nfc_writer.dart';
import 'package:nfc_terminal/services/reader_controller.dart';
import 'package:nfc_terminal/ui/screens/register_cards_screen.dart';
import 'package:nfc_terminal/ui/widgets/business_result.dart';

import 'fakes.dart';
import 'part2_test.dart' show businessConfig, part1Config, FakeNfcWriter;

CardRead tap(String uid) => CardRead(uid: uid, technologies: const ['NfcA'], type: CardType.unknown, detectedAt: DateTime.now().toUtc());

void main() {
  late FakeDeviceApi api;
  late FakeNfcService nfc;
  late InMemoryEventRepository repo;
  late ReaderController reader;

  setUp(() async {
    api = FakeDeviceApi();
    nfc = FakeNfcService();
    repo = InMemoryEventRepository();
    reader = ReaderController(
      nfc: nfc,
      repository: repo,
      platform: FakePlatformInfo(),
      deliveryProvider: () => null,
      configProvider: () => null,
      haptic: () async {},
    );
    await reader.init();
  });

  CardRegistrar registrar({FakeNfcWriter? writer}) => CardRegistrar(
    api: api,
    nfc: nfc,
    reader: reader,
    businessName: 'Acme Café',
    programmer: writer == null ? null : CardProgrammer(writer: writer, api: api, reader: reader),
    haptic: () async {},
  );

  group('CardRegistrar', () {
    test('delivery is paused in the mode (taps and dispatched tags are not events) and resumes after', () async {
      final r = registrar();
      await r.start();
      expect(reader.programming, isTrue);
      expect(nfc.onCard, isNotNull, reason: 'the mode reads cards itself');
      expect(await reader.handleCard(tap('04AA0001')), isNull, reason: 'a dispatched tag is not delivered');
      nfc.onCard!(tap('04AA0002'));
      await Future<void>.delayed(Duration.zero);
      expect(repo.rows, isEmpty);
      await r.stop();
      expect(reader.programming, isFalse);
      expect(await reader.handleCard(tap('04AA0003')), isNotNull);
      expect(repo.rows, hasLength(1));
    });

    test('register flow: auto-increment names per kind, kind + owner remembered, note sent', () async {
      final r = registrar();
      await r.start();
      await r.onTap(tap('04AA0001'));
      expect(r.phase, RegisterPhase.sheet);
      expect(r.suggestedName('card'), 'Card 1');
      expect(await r.submit(name: r.suggestedName('card'), kind: 'card', assignToBusiness: true, note: 'Front desk'), isNull);
      expect(r.phase, RegisterPhase.success);
      expect(r.last!.item.name, 'Card 1');
      expect(api.registeredOptions.single, {'assign_to_business': true, 'note': 'Front desk'});

      await r.onTap(tap('04AA0002'));
      expect(r.suggestedName('card'), 'Card 2');
      expect(r.suggestedName('tag'), 'Tag 1');
      await r.submit(name: 'Tag 1', kind: 'tag', assignToBusiness: false);
      expect(r.kind, 'tag');
      expect(r.assignToBusiness, isFalse);
      await r.onTap(tap('04AA0003'));
      expect(r.suggestedName(r.kind), 'Tag 2');
      await r.submit(name: '', kind: r.kind, assignToBusiness: r.assignToBusiness);
      expect(api.registered.map((e) => e['name']), ['Card 1', 'Tag 1', 'Tag 2'], reason: 'empty name → suggestion');
      expect(r.registered.map((e) => e.item.name), ['Tag 2', 'Tag 1', 'Card 1']);
      await r.stop();
    });

    test('already registered: 409 → "as <name>" (masked UID lookup), no error; this session\'s cards too', () async {
      final r = registrar();
      await r.start();
      api.cards = [const BusinessCardItem(id: 'c9', name: 'John badge', kind: 'card', uidMasked: '••••0009', tapUrl: 't', programmed: true)];
      api.registerError = const ApiException(statusCode: 409, code: 'card_uid_exists', message: 'exists', ref: 'NFC-6004');
      await r.onTap(tap('04AA0009'));
      expect(await r.submit(name: 'Card 1', kind: 'card', assignToBusiness: true), isNull);
      expect(r.phase, RegisterPhase.already);
      expect(r.alreadyName, 'John badge');
      expect(r.registered, isEmpty);
      expect(r.suggestedName('card'), 'Card 1', reason: 'no number consumed');

      api.registerError = null;
      await r.onTap(tap('04AA0010'));
      await r.submit(name: 'Card 1', kind: 'card', assignToBusiness: true);
      final calls = api.registered.length;
      await Future<void>.delayed(const Duration(milliseconds: 1600)); // past the debounce window
      await r.onTap(tap('04AA0010'));
      expect(r.phase, RegisterPhase.already);
      expect(r.alreadyName, 'Card 1');
      expect(api.registered.length, calls, reason: 'no second POST');
      await r.stop();
    });

    test('optional write: the tap link is written to the same card and reported as programmed', () async {
      final writer = FakeNfcWriter((_) async => '04AA0001');
      final r = registrar(writer: writer)..writeLink = true;
      await r.start();
      await r.onTap(tap('04AA0001'));
      await r.submit(name: 'Card 1', kind: 'card', assignToBusiness: true);
      expect(writer.uris, ['https://t.example/c/new1']);
      expect(writer.expected, ['04AA0001'], reason: 'only the registered card may be written');
      expect(api.programmed.single, {'id': 'new1', 'uid': '04AA0001'});
      expect(r.last!.programmed, isTrue);
      expect(reader.programming, isTrue, reason: 'still in the mode after writing');
      expect(nfc.onCard, isNotNull, reason: 'listening again for the next card');

      // Another card held instead: nothing written, registration kept, error shown.
      writer.onWrite = (_) async => throw const NfcWriteException(MobError.wrongCard);
      await r.onTap(tap('04AA0002'));
      await r.submit(name: 'Card 2', kind: 'card', assignToBusiness: true);
      expect(r.registered, hasLength(2));
      expect(r.last!.programmed, isFalse);
      expect(r.last!.writeError!.ref, 'MOB-1027');
      await r.stop();
    });

    test('writing is off by default and unavailable without cards.program', () {
      expect(registrar().canProgram, isFalse);
      expect(registrar(writer: FakeNfcWriter((_) async => 'x')).writeLink, isFalse);
    });
  });

  group('screens', () {
    testWidgets('register mode: sheet prefilled, kind switch renames, owner default company, success + next', (tester) async {
      final r = registrar();
      await tester.pumpWidget(MaterialApp(home: RegisterCardsScreen(registrar: r)));
      await tester.pump();
      expect(find.text('Tap a card to register it'), findsOneWidget);

      nfc.onCard!(tap('04AA0001'));
      await tester.pumpAndSettle();
      final name = tester.widget<TextField>(find.byKey(const Key('registerCardName')));
      expect(name.controller!.text, 'Card 1');
      expect(find.text('Company (Acme Café)'), findsOneWidget);
      await tester.tap(find.text('Tag'));
      await tester.pump();
      expect(tester.widget<TextField>(find.byKey(const Key('registerCardName'))).controller!.text, 'Tag 1');
      await tester.tap(find.byKey(const Key('registerCardSubmit')));
      await tester.pumpAndSettle();
      expect(find.text('Registered · Tag 1'), findsOneWidget);
      expect(find.byKey(const Key('tapNext')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('registeredCount')), matching: find.text('1')), findsOneWidget);
      expect(api.registeredOptions.single['assign_to_business'], isTrue);

      // Next tap: kind remembered, owner changed to unassigned is remembered after.
      nfc.onCard!(tap('04AA0002'));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byKey(const Key('registerCardName'))).controller!.text, 'Tag 2');
      await tester.tap(find.byKey(const Key('ownerUnassigned')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('registerCardSubmit')));
      await tester.pumpAndSettle();
      expect(api.registeredOptions.last['assign_to_business'], isFalse);
      expect(r.assignToBusiness, isFalse);

      // Dismissing the sheet goes back to waiting; leaving resumes delivery.
      nfc.onCard!(tap('04AA0003'));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(r.phase, RegisterPhase.waiting);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
      expect(reader.programming, isFalse);
    });

    testWidgets('company card result shows the business with a "Company card" label', (tester) async {
      final b = BusinessResult.fromJson({
        'result': 'recognized',
        'card': {'id': 'c1', 'name': 'Front door', 'kind': 'tag', 'status': 'active'},
        'assignee': {'type': 'business', 'name': 'Acme Café', 'photo_url': null},
        'message': 'Acme Café',
      });
      expect(b.isCompanyCard, isTrue);
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: BusinessResultCard(result: b))));
      expect(find.byKey(const Key('companyCard')), findsOneWidget);
      expect(find.textContaining('Company card'), findsWidgets);
    });

    for (final (label, cfg, visible) in [
      ('business with cards.register', businessConfig(), true),
      ('business without it', businessConfig(caps: const ['cards.program']), false),
      ('developer', part1Config(), false),
    ]) {
      testWidgets('Reader entry point: $label', (tester) async {
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
        await tester.pumpWidget(NfcTerminalApp(appState: app, repository: repo, nfc: FakeNfcService()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byKey(const Key('registerCardsAction')), visible ? findsOneWidget : findsNothing);
        app.onPaused();
        await tester.pumpWidget(const SizedBox());
      });
    }
  });
}
