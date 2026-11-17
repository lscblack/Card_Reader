import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

import '../core/config.dart';
import '../core/error_catalog.dart';
import '../core/http_client.dart';
import '../core/logger.dart';
import '../core/time_utils.dart';
import '../data/api_client.dart';
import '../data/event_repository.dart';
import '../data/models/api_models.dart';
import '../data/models/device_config.dart';
import '../data/models/endpoint_reply.dart';
import '../data/models/event_record.dart';
import 'domain_allowlist.dart';
import 'retry_queue.dart';
import 'signing.dart';

/// Builds the exact developer-endpoint payload of contract section 4.
///
/// `timestamp` is the detection time, so a retried body describes the same
/// event; freshness is carried by the signed `X-NFC-Timestamp` header.
Map<String, Object?> buildEndpointPayload({
  required EventRecord event,
  required DeviceConfig config,
  required DeliveryMode mode,
}) => {
  'event_id': event.eventId,
  'event': 'card.detected',
  'card_id': event.cardId,
  'card': {
    'uid': event.cardId,
    'uid_length': event.cardId.length ~/ 2,
    'technologies': event.technologies,
    'type': event.cardType,
  },
  // The phone can't verify digital-card tokens, so direct mode never claims `signed_token`
  // (Part 4 §9: that level means platform-verified); `digital_card.verified` is false.
  'security': {'authenticated': false, 'level': 'uid_only'},
  'device_id': config.deviceId,
  'application_id': config.applicationId,
  'delivery_mode': mode.name,
  'test': false,
  'timestamp': isoUtc(event.detectedAt),
  // Part 4 (direct mode): the phone can't verify the token — the developer can, via the
  // platform; public profile fields are only added by the platform in relay mode.
  if (event.digitalCardToken != null)
    'digital_card': {'id': _uuidFromHex(event.cardId), 'token': event.digitalCardToken, 'verified': false},
  // Opt-in per application: a location is never sent unless the application has sharing on right now.
  if (config.shareLocation && event.location != null) 'location': event.location!.toJson(),
};

/// Body of a background `location.update` (direct mode). Same identity fields as a tap: `device_id`, and a fresh
/// `event_id` the endpoint can deduplicate on. The reply's `session_open` says whether to keep sharing.
Map<String, Object?> buildLocationPayload({
  required String id,
  required DeviceConfig config,
  required GeoFix fix,
  required DateTime now,
}) => {
  'event_id': id,
  'event': 'location.update',
  'device_id': config.deviceId,
  'application_id': config.applicationId,
  'delivery_mode': DeliveryMode.direct.name,
  'test': false,
  'timestamp': isoUtc(now),
  'location': fix.toJson(),
};

String _uuidFromHex(String h) => h.length != 32
    ? h
    : '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}'
          .toLowerCase();

/// Headers that callers' `custom_headers` may not override.
const _reservedHeaders = {
  'content-type',
  'content-length',
  'host',
  'user-agent',
  'x-nfc-event-id',
  'x-nfc-timestamp',
  'x-nfc-nonce',
  'x-nfc-device-id',
  'x-nfc-delivery-mode',
  'x-nfc-signature',
};

/// A fully prepared, signed direct request (exposed for tests).
class SignedRequest {
  const SignedRequest(this.url, this.headers, this.bodyBytes);
  final Uri url;
  final Map<String, String> headers;
  final List<int> bodyBytes;
}

/// Builds and signs a direct delivery request with a fresh timestamp + nonce.
SignedRequest buildSignedDirectRequest({
  required EventRecord event,
  required DeviceConfig config,
  required String secret,
  required DateTime now,
  required String nonce,
}) => signDirectRequest(
  payload: buildEndpointPayload(event: event, config: config, mode: DeliveryMode.direct),
  eventId: event.eventId,
  config: config,
  secret: secret,
  now: now,
  nonce: nonce,
);

