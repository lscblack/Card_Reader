import 'dart:async';

import '../core/logger.dart';
import '../data/event_repository.dart';
import '../data/models/device_config.dart';
import '../data/models/event_record.dart';
import 'delivery_service.dart';

/// Exponential backoff for local retries: 5s, 30s, 2m, 10m (then 10m).
class RetryPolicy {
  const RetryPolicy({
    this.schedule = const [
      Duration(seconds: 5),
      Duration(seconds: 30),
      Duration(minutes: 2),
      Duration(minutes: 10),
    ],
    this.maxDelay = const Duration(minutes: 30),
  });

  final List<Duration> schedule;
  final Duration maxDelay;

  /// Delay before the next attempt after [failedAttempts] (1-based) failures.
  /// A server `Retry-After` is honoured when it is longer (capped by [maxDelay]).
  Duration delayFor(int failedAttempts, {Duration? retryAfter}) {
    final i = (failedAttempts - 1).clamp(0, schedule.length - 1);
    var d = schedule[i];
    if (retryAfter != null && retryAfter > d) d = retryAfter;
    return d > maxDelay ? maxDelay : d;
  }

  /// Whether another automatic attempt is allowed after [attemptsMade]
  /// attempts, given the config's `max_retries` (retries after the first try).
  bool canRetry(int attemptsMade, int maxRetries) => attemptsMade <= maxRetries;

  /// Retryable HTTP status codes: timeouts, rate limiting and server errors.
  /// Other 4xx (validation etc.) are final.
  static bool isRetryableStatus(int status) =>
      status == 408 || status == 429 || status >= 500;
}

/// Drives local retries: wakes up when the earliest queued event is due, and
/// on demand (connectivity regained, app resumed, "Retry now").
///
/// Relay events the platform reported as `retrying` are never in this queue:
/// the server owns those retries.
class RetryQueue {
  RetryQueue({
    required this.repository,
    required this.delivery,
    required this.configProvider,
    DateTime Function()? clock,
  }) : _now = clock ?? DateTime.now;

  final EventRepository repository;
  final DeliveryService delivery;

  /// Current config, or null while not registered / not synced.
  final DeviceConfig? Function() configProvider;
  final DateTime Function() _now;

  Timer? _timer;
  bool _running = false;
  bool _rerun = false;
  bool _started = false;

  void start() {
    _started = true;
    unawaited(kick());
  }

  void stop() {
    _started = false;
    _timer?.cancel();
    _timer = null;
  }

  /// Processes everything due now, then re-arms the timer.
  Future<void> kick() async {
    if (!_started) return;
    if (_running) {
      _rerun = true;
      return;
    }
    _running = true;
    try {
      do {
        _rerun = false;
        final config = configProvider();
        if (config == null) break;
        await delivery.flushReports();
        for (final e in await repository.dueForRetry(_now())) {
          if (!_started) break;
          await delivery.deliver(e, configProvider() ?? config);
        }
      } while (_rerun && _started);
    } catch (e) {
      Log.e('retry', 'retry pass failed', e);
    } finally {
      _running = false;
      await _arm();
    }
  }

  Future<void> _arm() async {
    _timer?.cancel();
    if (!_started) return;
    final next = await repository.nextRetryAt();
    if (next == null) return;
    var delay = next.difference(_now().toUtc());
    if (delay < const Duration(seconds: 1)) delay = const Duration(seconds: 1);
    _timer = Timer(delay, () => unawaited(kick()));
  }

  /// Makes the given event due immediately (also revives failed events for
  /// one more attempt) and processes the queue.
  Future<void> retryNow(String eventId) async {
    final e = await repository.get(eventId);
    if (e == null || e.isSuccess || e.status == EventStatus.retrying) return;
    await repository.upsert(e.copyWith(status: EventStatus.queued, nextAttemptAt: () => _now().toUtc()));
    await kick();
  }

  /// Makes all queued events due immediately.
  Future<void> retryAllNow() async {
    for (final e in await repository.list(status: EventStatus.queued, limit: 1000)) {
      await repository.upsert(e.copyWith(nextAttemptAt: () => _now().toUtc()));
    }
    await kick();
  }
}
