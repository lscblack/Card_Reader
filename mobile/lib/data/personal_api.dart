import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../core/config.dart';
import '../core/error_catalog.dart';
import '../core/http_client.dart';
import '../core/logger.dart';
import 'api_client.dart';
import 'models/api_models.dart';
import 'models/personal.dart';

/// Device fields sent when creating a personal session.
class SessionDevice {
  const SessionDevice({
    required this.deviceName,
    required this.model,
    required this.osVersion,
    required this.appVersion,
    required this.installationId,
  });

  final String deviceName, model, osVersion, appVersion, installationId;

  Map<String, Object?> toJson() => {
    'device_name': deviceName,
    'platform': 'android',
    'model': model,
    'os_version': osVersion,
    'app_version': appVersion,
    'installation_id': installationId,
  };
}

/// Part 4 personal API (`/personal/*`, auth `Bearer nfcs_…`). Mockable.
abstract class PersonalApi {
  String get baseUrl;
  String? sessionToken;

  Future<SessionGrant> signIn({required String email, required String password, required SessionDevice device});
  Future<SessionGrant> signInWithCode({required String loginCode, required SessionDevice device});
  Future<void> registerAccount({required String fullName, required String email, required String password, String? phone});

  Future<List<PersonalSession>> sessions();
  Future<void> revokeSession(String id);
  Future<void> heartbeat();

  Future<List<DigitalCard>> cards();
  Future<DigitalCard> createCard({String label, String? templateId});
  Future<DigitalCard> updateCard(String id, Map<String, Object?> patch);
  Future<void> deleteCard(String id);
  Future<DigitalCard> setPrimary(String id);
  Future<DigitalCard> rotateShareId(String id);
  Future<DigitalCard> duplicateCard(String id);
  Future<DigitalCard?> uploadImage(String id, String kind, String filePath);
  Future<void> deleteImage(String id, String kind);
  Future<List<CardTemplate>> templates();
  Future<String> exchangeQr(String cardId);

  /// [via] = `nfc` | `qr` (Part 4 §9).
  Future<ExchangeResult> exchange(String token, {String? via});
  Future<List<Contact>> contacts({String? query, String? tag, bool? favorite});
  Future<Contact> updateContact(String id, Map<String, Object?> patch);
  Future<void> deleteContact(String id);
  Future<String> contactVcard(String id);

  Future<List<ActivityItem>> activity();
  Future<List<BusinessInvite>> businessInvites();
  Future<void> respondToInvite(String id, {required bool accept});
}

class HttpPersonalApi implements PersonalApi {
  HttpPersonalApi({required http.Client client, required String baseUrl, this.sessionToken, this.onUnauthorized})
    : _client = client,
      _base = ServerUrl.normalize(baseUrl);

  final http.Client _client;
  final String _base;

  @override
  String? sessionToken;

  /// A session call returned 401 (session revoked / expired).
  void Function(ApiException e)? onUnauthorized;

  @override
  String get baseUrl => _base;

  Uri _uri(String path, [Map<String, String>? q]) {
    final u = Uri.parse('$_base${AppConfig.apiPrefix}$path');
    return q == null || q.isEmpty ? u : u.replace(queryParameters: {...u.queryParameters, ...q});
  }

