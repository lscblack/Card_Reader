import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/event_repository.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fakes.dart';

void main() {
  sqfliteFfiInit();

  Future<SqfliteEventRepository> open({int cap = 1000}) =>
      SqfliteEventRepository.open(factory: databaseFactoryFfi, path: inMemoryDatabasePath, cap: cap);

  test('round-trips records and finds due retries', () async {
    final repo = await open();
    final now = DateTime.utc(2026, 9, 25, 9);
    final e = testEvent().copyWith(
      status: EventStatus.queued,
      attempts: 1,
      lastError: () => 'down',
      nextAttemptAt: () => now.add(const Duration(seconds: 5)),
    );
    await repo.upsert(e);
    final back = (await repo.get(e.eventId))!;
    expect(back.cardId, '04A1B2C3D4E5');
    expect(back.technologies, ['NfcA', 'MifareUltralight']);
    expect(back.status, EventStatus.queued);
    expect(back.detectedAt, e.detectedAt);
    expect(await repo.dueForRetry(now), isEmpty);
    expect(await repo.dueForRetry(now.add(const Duration(seconds: 6))), hasLength(1));
    expect(await repo.nextRetryAt(), now.add(const Duration(seconds: 5)));
    expect((await repo.countByStatus())[EventStatus.queued], 1);
    await repo.close();
  });

  test('caps history but keeps queued events; clear keeps queued', () async {
    final repo = await open(cap: 3);
    for (var i = 0; i < 5; i++) {
      await repo.upsert(testEvent(id: 'd$i').copyWith(status: EventStatus.delivered));
    }
    await repo.upsert(testEvent(id: 'q').copyWith(status: EventStatus.queued));
    final all = await repo.list(limit: 100);
    expect(all.where((e) => e.status == EventStatus.delivered).length, lessThanOrEqualTo(3));
    expect(all.any((e) => e.eventId == 'q'), isTrue);

    await repo.clear();
    final left = await repo.list(limit: 100);
    expect(left.map((e) => e.eventId), ['q']);
    await repo.close();
  });
}