/// Signs [payload] for direct delivery. The signature covers the exact body bytes (so the body's `device_id` and
/// `event_id` are signed); `X-NFC-Event-Id` / `X-NFC-Device-Id` repeat them and must agree with the body.
/// [nonce] is fresh per delivery; a redelivery after a 503 may reuse it, but this app always draws a new one.
SignedRequest signDirectRequest({
  required Map<String, Object?> payload,
  required String eventId,
  required DeviceConfig config,
  required String secret,
  required DateTime now,
  required String nonce,
}) {
  final body = utf8.encode(jsonEncode(payload));
  final ts = unixSeconds(now).toString();
  final headers = <String, String>{
    for (final e in config.customHeaders.entries)
      if (!_reservedHeaders.contains(e.key.toLowerCase())) e.key: e.value,
    'Content-Type': 'application/json',
    'User-Agent': AppConfig.terminalUserAgent,
    'X-NFC-Event-Id': eventId,
    'X-NFC-Timestamp': ts,
    'X-NFC-Nonce': nonce,
    'X-NFC-Device-Id': config.deviceId,
    'X-NFC-Delivery-Mode': 'direct',
    'X-NFC-Signature': Signer.sign(secret: secret, timestamp: ts, nonce: nonce, bodyBytes: body),
  };
  return SignedRequest(Uri.parse(config.endpointUrl!), headers, body);
}

/// Delivers events (relay or direct), updates the local record and decides
/// whether it goes into the local retry queue.
class DeliveryService {
  DeliveryService({
    required this.api,
    required http.Client httpClient,
    required this.repository,
    this.policy = const RetryPolicy(),
    DateTime Function()? clock,
    String Function()? nonceGenerator,
    bool Function()? isOnline,
    this.onEndpointReply,
  }) : _http = httpClient,
       _now = clock ?? DateTime.now,
       _nonce = nonceGenerator ?? Signer.nonce,
       _isOnline = isOnline ?? _alwaysOnline;

  static bool _alwaysOnline() => true;

  final DeviceApi api;
  final http.Client _http;
  final EventRepository repository;
  final RetryPolicy policy;
  final DateTime Function() _now;
  final String Function() _nonce;
  final bool Function() _isOnline;
  final Set<String> _inFlight = {};

  /// Called with every endpoint reply that arrives (also for retried deliveries and location updates), so the
  /// location sharer can follow `session_open`.
  final void Function(EndpointReply reply)? onEndpointReply;

  /// While offline, events wait without burning retry attempts; the
  /// connectivity-regained trigger (or this safety poll) sends them.
  static const offlinePoll = Duration(seconds: 30);

  bool isInFlight(String eventId) => _inFlight.contains(eventId);

  /// Makes one attempt for [event]. Returns the updated record, or null if an
  /// attempt for this event is already running.
  Future<EventRecord?> deliver(EventRecord event, DeviceConfig config) async {
    if (!_inFlight.add(event.eventId)) return null;
    try {
      if (_now().toUtc().difference(event.detectedAt) > AppConfig.maxEventAge - const Duration(minutes: 5)) {
        final expired = event.copyWith(
          status: EventStatus.failed,
          lastError: () => 'Expired: older than 7 days, not sent',
          nextAttemptAt: () => null,
        );
        await repository.upsert(expired);
        return expired;
      }
      if (!_isOnline()) {
        final waiting = event.copyWith(
          status: EventStatus.queued,
          lastError: () => 'Offline: will be sent when the network is back',
          errorRef: () => MobError.offline.ref,
          requestId: () => null,
          nextAttemptAt: () => _now().toUtc().add(offlinePoll),
        );
        await repository.upsert(waiting);
        return waiting;
      }
      final updated = config.deliveryMode == DeliveryMode.direct
          ? await _deliverDirect(event, config)
          : await _deliverRelay(event, config);
      await repository.upsert(updated);
      if (updated.pendingReport != null) {
        return await _sendReport(updated);
      }
      return updated;
    } finally {
      _inFlight.remove(event.eventId);
    }
  }

