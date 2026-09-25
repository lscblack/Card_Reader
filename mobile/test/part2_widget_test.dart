import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'dart:convert';

import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/error_catalog.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/services/app_state.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/business.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/services/card_programmer.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/nfc_writer.dart';
import 'package:nfc_terminal/services/reader_controller.dart';
import 'package:nfc_terminal/ui/screens/program_card_screen.dart';
import 'package:nfc_terminal/ui/theme.dart';
import 'package:nfc_terminal/ui/widgets/business_result.dart';
import 'package:nfc_terminal/ui/widgets/register_card_sheet.dart';

import 'fakes.dart';
import 'part2_test.dart' show FakeNfcWriter, businessConfig, part1Config, recognizedJson, unknownJson;

Widget _wrap(Widget child) => MaterialApp(theme: AppTheme.light(), home: Scaffold(body: child));

void main() {
  testWidgets('recognized result: message, green status, Open button for https', (tester) async {
    await tester.pumpWidget(_wrap(BusinessResultCard(result: BusinessResult.fromJson(Map.of(recognizedJson)))));
    expect(find.text('John Doe · Sales Manager'), findsOneWidget);
    expect(find.textContaining('Recognized'), findsOneWidget);
    expect(find.textContaining('John badge (card)'), findsOneWidget);
    expect(find.byKey(const Key('openActionButton')), findsOneWidget);
    expect(find.text('Open profile'), findsOneWidget);
    expect(find.byKey(const Key('registerCardButton')), findsNothing);
    final ctx = tester.element(find.byKey(const Key('businessResult')));
    expect(businessResultColor(ctx, BusinessResult.fromJson(Map.of(recognizedJson))), StatusColors.success(ctx));
  });

  testWidgets('unsafe action URL → no Open button; inactive is amber', (tester) async {
    final json = {...recognizedJson, 'result': 'inactive', 'action': {'type': 'x', 'label': 'Go', 'url': 'javascript:alert(1)'}};
    final r = BusinessResult.fromJson(json);
    await tester.pumpWidget(_wrap(BusinessResultCard(result: r)));
    expect(find.byKey(const Key('openActionButton')), findsNothing);
    expect(find.textContaining('Inactive'), findsOneWidget);
    final ctx = tester.element(find.byKey(const Key('businessResult')));
    expect(businessResultColor(ctx, r), StatusColors.warning(ctx));
  });

  testWidgets('unknown card: Register button only when allowed', (tester) async {
    var tapped = false;
    final r = BusinessResult.fromJson(Map.of(unknownJson));
    await tester.pumpWidget(_wrap(BusinessResultCard(result: r, onRegister: () => tapped = true)));
    expect(find.textContaining('Unknown card'), findsWidgets);
    await tester.tap(find.byKey(const Key('registerCardButton')));
    expect(tapped, isTrue);

    await tester.pumpWidget(_wrap(BusinessResultCard(result: r)));
    expect(find.byKey(const Key('registerCardButton')), findsNothing);
  });

  testWidgets('register sheet: 409 card_uid_exists shows message + ref, then success pops true', (tester) async {
    final api = FakeDeviceApi()
      ..registerError = const ApiException(
        statusCode: 409, code: 'card_uid_exists', message: 'exists', ref: 'NFC-6021', requestId: 'rq7');
    bool? result;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () async => result = await showRegisterCardSheet(context, api: api, uid: '04A1B2C3'),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('UID 04:A1:B2:C3'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('registerCardName')), 'Table 4');
    await tester.tap(find.text('Tag'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('registerCardSubmit')));
    await tester.pumpAndSettle();
    expect(find.text('This card is already registered in your business.'), findsOneWidget);
    expect(find.text('NFC-6021 · rq7'), findsOneWidget);

    api.registerError = null;
    await tester.tap(find.byKey(const Key('registerCardSubmit')));
    await tester.pumpAndSettle();
    expect(result, isTrue);
    expect(api.registered.single, {'uid': '04A1B2C3', 'name': 'Table 4', 'kind': 'tag'});
  });

  group('program screens', () {
    late FakeDeviceApi api;
    late ReaderController reader;

    setUp(() async {
      api = FakeDeviceApi()
        ..cards = const [
          BusinessCardItem(id: 'c1', name: 'Table 4', kind: 'tag', tapUrl: 'https://x/t/AAA', programmed: false),
          BusinessCardItem(id: 'c2', name: 'John badge', kind: 'card', assigneeName: 'John Doe',
              tapUrl: 'https://x/t/BBB', programmed: true),
        ];
      final repo = InMemoryEventRepository();
      reader = ReaderController(
        nfc: FakeNfcService(), repository: repo, platform: FakePlatformInfo(),
        deliveryProvider: () => DeliveryService(api: api, httpClient: MockClient((_) async => http.Response('', 200)), repository: repo),
        configProvider: () => DeviceConfig.fromJson(businessConfig()), haptic: () async {});
    });

    testWidgets('list shows unprogrammed by default; writing succeeds', (tester) async {
      final writer = FakeNfcWriter((_) async => '04AABB');
      await tester.pumpWidget(MaterialApp(
        home: ProgramCardScreen(api: api, programmer: CardProgrammer(writer: writer, api: api, reader: reader)),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Table 4'), findsOneWidget);
      expect(find.text('John badge'), findsNothing);
      await tester.tap(find.byKey(const Key('unprogrammedOnly')));
      await tester.pumpAndSettle();
      expect(find.text('John badge'), findsOneWidget);

      await tester.tap(find.text('Table 4'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('programSuccess')), findsOneWidget);
      expect(writer.uris.single, 'https://x/t/AAA');
      expect(api.programmed.single, {'id': 'c1', 'uid': '04AABB'});
    });

    testWidgets('failure shows the MOB message and ref', (tester) async {
      final writer = FakeNfcWriter((_) async => throw const NfcWriteException(MobError.tagTooSmall));
      await tester.pumpWidget(MaterialApp(
        home: ProgramWriteScreen(card: api.cards.first, programmer: CardProgrammer(writer: writer, api: api, reader: reader)),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Programming failed'), findsOneWidget);
      expect(find.textContaining('Card memory too small'), findsOneWidget);
      expect(find.text('MOB-1015'), findsOneWidget);
      expect(api.programmed, isEmpty);
    });

    testWidgets('waiting state tells the user to hold the card', (tester) async {
      final gate = Completer<String>();
      final writer = FakeNfcWriter((_) => gate.future);
      await tester.pumpWidget(MaterialApp(
        home: ProgramWriteScreen(card: api.cards.first, programmer: CardProgrammer(writer: writer, api: api, reader: reader)),
      ));
      await tester.pump();
      expect(find.text('Hold the card to the phone'), findsOneWidget);
      expect(reader.programming, isTrue);
      gate.complete('04CC');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('programSuccess')), findsOneWidget);
      expect(reader.programming, isFalse);
    });
  });

  for (final business in [true, false]) {
    testWidgets('reader screen: ${business ? 'business branding + program action' : 'developer unchanged'}',
        (tester) async {
      final cfg = business ? businessConfig() : part1Config();
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

      expect(find.byKey(const Key('businessBranding')), business ? findsOneWidget : findsNothing);
      expect(find.text('Acme Café'), business ? findsOneWidget : findsNothing);
      expect(find.text('Reader'), business ? findsOneWidget /* nav label */ : findsNWidgets(2));
      expect(find.byKey(const Key('programCardAction')), business ? findsOneWidget : findsNothing);

      app.onPaused(); // stop periodic sync/heartbeat timers
      await tester.pumpWidget(const SizedBox());
    });
  }
}
