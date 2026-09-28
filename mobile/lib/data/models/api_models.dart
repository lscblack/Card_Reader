import '../../core/error_catalog.dart';
import 'business.dart';
import 'personal.dart';
import 'device_config.dart';

/// Error from the platform API, parsed from the contract error envelope
/// `{ "error": { "code", "message", "details" } }`.
class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.details,
    this.retryAfter,
    this.ref,
    this.requestId,
    this.docsUrl,
  });

  final int statusCode;
  final String code;
  final String message;
  final Object? details;
  final Duration? retryAfter;

  /// Part 2 A1: stable catalog id (e.g. `NFC-1003`), request id and docs link.
  final String? ref;
  final String? requestId;
  final String? docsUrl;

  /// The device token is no longer valid (`device_revoked`,
  /// `invalid_device_token`, ...): wipe credentials and go back to setup.
  bool get isAuthFailure => statusCode == 401;
  bool get isRevoked => code == 'device_revoked';

  /// `403 application_disabled`: the application is paused in the dashboard.
  /// Keep the token and retry later.
  bool get isApplicationDisabled => code == 'application_disabled';

  /// Worth retrying later: server errors, timeouts, rate limiting, paused app.
  /// Other 4xx (`validation_error`, `event_id_conflict`, `plan_limit_reached`) are final.
  bool get isRetryable =>
      statusCode >= 500 || statusCode == 408 || statusCode == 429 || isApplicationDisabled;

  @override
  String toString() => 'ApiException($statusCode, $code${ref == null ? '' : ', $ref'}): $message';
}

/// Transport-level failure (no HTTP response): DNS, refused, TLS, timeout.
class NetworkException implements Exception {
  const NetworkException(this.message, {this.isTimeout = false, MobError? mob}) : _mob = mob;
  final String message;
  final bool isTimeout;
  final MobError? _mob;

  /// Local catalog entry for this failure.
  MobError get mob => _mob ?? (isTimeout ? MobError.timeout : MobError.serverUnreachable);
  String get ref => mob.ref;

  @override
  String toString() => 'NetworkException: $message';
}

class RegisterResult {
  const RegisterResult({required this.deviceToken, required this.config});
  final String deviceToken;
  final DeviceConfig config;
}

class HeartbeatResult {
  const HeartbeatResult({required this.status, this.serverTime});
  final String status;
  final String? serverTime;
}

/// `direct_delivery` object reported to `POST /device/events`.
class DirectDeliveryReport {
  const DirectDeliveryReport({
    required this.success,
    required this.statusCode,
    required this.latencyMs,
    required this.error,
    required this.attempt,
  });

  final bool success;
  final int? statusCode;
  final int? latencyMs;
  final String? error;
  final int attempt;

  Map<String, Object?> toJson() => {
    'success': success,
    'status_code': statusCode,
    'latency_ms': latencyMs,
    'error': error,
    'attempt': attempt,
  };

  factory DirectDeliveryReport.fromJson(Map<String, dynamic> j) => DirectDeliveryReport(
    success: j['success'] as bool? ?? false,
    statusCode: (j['status_code'] as num?)?.toInt(),
    latencyMs: (j['latency_ms'] as num?)?.toInt(),
    error: j['error'] as String?,
    attempt: (j['attempt'] as num?)?.toInt() ?? 1,
  );
}

/// Body of `POST /device/events`.
class EventSubmission {
  const EventSubmission({
    required this.eventId,
    required this.cardId,
    required this.technologies,
    required this.cardType,
    required this.detectedAt,
    this.directDelivery,
    this.digitalCardToken,
  });

  final String eventId;
  final String cardId;
  final List<String> technologies;
  final String? cardType;

  /// ISO-8601 UTC (`...Z`).
  final String detectedAt;
  final DirectDeliveryReport? directDelivery;

  /// Part 4 §5 (only sent for digital cards; Part 1 body unchanged otherwise).
  final String? digitalCardToken;

  Map<String, Object?> toJson() => {
    'event_id': eventId,
    'card_id': cardId,
    'card_technologies': technologies,
    'card_type': cardType,
    'detected_at': detectedAt,
    'direct_delivery': directDelivery?.toJson(),
    'digital_card_token': ?digitalCardToken,
  };
}

/// Response of `POST /device/events`.
class EventSubmitResult {
  const EventSubmitResult({
    required this.eventId,
    required this.status,
    this.statusCode,
    this.latencyMs,
    this.error,
    this.errorRef,
    this.errorCode,
    this.business,
    this.digitalCard,
    this.appCard,
  });

  final String eventId;

  /// `delivered` | `retrying` | `failed` | `logged` (business apps) (or `pending`).
  final String status;
  final int? statusCode;
  final int? latencyMs;
  final String? error;

  /// Part 2 A1: `error_ref` of the (last) delivery failure, if any.
  final String? errorRef;

  /// Part 2 §E: machine code of the failed attempt (e.g. `delivery_timeout`); only on failures.
  final String? errorCode;

  /// Part 2 C2: business resolution (business devices only; absent for developers).
  final BusinessResult? business;

  /// Part 4 §5: digital card read by this terminal (public fields), if the platform returns it.
  final DigitalCardSummary? digitalCard;

  /// Developer devices: whether the chip is one of the application's registered cards.
  final AppCardResult? appCard;

  factory EventSubmitResult.fromJson(Map<String, dynamic> j) => EventSubmitResult(
    eventId: j['event_id'] as String? ?? '',
    status: j['status'] as String? ?? 'pending',
    statusCode: (j['status_code'] as num?)?.toInt(),
    latencyMs: (j['latency_ms'] as num?)?.toInt(),
    error: j['error'] as String?,
    // Part 4 §9: token problems are reported inside `digital_card`.
    errorRef: j['error_ref'] as String? ?? (j['digital_card'] is Map ? (j['digital_card'] as Map)['error_ref'] as String? : null),
    errorCode: j['error_code'] as String? ?? (j['digital_card'] is Map ? (j['digital_card'] as Map)['error_code'] as String? : null),
    digitalCard: DigitalCardSummary.fromJson(j['digital_card']),
    business: j['business'] is Map ? BusinessResult.fromJson((j['business'] as Map).cast<String, dynamic>()) : null,
    appCard: j['app_card'] is Map ? AppCardResult.fromJson((j['app_card'] as Map).cast<String, dynamic>()) : null,
  );
}

/// `app_card` of a developer device's tap: is this chip one of the application's cards?
class AppCardResult {
  const AppCardResult({required this.registered, this.canRegister = false, this.id, this.label, this.raw = const {}});

  final bool registered;

  /// Not registered by anyone on the platform (a chip owned elsewhere can't be registered here).
  final bool canRegister;
  final String? id;
  final String? label;
  final Map<String, dynamic> raw;

  factory AppCardResult.fromJson(Map<String, dynamic> j) => AppCardResult(
    registered: j['registered'] == true,
    canRegister: j['can_register'] == true,
    id: j['id'] as String?,
    label: j['label'] as String?,
    raw: j,
  );
}