  // ---------------------------------------------------------------- relay --

  Future<EventRecord> _deliverRelay(EventRecord event, DeviceConfig config) async {
    final attempt = event.attempts + 1;
    final base = event.copyWith(attempts: attempt, deliveryMode: DeliveryMode.relay);
    try {
      final r = await api.submitEvent(
        _submission(event, location: config.shareLocation ? event.location : null),
        // The server makes the first delivery synchronously, bounded by the endpoint timeout.
        timeout: config.timeout + const Duration(seconds: 15),
      );
      final status = switch (r.status) {
        'delivered' => EventStatus.delivered,
        'logged' => EventStatus.logged, // business app without endpoint (C2)
        'failed' => EventStatus.failed,
        _ => EventStatus.retrying, // server-owned retries: never retried locally
      };
      if (r.endpointReply != null) onEndpointReply?.call(r.endpointReply!);
      return _withBusiness(base, r).copyWith(
        reply: () => r.endpointReply,
        status: status,
        lastStatusCode: () => r.statusCode,
        latencyMs: () => r.latencyMs,
        lastError: () => r.error ?? r.errorCode,
        errorRef: () => r.errorRef,
        requestId: () => null,
        nextAttemptAt: () => null,
      );
    } on ApiException catch (e) {
      final msg = '${e.code}: ${e.message}';
      if (e.isRetryable) {
        return _scheduleOrFail(base, config, msg, e.statusCode, e.retryAfter, ref: e.ref, requestId: e.requestId);
      }
      return base.copyWith(
        status: EventStatus.failed,
        lastStatusCode: () => e.statusCode,
        lastError: () => msg,
        errorRef: () => e.ref,
        requestId: () => e.requestId,
        nextAttemptAt: () => null,
      );
    } on NetworkException catch (e) {
      return _scheduleOrFail(base, config, 'Platform unreachable: ${e.message}', null, null, ref: e.ref);
    }
  }

  EventRecord _withBusiness(EventRecord e, EventSubmitResult r) {
    var out = e;
    if (r.business != null) out = out.copyWith(businessJson: () => jsonEncode(r.business!.raw));
    if (r.digitalCard != null) out = out.copyWith(digitalJson: () => jsonEncode(r.digitalCard!.raw));
    if (r.appCard != null) out = out.copyWith(appCardJson: () => jsonEncode(r.appCard!.raw));
    return out;
  }

  /// Local ref for a direct-delivery failure (null when the endpoint answered).
  static String? _directRef(String? error) {
    if (error == null) return null;
    if (error == 'domain_not_allowed') return MobError.domainNotAllowed.ref;
    if (error == 'missing_signing_secret') return MobError.signingFailed.ref;
    if (error == 'endpoint_not_configured' || error == 'endpoint_disabled') return MobError.endpointNotConfigured.ref;
    if (error.startsWith('timeout')) return MobError.timeout.ref;
    if (error == 'tls_error') return MobError.tlsError.ref;
    if (error.startsWith('connection_failed')) return MobError.endpointUnreachable.ref;
    return null;
  }

  // --------------------------------------------------------------- direct --

