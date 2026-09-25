import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/nfc_service.dart';
import 'package:nfc_terminal/services/reader_controller.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fakes.dart';

void main() {
  test('debouncer ignores the same UID within 1.5s', () {
    final d = UidDebouncer();
    final t0 = DateTime(2026);
    expect(d.accept('04A1', t0), isTrue);
    expect(d.accept('04A1', t0.add(const Duration(milliseconds: 800))), isFalse);
    expect(d.accept('BEEF', t0.add(const Duration(milliseconds: 900))), isTrue);
    expect(d.accept('04A1', t0.add(const Duration(milliseconds: 1000))), isTrue);
    expect(d.accept('04A1', t0.add(const Duration(milliseconds: 2600))), isTrue);
  });

  test('reader: card read -> event stored and delivered, duplicates ignored', () async {
    final nfc = FakeNfcService();
    final repo = InMemoryEventRepository();
    final api = FakeDeviceApi();
    final delivery = DeliveryService(
      api: api, httpClient: MockClient((_) async => http.Response('', 500)), repository: repo);
    var haptics = 0;
    final reader = ReaderController(
      nfc: nfc,
      repository: repo,
      platform: FakePlatformInfo(),
      deliveryProvider: () => delivery,
      configProvider: () => testConfig(),
      haptic: () async => haptics++,
    );
    await reader.init();
    expect(reader.phase, ReaderPhase.ready);
    expect(nfc.onCard, isNotNull);

    final card = CardRead(
      uid: '04A1B2C3D4E5', technologies: const ['NfcA'], type: CardType.unknown, detectedAt: DateTime.now().toUtc());
    nfc.onCard!(card);
    nfc.onCard!(card); // debounced
    await Future<void>.delayed(const Duration(milliseconds: 20));

    expect(haptics, 1);
    expect(api.submissions, hasLength(1));
    expect(api.submissions.single.cardType, isNull, reason: 'unknown type is sent as null');
    expect(repo.rows.values.single.status, EventStatus.delivered);
    expect(reader.phase, ReaderPhase.delivered);

    await reader.stop();
    expect(reader.phase, ReaderPhase.stopped);
    reader.dispose();
  });

  test('reader reports NFC off / unsupported', () async {
    final nfc = FakeNfcService()..state = NfcState.disabled;
    final reader = ReaderController(
      nfc: nfc, repository: InMemoryEventRepository(), platform: FakePlatformInfo(),
      deliveryProvider: () => null, configProvider: () => null);
    await reader.init();
    expect(reader.phase, ReaderPhase.nfcOff);
    nfc.state = NfcState.unsupported;
    await reader.refreshAvailability();
    expect(reader.phase, ReaderPhase.unsupported);
    reader.dispose();
  });
}
