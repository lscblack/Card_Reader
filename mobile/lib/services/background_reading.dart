import 'dart:async';

import '../core/logger.dart';
import '../data/models/card_read.dart';
import '../data/models/event_record.dart';
import 'tag_dispatch.dart';

/// Whether to hand control back to the previous app after handling a
/// dispatched tag: only when the tap launched/brought up the app.
bool shouldReturnToBackground(DispatchedTag tag) => tag.launchedFromBackground;

/// Notification text for a background read. [result] is null on timeout.
({String title, String body}) backgroundResultText(String uid, EventRecord? result) {
  final card = 'Card ${CardUtils.formatUid(uid)}';
  if (result == null) {
    return (title: '$card read', body: 'Still sending — it will be retried if needed.');
  }
  final b = result.business;
  if (b != null) {
    // Business devices: the platform's message ("John Doe · Sales Manager").
    final what = b.message ?? b.cardName ?? card;
    return switch (b.result) {
      'recognized' => (title: '$what ✓', body: [?b.cardName, ?b.actionLabel].join(' · ')),
      'inactive' => (title: '$what — inactive', body: 'This card is not active.'),
      _ => (title: 'Unknown card ${CardUtils.formatUid(uid)}', body: b.message ?? 'Not registered in your business.'),
    };
  }
  return switch (result.status) {
    EventStatus.logged => (title: '$card logged ✓', body: ''),
    EventStatus.delivered => (
      title: '$card delivered ✓',
      body: [
        if (result.lastStatusCode != null) 'HTTP ${result.lastStatusCode}',
        if (result.latencyMs != null) '${result.latencyMs} ms',
      ].join(' · '),
    ),
    EventStatus.retrying => (title: '$card accepted', body: 'The platform is retrying delivery.'),
    EventStatus.queued => (title: '$card failed — queued for retry', body: result.lastError ?? ''),
    EventStatus.failed => (title: '$card failed ✗', body: result.lastError ?? ''),
    EventStatus.pending => (title: '$card read', body: 'Sending…'),
  };
}

/// Feeds tags from Android tag dispatch into the reader pipeline, then (if
/// the tap opened the app) notifies and returns to the previous app.
class BackgroundReading {
  BackgroundReading({
    required this.dispatch,
    required this.handleCard,
    required this.isRegistered,
    required this.flushRetries,
    this.timeout = const Duration(seconds: 8),
  });

  final TagDispatch dispatch;
  final Future<EventRecord?> Function(CardRead card) handleCard;
  final bool Function() isRegistered;
  final void Function() flushRetries;
  final Duration timeout;
  StreamSubscription<DispatchedTag>? _sub;

  /// Processes tags buffered before Dart was ready, then listens for more.
  Future<void> start() async {
    _sub = dispatch.tags.listen(handle);
    for (final t in await dispatch.takePending()) {
      await handle(t);
    }
  }

  Future<void> handle(DispatchedTag tag) async {
    if (!isRegistered()) return; // no UI noise when not set up
    flushRetries();
    final card = tag.toCardRead();
    if (card == null) {
      Log.d('bg', 'dispatched tag without usable UID ignored');
      return;
    }
    var timedOut = false;
    // `.then` re-types the future so a null onTimeout value is always allowed.
    final result = await handleCard(card).then<EventRecord?>((r) => r).timeout(timeout, onTimeout: () {
      timedOut = true;
      return null;
    });
    if (!shouldReturnToBackground(tag)) return;
    if (result != null || timedOut) {
      final text = backgroundResultText(card.uid, result);
      await dispatch.showNotification(text.title, text.body);
    }
    // null without timeout = debounced duplicate: just go back.
    await dispatch.moveToBack();
  }

  void dispose() => _sub?.cancel();
}
