import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/guest_tap.dart';
import 'package:nfc_terminal/ui/widgets/guest_tap.dart';
import 'package:nfc_terminal/ui/widgets/register_chip.dart';

import 'fakes.dart';

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child)));

Widget _sheet(GuestChipRegistrar? registrar) => _host(GuestTagSheet(
  tag: const GuestTag(uid: '04A1B2C3D4E5F6'),
  link: null,
  opener: (_) async => true,
  chipRegistrar: registrar,
));

Future<void> _name(WidgetTester tester, String name) async {
  await tester.enterText(find.byKey(const Key('cardNameField')), name);
  await tester.tap(find.byKey(const Key('confirmRegisterCard')));
  await tester.pumpAndSettle();
}

void main() {
  group('personal: "Register as my card" on a card nobody set up', () {
    testWidgets('signed in: registers the chip to the digital card', (tester) async {
      final calls = <(String, String?)>[];
      await tester.pumpWidget(_sheet(GuestChipRegistrar(
        available: () => true,
        register: (uid, label) async => calls.add((uid, label)),
      )));
      expect(find.textContaining('Make it yours'), findsOneWidget);
      await tester.tap(find.byKey(const Key('registerChipButton')));
      await tester.pumpAndSettle();
      await _name(tester, 'Blue card');

      expect(calls, [('04A1B2C3D4E5F6', 'Blue card')]);
      expect(find.text('Registered to your digital card'), findsOneWidget);
      expect(find.byKey(const Key('registerChipButton')), findsNothing);
    });

    testWidgets('no name typed: the server picks one', (tester) async {
      final calls = <(String, String?)>[];
      await tester.pumpWidget(_sheet(GuestChipRegistrar(
        available: () => true,
        register: (uid, label) async => calls.add((uid, label)),
      )));
      await tester.tap(find.byKey(const Key('registerChipButton')));
      await tester.pumpAndSettle();
      await _name(tester, '');
      expect(calls, [('04A1B2C3D4E5F6', null)]);
    });

    testWidgets('card owned by someone else: explains, stays unregistered', (tester) async {
      await tester.pumpWidget(_sheet(GuestChipRegistrar(
        available: () => true,
        register: (_, _) async => throw const ApiException(statusCode: 409, code: 'card_uid_taken', message: 'taken'),
      )));
      await tester.tap(find.byKey(const Key('registerChipButton')));
      await tester.pumpAndSettle();
      await _name(tester, '');
      expect(find.byKey(const Key('registerChipError')), findsOneWidget);
      expect(find.textContaining('already registered to another account'), findsOneWidget);
      expect(find.byKey(const Key('registerChipButton')), findsOneWidget, reason: 'can try again');
    });

    testWidgets('not signed in to My Card: no button, business hint as before', (tester) async {
      await tester.pumpWidget(_sheet(GuestChipRegistrar(available: () => false, register: (_, _) async {})));
      expect(find.byKey(const Key('registerChipButton')), findsNothing);
      expect(find.text('Ask the business to register it with nexTap.'), findsOneWidget);
      await tester.pumpWidget(_sheet(null));
      expect(find.byKey(const Key('registerChipButton')), findsNothing);
    });
  });

  group('developer: "Register this card" on the last tap', () {
    EventRecord tap() => EventRecord(
      eventId: 'e1',
      cardId: '04AABBCCDDEE',
      technologies: const ['NfcA'],
      cardType: null,
      detectedAt: DateTime.utc(2026, 9, 28),
      deliveryMode: DeliveryMode.relay,
      status: EventStatus.delivered,
      updatedAt: DateTime.utc(2026, 9, 28),
      appCardJson: '{"registered":false,"can_register":true}',
    );

    testWidgets('unregistered: registers with a name and marks the stored tap', (tester) async {
      final api = FakeDeviceApi();
      final repo = InMemoryEventRepository();
      await repo.upsert(tap());
      await tester.pumpWidget(_host(AppCardPanel(
          result: tap().appCard!, uid: '04AABBCCDDEE', eventId: 'e1', api: api, repository: repo)));
      await tester.tap(find.byKey(const Key('registerAppCardButton')));
      await tester.pumpAndSettle();
      await _name(tester, 'Alice badge');

      expect(api.appCards, [{'uid': '04AABBCCDDEE', 'label': 'Alice badge'}]);
      final stored = repo.rows['e1']!.appCard!;
      expect(stored.registered, isTrue);
      expect(stored.label, 'Alice badge');
    });

    testWidgets('registered / owned elsewhere: no button', (tester) async {
      final api = FakeDeviceApi();
      final repo = InMemoryEventRepository();
      await tester.pumpWidget(_host(AppCardPanel(
          result: const AppCardResult(registered: true, label: 'Alice badge'),
          uid: '04AABBCCDDEE', eventId: 'e1', api: api, repository: repo)));
      expect(find.text('Registered as Alice badge'), findsOneWidget);
      expect(find.byKey(const Key('registerAppCardButton')), findsNothing);

      await tester.pumpWidget(_host(AppCardPanel(
          result: const AppCardResult(registered: false), uid: '04AABBCCDDEE', eventId: 'e1', api: api, repository: repo)));
      expect(find.byKey(const Key('appCardTaken')), findsOneWidget);
      expect(find.byKey(const Key('registerAppCardButton')), findsNothing);
    });

    testWidgets('server says taken: shows why', (tester) async {
      final api = FakeDeviceApi()
        ..appCardError = const ApiException(statusCode: 409, code: 'card_uid_taken', message: 'taken');
      final repo = InMemoryEventRepository();
      await tester.pumpWidget(_host(AppCardPanel(
          result: tap().appCard!, uid: '04AABBCCDDEE', eventId: 'e1', api: api, repository: repo)));
      await tester.tap(find.byKey(const Key('registerAppCardButton')));
      await tester.pumpAndSettle();
      await _name(tester, '');
      expect(find.textContaining('already registered to another account'), findsOneWidget);
    });
  });
}
