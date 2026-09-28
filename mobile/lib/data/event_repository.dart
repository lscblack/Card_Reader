import 'dart:async';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../core/config.dart';
import 'models/event_record.dart';

/// Local event history + retry queue storage.
abstract class EventRepository {
  /// Emits after every write so screens can refresh.
  Stream<void> get changes;

  Future<void> upsert(EventRecord record);
  Future<EventRecord?> get(String eventId);
  Future<List<EventRecord>> list({EventStatus? status, int limit = 200});

  /// Queued events whose next attempt is due at [now].
  Future<List<EventRecord>> dueForRetry(DateTime now);

  /// Earliest `next_attempt_at` among queued events.
  Future<DateTime?> nextRetryAt();

  /// Direct-mode events whose outcome report has not reached the platform.
  Future<List<EventRecord>> withPendingReports();

  Future<Map<EventStatus, int>> countByStatus();
  /// Deletes history, keeping events that still await a retry or report.
  Future<void> clear();
  Future<void> close();
}

class SqfliteEventRepository implements EventRepository {
  SqfliteEventRepository._(this._db, this._cap);

  final Database _db;
  final int _cap;
  final _changes = StreamController<void>.broadcast();

  static const _table = 'events';

  /// Opens (and migrates) the database. Pass [factory]/[path] in tests
  /// (e.g. `databaseFactoryFfi`, `inMemoryDatabasePath`).
  static Future<SqfliteEventRepository> open({
    DatabaseFactory? factory,
    String? path,
    int cap = AppConfig.historyCap,
  }) async {
    final f = factory ?? databaseFactory;
    final dbPath = path ?? p.join(await f.getDatabasesPath(), 'nfc_terminal_events.db');
    final db = await f.openDatabase(
      dbPath,
      options: OpenDatabaseOptions(
        version: 4,
        onUpgrade: (db, oldVersion, _) async {
          if (oldVersion < 2) {
            // Part 2: error refs + business result.
            await db.execute('ALTER TABLE $_table ADD COLUMN error_ref TEXT');
            await db.execute('ALTER TABLE $_table ADD COLUMN request_id TEXT');
            await db.execute('ALTER TABLE $_table ADD COLUMN business_json TEXT');
          }
          if (oldVersion < 3) {
            // Part 4: digital cards.
            await db.execute('ALTER TABLE $_table ADD COLUMN digital_token TEXT');
            await db.execute('ALTER TABLE $_table ADD COLUMN digital_json TEXT');
          }
          if (oldVersion < 4) {
            // Developer devices: registered-card status of each tap.
            await db.execute('ALTER TABLE $_table ADD COLUMN app_card_json TEXT');
          }
        },
        onCreate: (db, _) async {
          await db.execute('''
            CREATE TABLE $_table (
              event_id TEXT PRIMARY KEY,
              card_id TEXT NOT NULL,
              technologies TEXT NOT NULL,
              card_type TEXT,
              detected_at INTEGER NOT NULL,
              delivery_mode TEXT NOT NULL,
              status TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0,
              last_status_code INTEGER,
              last_error TEXT,
              latency_ms INTEGER,
              next_attempt_at INTEGER,
              pending_report TEXT,
              updated_at INTEGER NOT NULL,
              error_ref TEXT,
              request_id TEXT,
              business_json TEXT,
              digital_token TEXT,
              digital_json TEXT,
              app_card_json TEXT
            )''');
          await db.execute('CREATE INDEX idx_events_detected ON $_table(detected_at DESC)');
          await db.execute('CREATE INDEX idx_events_status ON $_table(status, next_attempt_at)');
        },
      ),
    );
    return SqfliteEventRepository._(db, cap);
  }

  @override
  Stream<void> get changes => _changes.stream;

  void _notify() {
    if (!_changes.isClosed) _changes.add(null);
  }

  @override
  Future<void> upsert(EventRecord record) async {
    await _db.insert(_table, record.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);
    await _prune();
    _notify();
  }

  /// Keeps the newest [_cap] rows, but never drops events still awaiting a
  /// retry or an outcome report.
  Future<void> _prune() async {
    await _db.rawDelete('''
      DELETE FROM $_table
      WHERE status NOT IN ('queued', 'pending') AND pending_report IS NULL
        AND event_id NOT IN (
          SELECT event_id FROM $_table ORDER BY detected_at DESC LIMIT ?
        )''', [_cap]);
  }

  @override
  Future<EventRecord?> get(String eventId) async {
    final rows = await _db.query(_table, where: 'event_id = ?', whereArgs: [eventId], limit: 1);
    return rows.isEmpty ? null : EventRecord.fromRow(rows.first);
  }

  @override
  Future<List<EventRecord>> list({EventStatus? status, int limit = 200}) async {
    final rows = await _db.query(
      _table,
      where: status == null ? null : 'status = ?',
      whereArgs: status == null ? null : [status.name],
      orderBy: 'detected_at DESC',
      limit: limit,
    );
    return rows.map(EventRecord.fromRow).toList();
  }

  @override
  Future<List<EventRecord>> dueForRetry(DateTime now) async {
    final rows = await _db.query(
      _table,
      where: 'status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)',
      whereArgs: [EventStatus.queued.name, now.toUtc().millisecondsSinceEpoch],
      orderBy: 'detected_at ASC',
    );
    return rows.map(EventRecord.fromRow).toList();
  }

  @override
  Future<DateTime?> nextRetryAt() async {
    final rows = await _db.rawQuery(
      'SELECT MIN(next_attempt_at) AS t FROM $_table WHERE status = ?',
      [EventStatus.queued.name],
    );
    final t = rows.first['t'] as int?;
    return t == null ? null : DateTime.fromMillisecondsSinceEpoch(t, isUtc: true);
  }

  @override
  Future<List<EventRecord>> withPendingReports() async {
    final rows = await _db.query(_table, where: 'pending_report IS NOT NULL', orderBy: 'detected_at ASC');
    return rows.map(EventRecord.fromRow).toList();
  }

  @override
  Future<Map<EventStatus, int>> countByStatus() async {
    final rows = await _db.rawQuery('SELECT status, COUNT(*) AS n FROM $_table GROUP BY status');
    return {for (final r in rows) EventStatus.parse(r['status'] as String?): r['n'] as int};
  }

  @override
  Future<void> clear() async {
    await _db.delete(
      _table,
      where: "status NOT IN ('queued', 'pending') AND pending_report IS NULL",
    );
    _notify();
  }

  @override
  Future<void> close() async {
    await _changes.close();
    await _db.close();
  }
}