  Future<EventRecord> _deliverDirect(EventRecord event, DeviceConfig config) async {
    final attempt = event.attempts + 1;
    final base = event.copyWith(attempts: attempt, deliveryMode: DeliveryMode.direct);

    final url = config.endpointUrl;
    final secret = config.signingSecret;
    if (url == null || url.isEmpty || !config.endpointEnabled) {
      return _directResult(base, config, attempt,
          success: false, statusCode: null, latencyMs: null,
          error: url == null || url.isEmpty ? 'endpoint_not_configured' : 'endpoint_disabled',
          retryable: false);
    }
    final host = Uri.tryParse(url)?.host ?? '';
    if (!isHostAllowed(host, config.allowedDomains)) {
      // Contract 7.1: never contact a non-allowlisted endpoint; final failure.
      return _directResult(base, config, attempt,
          success: false, statusCode: null, latencyMs: null,
          error: 'domain_not_allowed', retryable: false);
    }
    if (secret == null || secret.isEmpty) {
      return _directResult(base, config, attempt,
          success: false, statusCode: null, latencyMs: null,
          error: 'missing_signing_secret', retryable: true);
    }

    final req = buildSignedDirectRequest(
      event: event, config: config, secret: secret, now: _now(), nonce: _nonce(),
    );
    final sw = Stopwatch()..start();
    try {
      final res = await sendBytes(
        _http,
        method: 'POST',
        url: req.url,
        headers: req.headers,
        bytes: req.bodyBytes,
        timeout: config.timeout,
        maxBodyChars: 8192,
      );
      sw.stop();
      final code = res.statusCode;
      final ok = code >= 200 && code < 300;
      String? error;
      if (!ok) {
        error = code >= 300 && code < 400 ? 'redirect_not_followed (HTTP $code)' : 'HTTP $code';
      }
      Log.d('delivery', 'direct ${event.eventId} attempt $attempt -> $code in ${sw.elapsedMilliseconds}ms');
      final reply = ok ? EndpointReply.fromBody(res.body) : null;
      if (reply != null) onEndpointReply?.call(reply);
      return _directResult(base, config, attempt,
          success: ok, statusCode: code, latencyMs: sw.elapsedMilliseconds,
          error: error, retryable: RetryPolicy.isRetryableStatus(code), reply: reply);
    } on TimeoutException {
      return _directResult(base, config, attempt,
          success: false, statusCode: null, latencyMs: sw.elapsedMilliseconds,
          error: 'timeout after ${config.timeout.inSeconds}s', retryable: true);
    } on SocketException catch (e) {
      return _directResult(base, config, attempt,
          success: false, statusCode: null, latencyMs: null,
          error: 'connection_failed: ${e.osError?.message ?? e.message}', retryable: true);
    } on HandshakeException {
      return _directResult(base, config, attempt,
          success: false, statusCode: null, latencyMs: null, error: 'tls_error', retryable: true);
    } on http.ClientException catch (e) {
      return _directResult(base, config, attempt,
          success: false, statusCode: null, latencyMs: null,
          error: 'connection_failed: ${e.message}', retryable: true);
    }
  }

  EventRecord _directResult(
    EventRecord base,
    DeviceConfig config,
    int attempt, {
    required bool success,
    required int? statusCode,
    required int? latencyMs,
    required String? error,
    required bool retryable,
    EndpointReply? reply,
  }) {
    final report = DirectDeliveryReport(
      success: success, statusCode: statusCode, latencyMs: latencyMs, error: error, attempt: attempt,
    );
    final ref = success ? null : _directRef(error);
    final withReport = base.copyWith(
      lastStatusCode: () => statusCode,
      latencyMs: () => latencyMs,
      lastError: () => error,
      errorRef: () => ref,
      requestId: () => null,
      pendingReport: () => jsonEncode(report.toJson()),
    );
    if (success) {
      return withReport.copyWith(status: EventStatus.delivered, nextAttemptAt: () => null, reply: () => reply);
    }
    if (retryable) return _scheduleOrFail(withReport, config, error ?? 'failed', statusCode, null, ref: ref);
    return withReport.copyWith(status: EventStatus.failed, nextAttemptAt: () => null);
  }

  /// Sends a pending `direct_delivery` report to the platform. Keeps it for
  /// later if the platform is unreachable.
  Future<EventRecord> _sendReport(EventRecord event) async {
    final raw = event.pendingReport;
    if (raw == null) return event;
    final report = DirectDeliveryReport.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    try {
      final r = await api.submitEvent(_submission(event, report: report));
      final done = _withBusiness(event, r).copyWith(pendingReport: () => null);
      await repository.upsert(done);
      return done;
    } on ApiException catch (e) {
      if (e.isRetryable) return event;
      // Rejected (validation, revoked, ...): nothing more we can do with it.
      Log.e('delivery', 'report rejected for ${event.eventId}: ${e.code}');
      final dropped = event.copyWith(pendingReport: () => null);
      await repository.upsert(dropped);
      return dropped;
    } on NetworkException {
      return event;
    }
  }

