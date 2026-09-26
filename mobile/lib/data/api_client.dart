import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../core/config.dart';
import '../core/http_client.dart';
import '../core/error_catalog.dart';
import '../core/logger.dart';
import 'models/api_models.dart';
import 'models/business.dart';
import 'models/device_config.dart';

/// Registration payload for `POST /device/register`.
class DeviceRegistration {
  const DeviceRegistration({
    required this.deviceName,
    required this.model,
    required this.osVersion,
    required this.appVersion,
    required this.installationId,
  });

  final String deviceName;
  final String model;
  final String osVersion;
  final String appVersion;
  final String installationId;

  Map<String, Object?> toJson() => {
    'device_name': deviceName,
    'platform': 'android',
    'model': model,
    'os_version': osVersion,
    'app_version': appVersion,
    'installation_id': installationId,
  };
}

/// Interface of the platform Device API, so services can be tested with fakes.
abstract class DeviceApi {
  /// [apiKey] is an API key (`nfc_...`) or a single-use pairing code (`nfcp_...`).
  Future<RegisterResult> register({required String apiKey, required DeviceRegistration registration});
  Future<DeviceConfig> getConfig();
  Future<HeartbeatResult> heartbeat();
  Future<EventSubmitResult> submitEvent(EventSubmission submission, {Duration? timeout});

  // Part 2 C3 — business devices with capabilities.
  Future<List<BusinessCardItem>> listBusinessCards({String? query, bool? programmed});
  /// [assignToBusiness]: the card belongs to the company itself (null = server default).
  /// [note] is sent for servers that store it (ignored otherwise).
  Future<BusinessCardItem> registerBusinessCard({
    required String uid,
    String? name,
    required String kind,
    bool? assignToBusiness,
    String? note,
  });
  Future<void> markCardProgrammed({required String cardId, required String uid});
}

/// HTTP implementation of [DeviceApi] (`{baseUrl}/api/v1/device/*`).
class ApiClient implements DeviceApi {
  ApiClient({
    required http.Client client,
    required String baseUrl,
    this.deviceToken,
    this.onUnauthorized,
    this.timeout = AppConfig.apiTimeout,
  }) : _client = client,
       _base = ServerUrl.normalize(baseUrl);

  final http.Client _client;
  final String _base;
  final Duration timeout;

  /// Device token (`nfcd_...`) used for all calls except registration.
  String? deviceToken;

  /// Called when a device-token call returns 401 (revoked / invalid token).
  void Function(ApiException error)? onUnauthorized;

  String get baseUrl => _base;

  Uri _uri(String path) => Uri.parse('$_base${AppConfig.apiPrefix}$path');

  @override
  Future<RegisterResult> register({
    required String apiKey,
    required DeviceRegistration registration,
  }) async {
    final json = await _request(
      'POST',
      '/device/register',
      bearer: apiKey,
      body: registration.toJson(),
      deviceAuth: false,
    );
    final token = json['device_token'];
    final config = json['config'];
    if (token is! String || !token.startsWith('nfcd_') || config is! Map) {
      throw const ApiException(
        statusCode: 200,
        code: 'invalid_response',
        message: 'Unexpected registration response from server',
        ref: 'MOB-1018',
      );
    }
    return RegisterResult(
      deviceToken: token,
      config: DeviceConfig.fromJson(config.cast<String, dynamic>()),
    );
  }

  @override
  Future<DeviceConfig> getConfig() async =>
      DeviceConfig.fromJson(await _request('GET', '/device/config'));

  @override
  Future<HeartbeatResult> heartbeat() async {
    final j = await _request('POST', '/device/heartbeat', body: const {});
    return HeartbeatResult(
      status: j['status'] as String? ?? 'unknown',
      serverTime: j['server_time'] as String?,
    );
  }

  @override
  Future<EventSubmitResult> submitEvent(EventSubmission submission, {Duration? timeout}) async {
    final j = await _request(
      'POST',
      '/device/events',
      body: submission.toJson(),
      // Relay: the header makes resubmits idempotent. Direct-mode reports
      // reuse the event_id for each new attempt, so the (optional) header is
      // omitted to avoid a generic idempotency cache swallowing attempt 2+.
      extraHeaders: submission.directDelivery == null ? {'Idempotency-Key': submission.eventId} : const {},
      timeout: timeout,
    );
    return EventSubmitResult.fromJson(j);
  }

