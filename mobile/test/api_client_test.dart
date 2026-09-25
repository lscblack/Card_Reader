import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/data/api_client.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/device_config.dart';

const _registration = DeviceRegistration(
  deviceName: 'Front desk Pixel',
  model: 'Pixel 8',
  osVersion: 'Android 15',
  appVersion: '1.0.0',
  installationId: 'inst-1',
);

Map<String, dynamic> _configJson({String mode = 'relay', String? secret}) => {
  'device_id': 'dev-1',
  'device_name': 'Front desk Pixel',
  'application': {'id': 'app-1', 'name': 'Gym'},
  'delivery_mode': mode,
  'endpoint_url': 'https://example.com/api/nfc/card',
  'endpoint_enabled': true,
  'timeout_seconds': 10,
  'max_retries': 3,
  'custom_headers': mode == 'direct' ? {'X-Tenant': 'a'} : {},
  'signing_secret': secret,
};

void main() {
  test('parses the error envelope', () {
    final e = ApiClient.parseError(
      422,
      jsonEncode({
        'error': {
          'code': 'validation_error',
          'message': 'Invalid body',
          'details': [
            {'field': 'body.card_id', 'message': 'bad'},
          ],
        },
      }),
      const {},
    );
    expect(e.statusCode, 422);
    expect(e.code, 'validation_error');
    expect(e.message, 'Invalid body');
    expect(e.details, isA<List>());
    expect(e.isRetryable, isFalse);
  });

  test('falls back for non-JSON errors and reads Retry-After', () {
    final e = ApiClient.parseError(429, '<html>busy</html>', const {'retry-after': '17'});
    expect(e.code, 'http_429');
    expect(e.retryAfter, const Duration(seconds: 17));
    expect(e.isRetryable, isTrue);
  });

  test('register sends API key as bearer, contract body, and parses token + config', () async {
    late http.Request seen;
    final api = ApiClient(
      client: MockClient((req) async {
        seen = req;
        return http.Response(
          jsonEncode({'device': {'id': 'dev-1'}, 'device_token': 'nfcd_abc', 'config': _configJson()}),
          201,
        );
      }),
      baseUrl: 'https://api.example.com/api/v1/',
    );
    final r = await api.register(apiKey: 'nfc_key', registration: _registration);
    expect(seen.url.toString(), 'https://api.example.com/api/v1/device/register');
    expect(seen.method, 'POST');
    expect(seen.headers['Authorization'], 'Bearer nfc_key');
    expect(jsonDecode(seen.body), {
      'device_name': 'Front desk Pixel',
      'platform': 'android',
      'model': 'Pixel 8',
      'os_version': 'Android 15',
      'app_version': '1.0.0',
      'installation_id': 'inst-1',
    });
    expect(r.deviceToken, 'nfcd_abc');
    expect(r.config.applicationName, 'Gym');
    expect(r.config.deliveryMode, DeliveryMode.relay);
  });

  test('register with a pairing code sends it as the bearer credential', () async {
    late http.Request seen;
    final api = ApiClient(
      client: MockClient((req) async {
        seen = req;
        return http.Response(jsonEncode({'device': {}, 'device_token': 'nfcd_abc', 'config': _configJson()}), 201);
      }),
      baseUrl: 'http://192.168.1.74:8000',
    );
    await api.register(apiKey: 'nfcp_AbCdEfGhIjKlMnOpQrStUvWxYz012345', registration: _registration);
    expect(seen.headers['Authorization'], 'Bearer nfcp_AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(seen.url.toString(), 'http://192.168.1.74:8000/api/v1/device/register');
  });

  test('allowed_domains is parsed from DeviceConfig (and defaults to empty)', () {
    final c = DeviceConfig.fromJson({..._configJson(), 'allowed_domains': ['api.example.com', '*.example.org']});
    expect(c.allowedDomains, ['api.example.com', '*.example.org']);
    expect(DeviceConfig.fromJson(_configJson()).allowedDomains, isEmpty);
    final back = DeviceConfig.fromJson(jsonDecode(c.toCacheJson()) as Map<String, dynamic>);
    expect(back.allowedDomains, ['api.example.com', '*.example.org']);
  });

  test('config parsing: direct mode with signing secret and custom headers', () async {
    final api = ApiClient(
      client: MockClient((req) async {
        expect(req.headers['Authorization'], 'Bearer nfcd_tok');
        return http.Response(jsonEncode(_configJson(mode: 'direct', secret: 'd' * 64)), 200);
      }),
      baseUrl: 'https://api.example.com',
      deviceToken: 'nfcd_tok',
    );
    final c = await api.getConfig();
    expect(c.deliveryMode, DeliveryMode.direct);
    expect(c.signingSecret, 'd' * 64);
    expect(c.customHeaders, {'X-Tenant': 'a'});
    expect(c.endpointHost, 'example.com');
    expect(c.timeout, const Duration(seconds: 10));
  });

  test('401 device_revoked triggers onUnauthorized and throws', () async {
    ApiException? seen;
    final api = ApiClient(
      client: MockClient((_) async => http.Response(
        jsonEncode({'error': {'code': 'device_revoked', 'message': 'Device revoked', 'details': null}}),
        401,
      )),
      baseUrl: 'https://api.example.com',
      deviceToken: 'nfcd_tok',
      onUnauthorized: (e) => seen = e,
    );
    await expectLater(
      api.heartbeat(),
      throwsA(isA<ApiException>().having((e) => e.isRevoked, 'isRevoked', isTrue)),
    );
    expect(seen?.code, 'device_revoked');
    expect(seen?.isAuthFailure, isTrue);
  });

  test('401 invalid_device_token also signs out; 403 application_disabled does not', () async {
    final seen = <String>[];
    ApiClient client(int status, String code) => ApiClient(
      client: MockClient((_) async => http.Response(jsonEncode({'error': {'code': code, 'message': code}}), status)),
      baseUrl: 'https://api.example.com',
      deviceToken: 'nfcd_tok',
      onUnauthorized: (e) => seen.add(e.code),
    );
    await expectLater(client(401, 'invalid_device_token').getConfig(), throwsA(isA<ApiException>()));
    await expectLater(
      client(403, 'application_disabled').getConfig(),
      throwsA(isA<ApiException>()
          .having((e) => e.isApplicationDisabled, 'disabled', isTrue)
          .having((e) => e.isRetryable, 'retryable', isTrue)),
    );
    expect(seen, ['invalid_device_token']);
  });

  test('409 event_id_conflict and 402 plan_limit_reached are final', () {
    expect(ApiClient.parseError(409, '{"error":{"code":"event_id_conflict","message":"x"}}', const {}).isRetryable, isFalse);
    expect(ApiClient.parseError(402, '{"error":{"code":"plan_limit_reached","message":"x"}}', const {}).isRetryable, isFalse);
  });

  test('401 during registration does NOT trigger the device sign-out hook', () async {
    var called = false;
    final api = ApiClient(
      client: MockClient((_) async => http.Response(
        jsonEncode({'error': {'code': 'invalid_api_key', 'message': 'Invalid API key'}}), 401)),
      baseUrl: 'https://api.example.com',
      onUnauthorized: (_) => called = true,
    );
    await expectLater(
      api.register(apiKey: 'nfc_bad', registration: _registration),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'invalid_api_key')),
    );
    expect(called, isFalse);
  });

  test('submitEvent sends Idempotency-Key and parses the result', () async {
    final api = ApiClient(
      client: MockClient((req) async {
        expect(req.headers['Idempotency-Key'], 'evt-1');
        return http.Response(
          jsonEncode({'event_id': 'evt-1', 'status': 'retrying', 'status_code': 502, 'latency_ms': 311, 'error': 'HTTP 502'}),
          201,
        );
      }),
      baseUrl: 'https://api.example.com',
      deviceToken: 'nfcd_tok',
    );
    final r = await api.submitEvent(const EventSubmission(
      eventId: 'evt-1', cardId: '04A1', technologies: ['NfcA'], cardType: null, detectedAt: '2026-09-25T08:30:21Z'));
    expect(r.status, 'retrying');
    expect(r.statusCode, 502);
    expect(r.latencyMs, 311);
  });

  test('socket errors become NetworkException', () async {
    final api = ApiClient(
      client: MockClient((_) async => throw const SocketException('refused')),
      baseUrl: 'https://api.example.com',
      deviceToken: 'nfcd_tok',
    );
    await expectLater(api.getConfig(), throwsA(isA<NetworkException>()));
  });
}
