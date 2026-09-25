import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/core/pairing.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/services/app_state.dart';

import 'fakes.dart';

Map<String, dynamic> _config() => {
  'device_id': 'dev-1',
  'device_name': 'Pixel',
  'application': {'id': 'app-1', 'name': 'Gym'},
  'delivery_mode': 'relay',
  'endpoint_url': null,
  'endpoint_enabled': true,
  'timeout_seconds': 10,
  'max_retries': 3,
  'custom_headers': {},
  'signing_secret': null,
};

void main() {
  late MemorySecureStore store;
  var revoked = false;
  var pairingValid = true;
  String? registerAuth;
  Map<String, dynamic>? registerBody;

  AppState build() {
    final client = MockClient((req) async {
      final path = req.url.path;
      if (path.endsWith('/device/register')) {
        registerAuth = req.headers['Authorization'];
        registerBody = jsonDecode(req.body) as Map<String, dynamic>;
        if (registerAuth!.startsWith('Bearer nfcp_') && !pairingValid) {
          return http.Response(jsonEncode({'error': {'code': 'invalid_pairing_code', 'message': 'Invalid pairing code'}}), 401);
        }
        return http.Response(jsonEncode({'device': {}, 'device_token': 'nfcd_newtoken', 'config': _config()}), 201);
      }
      if (revoked) {
        return http.Response(jsonEncode({'error': {'code': 'device_revoked', 'message': 'Device revoked'}}), 401);
      }
      if (path.endsWith('/device/config')) return http.Response(jsonEncode(_config()), 200);
      if (path.endsWith('/device/heartbeat')) {
        return http.Response(jsonEncode({'status': 'active', 'server_time': '2026-09-25T08:30:21Z'}), 200);
      }
      return http.Response('', 404);
    });
    return AppState(
      credentials: CredentialStore(store),
      httpClient: client,
      platform: FakePlatformInfo(),
      repository: InMemoryEventRepository(),
    );
  }

  setUp(() {
    store = MemorySecureStore();
    revoked = false;
    pairingValid = true;
    registerAuth = null;
    registerBody = null;
  });

  test('register stores device token, server URL and installation id — never the API key', () async {
    final app = build();
    await app.init();
    expect(app.phase, AppPhase.setup);

    final err = await app.register(
      serverUrl: 'https://api.example.com/',
      apiKey: 'nfc_supersecretkey',
      deviceName: '',
    );
    expect(err, isNull);
    expect(app.phase, AppPhase.ready);
    expect(store.values['device_token'], 'nfcd_newtoken');
    expect(store.values['server_url'], 'https://api.example.com');
    expect(store.values['installation_id'], matches(RegExp(r'^[0-9a-f-]{36}$')));
    expect(store.values.values.any((v) => v.contains('nfc_supersecretkey')), isFalse);
    app.dispose();
  });

  test('rejects things that are not API keys before calling the server', () async {
    final app = build();
    await app.init();
    expect(await app.register(serverUrl: 'https://api.example.com', apiKey: 'nfcd_x', deviceName: 'a'), isNotNull);
    expect(await app.register(serverUrl: 'http://evil.example.com', apiKey: 'nfc_x', deviceName: 'a'), isNotNull);
    app.dispose();
  });

  test('401 device_revoked wipes credentials and returns to setup with an explanation', () async {
    final app = build();
    await app.init();
    await app.register(serverUrl: 'https://api.example.com', apiKey: 'nfc_k', deviceName: 'x');
    final installationId = store.values['installation_id'];

    revoked = true;
    await app.configSync!.sync();
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(app.phase, AppPhase.setup);
    expect(app.setupNotice, contains('revoked'));
    expect(store.values.containsKey('device_token'), isFalse);
    expect(store.values['installation_id'], installationId, reason: 'installation id survives');
    app.dispose();
  });

  const code = 'nfcp_AbCdEfGhIjKlMnOpQrStUvWxYz012345';

  test('QR pairing registers with Bearer nfcp_..., uses the QR name, never stores the code', () async {
    final app = build();
    await app.init();
    final pairing = PairingPayload.parse(
      'nfcterminal://pair?v=1&server=https%3A%2F%2Fapi.example.com&code=$code&name=Front%20desk',
    );
    expect(await app.registerWithPairing(pairing), isNull);
    expect(registerAuth, 'Bearer $code');
    expect(registerBody!['device_name'], 'Front desk');
    expect(registerBody!['platform'], 'android');
    expect(app.phase, AppPhase.ready);
    expect(app.pairedNotice, contains('api.example.com'));
    expect(app.pairedNotice, contains('Gym'));
    expect(store.values['device_token'], 'nfcd_newtoken');
    expect(store.values.values.any((v) => v.contains(code)), isFalse);
    app.dispose();
  });

  test('invalid_pairing_code shows the "already used or expired" message', () async {
    pairingValid = false;
    final app = build();
    await app.init();
    final err = await app.registerWithPairing(PairingPayload.parse(
      'nfcterminal://pair?v=1&server=https%3A%2F%2Fapi.example.com&code=$code',
    ));
    expect(err!.message, 'This code was already used or has expired — generate a new one in the dashboard.');
    expect(app.phase, AppPhase.setup);
    expect(store.values.containsKey('device_token'), isFalse);
    app.dispose();
  });
}
