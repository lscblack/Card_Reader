import 'dart:convert';

import 'api_models.dart' show AppCardResult;
import 'business.dart';
import 'personal.dart';
import 'device_config.dart';

/// Local delivery status of an event.
enum EventStatus {
  /// Created, first attempt not finished yet.
  pending,

  /// Delivered (2xx from the developer endpoint, directly or via relay).
  delivered,

  /// Failed on the phone; will be retried locally ([EventRecord.nextAttemptAt]).
  queued,

  /// Relay mode: the platform accepted the event and owns the retries.
  retrying,

  /// Final failure (non-retryable error or retries exhausted).
  failed,

  /// Business app without an endpoint: the platform logged the tap (C2).
  logged;

  static EventStatus parse(String? v) =>
      EventStatus.values.firstWhere((e) => e.name == v, orElse: () => EventStatus.pending);
}

/// A card event as stored in the local history / retry queue.
class EventRecord {
  const EventRecord({
    required this.eventId,
    required this.cardId,
    required this.technologies,
    required this.cardType,
    required this.detectedAt,
    required this.deliveryMode,
    required this.status,
    this.attempts = 0,
    this.lastStatusCode,
    this.lastError,
    this.latencyMs,
    this.nextAttemptAt,
    this.pendingReport,
    required this.updatedAt,
    this.errorRef,
    this.requestId,
    this.businessJson,
    this.digitalCardToken,
    this.digitalJson,
    this.appCardJson,
  });

  final String eventId;
  final String cardId;
  final List<String> technologies;
  final String? cardType;
  final DateTime detectedAt;
  final DeliveryMode deliveryMode;
  final EventStatus status;

  /// Delivery attempts made by the phone (direct) or submissions (relay).
  final int attempts;
  final int? lastStatusCode;
  final String? lastError;
  final int? latencyMs;

  /// When the next local retry is due (only for [EventStatus.queued]).
  final DateTime? nextAttemptAt;

  /// Direct mode: JSON of a `direct_delivery` report not yet accepted by the
  /// platform (network down while reporting).
  final String? pendingReport;
  final DateTime updatedAt;

  /// `NFC-*` / `MOB-*` reference of the last failure, and the server request id.
  final String? errorRef;
  final String? requestId;

  /// Business resolution (C2) as returned by the platform, JSON-encoded.
  final String? businessJson;

  /// Part 4: digital-card token (kept for retries; expires server-side after 10 min).
  final String? digitalCardToken;

  /// Part 4 §5: `digital_card` block returned by the platform (public fields).
  final String? digitalJson;

  /// Developer devices: `app_card` block returned by the platform, JSON-encoded.
  final String? appCardJson;

  AppCardResult? get appCard {
    final raw = appCardJson;
    if (raw == null) return null;
    try {
      return AppCardResult.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  DigitalCardSummary? get digitalCard {
    final raw = digitalJson;
    if (raw == null) return null;
    try {
      return DigitalCardSummary.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  bool get isSuccess => status == EventStatus.delivered || status == EventStatus.logged;

  BusinessResult? get business {
    final raw = businessJson;
    if (raw == null) return null;
    try {
      return BusinessResult.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  EventRecord copyWith({
    EventStatus? status,
    int? attempts,
    int? Function()? lastStatusCode,
    String? Function()? lastError,
    int? Function()? latencyMs,
    DateTime? Function()? nextAttemptAt,
    String? Function()? pendingReport,
    DeliveryMode? deliveryMode,
    DateTime? updatedAt,
    String? Function()? errorRef,
    String? Function()? requestId,
    String? Function()? businessJson,
    String? Function()? digitalJson,
    String? Function()? appCardJson,
  }) => EventRecord(
    eventId: eventId,
    cardId: cardId,
    technologies: technologies,
    cardType: cardType,
    detectedAt: detectedAt,
    deliveryMode: deliveryMode ?? this.deliveryMode,
    status: status ?? this.status,
    attempts: attempts ?? this.attempts,
    lastStatusCode: lastStatusCode != null ? lastStatusCode() : this.lastStatusCode,
    lastError: lastError != null ? lastError() : this.lastError,
    latencyMs: latencyMs != null ? latencyMs() : this.latencyMs,
    nextAttemptAt: nextAttemptAt != null ? nextAttemptAt() : this.nextAttemptAt,
    pendingReport: pendingReport != null ? pendingReport() : this.pendingReport,
    updatedAt: updatedAt ?? DateTime.now(),
    errorRef: errorRef != null ? errorRef() : this.errorRef,
    requestId: requestId != null ? requestId() : this.requestId,
    businessJson: businessJson != null ? businessJson() : this.businessJson,
    digitalCardToken: digitalCardToken,
    digitalJson: digitalJson != null ? digitalJson() : this.digitalJson,
    appCardJson: appCardJson != null ? appCardJson() : this.appCardJson,
  );

  Map<String, Object?> toRow() => {
    'event_id': eventId,
    'card_id': cardId,
    'technologies': jsonEncode(technologies),
    'card_type': cardType,
    'detected_at': detectedAt.toUtc().millisecondsSinceEpoch,
    'delivery_mode': deliveryMode.name,
    'status': status.name,
    'attempts': attempts,
    'last_status_code': lastStatusCode,
    'last_error': lastError,
    'latency_ms': latencyMs,
    'next_attempt_at': nextAttemptAt?.toUtc().millisecondsSinceEpoch,
    'pending_report': pendingReport,
    'updated_at': updatedAt.toUtc().millisecondsSinceEpoch,
    'error_ref': errorRef,
    'request_id': requestId,
    'business_json': businessJson,
    'digital_token': digitalCardToken,
    'digital_json': digitalJson,
    'app_card_json': appCardJson,
  };

  factory EventRecord.fromRow(Map<String, Object?> r) {
    DateTime? ms(Object? v) =>
        v == null ? null : DateTime.fromMillisecondsSinceEpoch(v as int, isUtc: true);
    List<String> techs;
    try {
      techs = (jsonDecode(r['technologies'] as String? ?? '[]') as List).cast<String>();
    } catch (_) {
      techs = const [];
    }
    return EventRecord(
      eventId: r['event_id'] as String,
      cardId: r['card_id'] as String,
      technologies: techs,
      cardType: r['card_type'] as String?,
      detectedAt: ms(r['detected_at'])!,
      deliveryMode: DeliveryMode.parse(r['delivery_mode']),
      status: EventStatus.parse(r['status'] as String?),
      attempts: (r['attempts'] as int?) ?? 0,
      lastStatusCode: r['last_status_code'] as int?,
      lastError: r['last_error'] as String?,
      latencyMs: r['latency_ms'] as int?,
      nextAttemptAt: ms(r['next_attempt_at']),
      pendingReport: r['pending_report'] as String?,
      updatedAt: ms(r['updated_at']) ?? DateTime.now().toUtc(),
      errorRef: r['error_ref'] as String?,
      requestId: r['request_id'] as String?,
      businessJson: r['business_json'] as String?,
      digitalCardToken: r['digital_token'] as String?,
      digitalJson: r['digital_json'] as String?,
      appCardJson: r['app_card_json'] as String?,
    );
  }
}