  Future<Object?> _call(String method, String path, {Object? body, Map<String, String>? query, bool auth = true}) async {
    final headers = <String, String>{
      'Accept': 'application/json',
      'User-Agent': AppConfig.apiUserAgent,
      if (auth && sessionToken != null) 'Authorization': 'Bearer $sessionToken',
      if (body != null) 'Content-Type': 'application/json',
    };
    final RawResponse res;
    try {
      res = await sendBytes(_client,
          method: method,
          url: _uri(path, query),
          headers: headers,
          bytes: body == null ? null : utf8.encode(jsonEncode(body)),
          timeout: AppConfig.apiTimeout);
    } on TimeoutException {
      throw const NetworkException('Request timed out', isTimeout: true);
    } on SocketException catch (e) {
      throw NetworkException('Server unreachable (${e.osError?.message ?? e.message})');
    } on HandshakeException {
      throw const NetworkException('TLS handshake failed', mob: MobError.tlsError);
    } on http.ClientException catch (e) {
      throw NetworkException('Connection error (${e.message})');
    }
    Log.d('personal', '$method $path -> ${res.statusCode}');
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return null;
      try {
        return jsonDecode(res.body);
      } on FormatException {
        // e.g. text/vcard
        return res.body;
      }
    }
    final e = ApiClient.parseError(res.statusCode, res.body, res.headers);
    if (auth && e.statusCode == 401 && sessionToken != null) onUnauthorized?.call(e);
    throw e;
  }

  static List<Object?> _items(Object? r) => r is List ? r : (r is Map && r['items'] is List ? r['items'] as List : const []);

  SessionGrant _grant(Object? r) {
    final j = r is Map ? r.cast<String, dynamic>() : <String, dynamic>{};
    final token = j['session_token'];
    if (token is! String || !token.startsWith('nfcs_')) {
      throw const ApiException(statusCode: 200, code: 'invalid_response', message: 'Unexpected sign-in response', ref: 'MOB-1018');
    }
    return SessionGrant(
      token: token,
      session: PersonalSession.fromJson(j['session']),
      user: PersonalUser.fromJson(j['user']),
      shareKey: ShareKey.fromJson(j['share_key']),
      cards: _items(j['cards']).map(DigitalCard.fromJson).toList(),
    );
  }

  @override
  Future<SessionGrant> signIn({required String email, required String password, required SessionDevice device}) async =>
      _grant(await _call('POST', '/personal/sessions',
          body: {'email': email.trim(), 'password': password, ...device.toJson()}, auth: false));

  @override
  Future<SessionGrant> signInWithCode({required String loginCode, required SessionDevice device}) async =>
      _grant(await _call('POST', '/personal/sessions', body: {'login_code': loginCode, ...device.toJson()}, auth: false));

  @override
  Future<void> registerAccount({required String fullName, required String email, required String password, String? phone}) =>
      _call('POST', '/auth/register', auth: false, body: {
        'account_type': 'personal',
        'full_name': fullName.trim(),
        'email': email.trim(),
        'password': password,
        if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
      });

  @override
  Future<List<PersonalSession>> sessions() async => _items(await _call('GET', '/personal/sessions')).map(PersonalSession.fromJson).toList();

  @override
  Future<void> revokeSession(String id) => _call('DELETE', '/personal/sessions/${Uri.encodeComponent(id)}');

  @override
  Future<void> heartbeat() => _call('POST', '/personal/sessions/current/heartbeat', body: const {});

  @override
  Future<List<DigitalCard>> cards() async => _items(await _call('GET', '/personal/cards')).map(DigitalCard.fromJson).toList();

  @override
  Future<DigitalCard> createCard({String label = 'New card', String? templateId}) async => DigitalCard.fromJson(
      await _call('POST', '/personal/cards', body: {'label': label, 'template_id': ?templateId}));

  @override
  Future<DigitalCard> updateCard(String id, Map<String, Object?> patch) async =>
      DigitalCard.fromJson(await _call('PATCH', '/personal/cards/${Uri.encodeComponent(id)}', body: patch));

  @override
  Future<void> deleteCard(String id) => _call('DELETE', '/personal/cards/${Uri.encodeComponent(id)}');

  @override
  Future<DigitalCard> setPrimary(String id) async =>
      DigitalCard.fromJson(await _call('POST', '/personal/cards/${Uri.encodeComponent(id)}/primary', body: const {}));

  @override
  Future<DigitalCard> rotateShareId(String id) async =>
      DigitalCard.fromJson(await _call('POST', '/personal/cards/${Uri.encodeComponent(id)}/rotate-share-id', body: const {}));

  @override
  Future<DigitalCard> duplicateCard(String id) async =>
      DigitalCard.fromJson(await _call('POST', '/personal/cards/${Uri.encodeComponent(id)}/duplicate', body: const {}));

  @override
  Future<DigitalCard?> uploadImage(String id, String kind, String filePath) async {
    final req = http.MultipartRequest('POST', _uri('/personal/cards/${Uri.encodeComponent(id)}/images', {'kind': kind}))
      ..headers.addAll({
        'Accept': 'application/json',
        'User-Agent': AppConfig.apiUserAgent,
        if (sessionToken != null) 'Authorization': 'Bearer $sessionToken',
      })
      ..files.add(await http.MultipartFile.fromPath('file', filePath));
    final http.Response res;
    try {
      res = await http.Response.fromStream(await _client.send(req)).timeout(const Duration(seconds: 60));
    } on TimeoutException {
      throw const NetworkException('Upload timed out', isTimeout: true);
    } on SocketException catch (e) {
      throw NetworkException('Server unreachable (${e.message})');
    }
    final body = utf8.decode(res.bodyBytes, allowMalformed: true);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      final j = body.isEmpty ? null : jsonDecode(body);
      return j is Map && j['id'] != null ? DigitalCard.fromJson(j) : null;
    }
    throw ApiClient.parseError(res.statusCode, body, res.headers);
  }

  @override
  Future<void> deleteImage(String id, String kind) =>
      _call('DELETE', '/personal/cards/${Uri.encodeComponent(id)}/images', query: {'kind': kind});

  @override
  Future<List<CardTemplate>> templates() async =>
      _items(await _call('GET', '/personal/templates', auth: false)).map(CardTemplate.fromJson).toList();

  @override
  Future<String> exchangeQr(String cardId) async {
    final r = await _call('GET', '/personal/cards/${Uri.encodeComponent(cardId)}/exchange-qr');
    return (r is Map ? r['qr_payload'] : null)?.toString() ?? '';
  }

  @override
  Future<ExchangeResult> exchange(String token, {String? via}) async =>
      ExchangeResult.fromJson(await _call('POST', '/personal/exchanges', body: {'token': token, 'via': ?via}));

  @override
  Future<List<Contact>> contacts({String? query, String? tag, bool? favorite}) async => _items(await _call(
    'GET',
    '/personal/contacts',
    query: {
      if (query != null && query.trim().isNotEmpty) 'q': query.trim(),
      'tag': ?tag,
      if (favorite != null) 'favorite': '$favorite',
      'page_size': '100',
    },
  )).map(Contact.fromJson).toList();

  @override
  Future<Contact> updateContact(String id, Map<String, Object?> patch) async =>
      Contact.fromJson(await _call('PATCH', '/personal/contacts/${Uri.encodeComponent(id)}', body: patch));

  @override
  Future<void> deleteContact(String id) => _call('DELETE', '/personal/contacts/${Uri.encodeComponent(id)}');

  @override
  Future<String> contactVcard(String id) async =>
      (await _call('GET', '/personal/contacts/${Uri.encodeComponent(id)}/vcard'))?.toString() ?? '';

  @override
  Future<List<ActivityItem>> activity() async => _items(await _call('GET', '/personal/activity')).map(ActivityItem.fromJson).toList();

  @override
  Future<List<BusinessInvite>> businessInvites() async =>
      _items(await _call('GET', '/personal/business-invites')).map(BusinessInvite.fromJson).toList();

  @override
  Future<void> respondToInvite(String id, {required bool accept}) =>
      _call('POST', '/personal/business-invites/${Uri.encodeComponent(id)}/${accept ? 'accept' : 'decline'}', body: const {});
}