  @override
  Future<List<BusinessCardItem>> listBusinessCards({String? query, bool? programmed}) async {
    final params = <String, String>{
      if (query != null && query.trim().isNotEmpty) 'q': query.trim(),
      if (programmed != null) 'programmed': '$programmed',
      'page_size': '100',
    };
    final qs = params.isEmpty ? '' : '?${Uri(queryParameters: params).query}';
    final raw = await _requestAny('GET', '/device/business/cards$qs');
    // Plain array per contract; also accept the paginated `{items: [...]}` shape.
    final list = raw is List ? raw : (raw is Map && raw['items'] is List ? raw['items'] as List : const []);
    return list.whereType<Map>().map((m) => BusinessCardItem.fromJson(m.cast<String, dynamic>())).toList();
  }

  @override
  Future<BusinessCardItem> registerBusinessCard({
    required String uid,
    String? name,
    required String kind,
    bool? assignToBusiness,
    String? note,
  }) async {
    final j = await _request('POST', '/device/business/cards', body: {
      'uid': uid,
      if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
      'kind': kind,
      'assign_to_business': ?assignToBusiness,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
    return BusinessCardItem.fromJson(j);
  }

  @override
  Future<void> markCardProgrammed({required String cardId, required String uid}) async {
    await _request('POST', '/device/business/cards/${Uri.encodeComponent(cardId)}/programmed', body: {'uid': uid});
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Object? body,
    String? bearer,
    bool deviceAuth = true,
    Map<String, String> extraHeaders = const {},
    Duration? timeout,
  }) async {
    final r = await _requestAny(method, path,
        body: body, bearer: bearer, deviceAuth: deviceAuth, extraHeaders: extraHeaders, timeout: timeout);
    return r is Map<String, dynamic> ? r : <String, dynamic>{};
  }

  Future<Object?> _requestAny(
    String method,
    String path, {
    Object? body,
    String? bearer,
    bool deviceAuth = true,
    Map<String, String> extraHeaders = const {},
    Duration? timeout,
  }) async {
    final token = bearer ?? (deviceAuth ? deviceToken : null);
    if (deviceAuth && token == null) {
      throw const ApiException(statusCode: 401, code: 'not_registered', message: 'Device is not registered');
    }
    final headers = <String, String>{
      'Accept': 'application/json',
      'User-Agent': AppConfig.apiUserAgent,
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
      ...extraHeaders,
    };
    final RawResponse res;
    try {
      res = await sendBytes(
        _client,
        method: method,
        url: _uri(path),
        headers: headers,
        bytes: body == null ? null : utf8.encode(jsonEncode(body)),
        timeout: timeout ?? this.timeout,
      );
    } on TimeoutException {
      throw const NetworkException('Request timed out', isTimeout: true);
    } on SocketException catch (e) {
      throw NetworkException('Server unreachable (${e.osError?.message ?? e.message})');
    } on HandshakeException {
      throw const NetworkException('TLS handshake failed', mob: MobError.tlsError);
    } on http.ClientException catch (e) {
      throw NetworkException('Connection error (${e.message})');
    }

    Log.d('api', '$method $path -> ${res.statusCode}');
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return null;
      try {
        return jsonDecode(res.body);
      } on FormatException {
        throw ApiException(
          statusCode: res.statusCode,
          code: 'invalid_response',
          message: 'Server returned invalid JSON',
          ref: MobError.invalidServerResponse.ref,
        );
      }
    }
    final error = parseError(res.statusCode, res.body, res.headers);
    if (deviceAuth && error.isAuthFailure) onUnauthorized?.call(error);
    throw error;
  }

  /// Parses the contract error envelope. Falls back to a generic error.
  static ApiException parseError(int status, String body, Map<String, String> headers) {
    String code = 'http_$status';
    String message = 'Request failed with HTTP $status';
    Object? details;
    String? ref, requestId, docsUrl;
    try {
      final j = jsonDecode(body);
      if (j is Map && j['error'] is Map) {
        final e = j['error'] as Map;
        code = e['code'] as String? ?? code;
        message = e['message'] as String? ?? message;
        details = e['details'];
        ref = e['ref'] as String?;
        requestId = e['request_id'] as String?;
        docsUrl = e['docs_url'] as String?;
      } else if (j is Map && j['detail'] != null) {
        // Plain FastAPI error shape, just in case.
        message = j['detail'].toString();
      }
    } catch (_) {
      // Non-JSON body (proxy error page etc.).
    }
    Duration? retryAfter;
    final ra = int.tryParse(headers['retry-after'] ?? '');
    if (ra != null && ra >= 0) retryAfter = Duration(seconds: ra);
    return ApiException(
      statusCode: status,
      code: code,
      message: message,
      details: details,
      retryAfter: retryAfter,
      ref: ref,
      // Fall back to the X-Request-ID header when the body doesn't carry it.
      requestId: requestId ?? headers['x-request-id'],
      docsUrl: docsUrl,
    );
  }
}