  /// Retries outstanding direct-delivery reports (called by the retry queue).
  Future<void> flushReports() async {
    for (final e in await repository.withPendingReports()) {
      if (_inFlight.contains(e.eventId)) continue;
      _inFlight.add(e.eventId);
      try {
        await _sendReport(e);
      } finally {
        _inFlight.remove(e.eventId);
      }
    }
  }

  // ------------------------------------------------------ location updates --

  /// Sends one background location update (only for applications with location sharing on) and returns the
  /// endpoint's reply, whose `session_open` says whether to keep sharing. Never throws; a failure is null.
  /// Nothing is queued or retried: the next update replaces it.
  Future<EndpointReply?> sendLocationUpdate(DeviceConfig config, GeoFix fix) async {
    if (!config.shareLocation || !_isOnline()) return null;
    try {
      EndpointReply? reply;
      if (config.deliveryMode == DeliveryMode.direct) {
        final url = config.endpointUrl;
        final secret = config.signingSecret;
        if (url == null || url.isEmpty || !config.endpointEnabled || secret == null || secret.isEmpty) return null;
        if (!isHostAllowed(Uri.tryParse(url)?.host ?? '', config.allowedDomains)) return null;
        final id = const Uuid().v4();
        final req = signDirectRequest(
          payload: buildLocationPayload(id: id, config: config, fix: fix, now: _now()),
          eventId: id,
          config: config,
          secret: secret,
          now: _now(),
          nonce: _nonce(),
        );
        final res = await sendBytes(_http,
            method: 'POST', url: req.url, headers: req.headers, bytes: req.bodyBytes,
            timeout: config.timeout, maxBodyChars: 8192);
        if (res.statusCode >= 200 && res.statusCode < 300) reply = EndpointReply.fromBody(res.body);
      } else {
        final r = await api.postLocation(fix, timeout: config.timeout + const Duration(seconds: 15));
        reply = r.endpointReply;
      }
      if (reply != null) onEndpointReply?.call(reply);
      return reply;
    } catch (e) {
      // Offline, refused or timed out: the sharer simply tries again with the next fix.
      Log.d('delivery', 'location update not sent: ${e.runtimeType}');
      return null;
    }
  }

  // --------------------------------------------------------------- helpers --

  EventRecord _scheduleOrFail(
    EventRecord event,
    DeviceConfig config,
    String error,
    int? statusCode,
    Duration? retryAfter, {
    String? ref,
    String? requestId,
  }) {
    if (policy.canRetry(event.attempts, config.maxRetries)) {
      final delay = policy.delayFor(event.attempts, retryAfter: retryAfter);
      return event.copyWith(
        status: EventStatus.queued,
        lastError: () => error,
        lastStatusCode: () => statusCode,
        errorRef: () => ref,
        requestId: () => requestId,
        nextAttemptAt: () => _now().toUtc().add(delay),
      );
    }
    return event.copyWith(
      status: EventStatus.failed,
      lastError: () => 'Retries exhausted: $error',
      lastStatusCode: () => statusCode,
      errorRef: () => ref,
      requestId: () => requestId,
      nextAttemptAt: () => null,
    );
  }

  EventSubmission _submission(EventRecord e, {DirectDeliveryReport? report, GeoFix? location}) => EventSubmission(
    eventId: e.eventId,
    cardId: e.cardId,
    technologies: e.technologies,
    cardType: e.cardType,
    detectedAt: isoUtc(e.detectedAt),
    directDelivery: report,
    digitalCardToken: e.digitalCardToken,
    location: location,
  );
}
