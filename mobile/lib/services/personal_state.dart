import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

import '../core/app_error.dart';
import '../core/config.dart';
import '../core/error_catalog.dart';
import '../core/http_client.dart';
import '../core/links.dart';
import '../core/logger.dart';
import '../core/secure_store.dart';
import '../data/models/api_models.dart';
import '../data/models/personal.dart';
import '../data/personal_api.dart';
import 'hce_bridge.dart';
import 'platform_info.dart';

typedef PersonalApiFactory = PersonalApi Function(String baseUrl, String? token, void Function(ApiException) onUnauthorized);

/// The personal "My Card" space (Part 4 §8): session, cards, templates and the HCE cache.
class PersonalState extends ChangeNotifier {
  PersonalState({
    required this.store,
    required this.httpClient,
    required this.platform,
    this.hce = const NoHce(),
    PersonalApiFactory? apiFactory,
  }) : _factory = apiFactory ??
           ((base, token, onUnauthorized) =>
               HttpPersonalApi(client: httpClient, baseUrl: base, sessionToken: token, onUnauthorized: onUnauthorized));

  final SecureStore store;
  final http.Client httpClient;
  final PlatformInfo platform;
  final HceBridge hce;
  final PersonalApiFactory _factory;

  static const _kToken = 'personal_session_token';
  static const _kServer = 'personal_server_url';
  static const _kShareKey = 'personal_share_key';
  static const _kUser = 'personal_user';
  static const _kSessionId = 'personal_session_id';
  static const _kCards = 'personal_cards_cache';

  bool loading = true;
  String? serverUrl;
  PersonalUser? user;
  ShareKey? shareKey;
  String? sessionId;
  List<DigitalCard> cards = const [];
  List<CardTemplate> templates = CardTemplate.builtIn;
  bool hceSupported = false;
  String? notice;
  PersonalApi? api;
  bool _signingOut = false;

  bool get signedIn => api?.sessionToken != null;

  DigitalCard? get primary {
    for (final c in cards) {
      if (c.isPrimary) return c;
    }
    return cards.isEmpty ? null : cards.first;
  }

  CardTemplate templateFor(String id) =>
      templates.firstWhere((t) => t.id == id, orElse: () => CardTemplate.builtIn.firstWhere(
        (t) => t.id == id, orElse: () => CardTemplate.builtIn[1]));

  Future<void> init() async {
    hceSupported = await hce.isSupported();
    final token = await store.read(_kToken);
    final server = await store.read(_kServer);
    if (token != null && server != null) {
      serverUrl = server;
      sessionId = await store.read(_kSessionId);
      try {
        final sk = await store.read(_kShareKey);
        if (sk != null) shareKey = ShareKey.fromJson(jsonDecode(sk));
        final u = await store.read(_kUser);
        if (u != null) user = PersonalUser.fromJson(jsonDecode(u));
        final cached = await store.read(_kCards);
        if (cached != null) cards = (jsonDecode(cached) as List).map(DigitalCard.fromJson).toList();
      } catch (e) {
        Log.e('personal', 'cache read failed', e);
      }
      api = _factory(server, token, _onUnauthorized);
      unawaited(refresh());
    } else {
      // Not signed in: make sure nothing is served.
      await hce.clearCache();
      await hce.setEnabled(false);
    }
    loading = false;
    notifyListeners();
  }

  Future<SessionDevice> _device() async {
    final d = await platform.deviceDetails();
    final existing = await store.read('installation_id');
    final installationId = existing ?? const Uuid().v4();
    if (existing == null) await store.write('installation_id', installationId);
    return SessionDevice(
      deviceName: d.suggestedName, model: d.model, osVersion: d.osVersion, appVersion: d.appVersion,
      installationId: installationId);
  }

  Future<AppError?> signIn({required String server, required String email, required String password}) =>
      _signIn(server, (a, d) => a.signIn(email: email, password: password, device: d));

  /// Web "Sign in on your phone" QR (the login code is single-use and never stored).
  Future<AppError?> signInWithCode(LoginPayload p) =>
      _signIn(p.serverUrl, (a, d) => a.signInWithCode(loginCode: p.code, device: d));

  Future<AppError?> createAccount({
    required String server,
    required String fullName,
    required String email,
    required String password,
    String? phone,
  }) async {
    final urlError = ServerUrl.validate(server);
    if (urlError != null) return AppError(urlError);
    try {
      await _factory(ServerUrl.normalize(server), null, (_) {})
          .registerAccount(fullName: fullName, email: email, password: password, phone: phone);
    } on ApiException catch (e) {
      return AppError.api(e, switch (e.code) {
        'email_taken' || 'email_exists' || 'email_already_registered' => 'An account with this email already exists. Sign in instead.',
        'validation_error' => 'Please check the form: ${e.message}',
        _ => e.message,
      });
    } on NetworkException catch (e) {
      return AppError.network(e, 'Cannot reach the server: ');
    }
    return signIn(server: server, email: email, password: password);
  }

  Future<AppError?> _signIn(String server, Future<SessionGrant> Function(PersonalApi, SessionDevice) call) async {
    final urlError = ServerUrl.validate(server);
    if (urlError != null) return AppError(urlError);
    final base = ServerUrl.normalize(server);
    try {
      final a = _factory(base, null, _onUnauthorized);
      final grant = await call(a, await _device());
      a.sessionToken = grant.token;
      await store.write(_kToken, grant.token);
      await store.write(_kServer, base);
      await store.write(_kShareKey, jsonEncode(grant.shareKey.toJson()));
      await store.write(_kUser, jsonEncode(grant.user.toJson()));
      await store.write(_kSessionId, grant.session.id);
      api = a;
      serverUrl = base;
      user = grant.user;
      shareKey = grant.shareKey;
      sessionId = grant.session.id;
      cards = grant.cards;
      notice = null;
      await _saveCards();
      await syncHce();
      notifyListeners();
      unawaited(refresh());
      return null;
    } on ApiException catch (e) {
      return AppError.api(e, switch (e.code) {
        'invalid_credentials' => 'Wrong email or password.',
        'invalid_login_code' => 'This sign-in code was already used or has expired — create a new one on the web.',
        'personal_account_required' =>
          'This is a developer/business account. Create a personal account for My Card (you can use another email).',
        'account_disabled' => 'This account is disabled.',
        _ => e.message,
      });
    } on NetworkException catch (e) {
      return AppError.network(e, 'Cannot reach the server: ');
    }
  }

  /// Reloads cards and templates (errors are kept silent; cache stays).
  Future<void> refresh() async {
    final a = api;
    if (a == null) return;
    try {
      final fresh = await a.cards();
      if (api != a) return; // signed out meanwhile
      cards = fresh;
      await _saveCards();
      await syncHce();
      notifyListeners();
    } catch (e) {
      Log.d('personal', 'refresh failed: ${e.runtimeType}');
    }
    try {
      await a.heartbeat(); // POST /personal/sessions/current/heartbeat (start + resume)
    } catch (_) {}
    try {
      final t = await a.templates();
      if (t.isNotEmpty) {
        templates = t;
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> _saveCards() => store.write(_kCards, jsonEncode(cards.map((c) => c.raw.isEmpty ? {'id': c.id} : c.raw).toList()));

  bool _hceSyncing = false;
  bool _hceAgain = false;
  Completer<void>? _hceDone;

  /// Writes/clears the encrypted cache the HCE service serves, and toggles the service.
  /// Serialised: a sync requested while one runs re-runs afterwards with the latest state,
  /// so a late refresh can't leave the cache written after sign-out.
  Future<void> syncHce() async {
    _hceAgain = true;
    if (_hceSyncing) return _hceDone?.future;
    _hceSyncing = true;
    final done = _hceDone = Completer<void>();
    try {
      while (_hceAgain) {
        _hceAgain = false;
        try {
          await _syncHceNow();
        } catch (e) {
          Log.e('personal', 'HCE sync failed', e);
        }
      }
    } finally {
      _hceSyncing = false;
      done.complete();
    }
  }

  Future<void> _syncHceNow() async {
    final p = primary;
    final key = shareKey;
    final serve = signedIn && p != null && p.isActive && key != null && key.secret.isNotEmpty && p.shareId.isNotEmpty &&
        (p.shareSettings.nfcSharingEnabled || p.shareSettings.webPageEnabled);
    if (!serve) {
      await hce.setEnabled(false);
      await hce.clearCache();
      return;
    }
    await hce.setCache(
      shareId: p.shareId,
      keyId: key.keyId,
      secret: key.secret,
      publicUrl: p.publicUrl,
      webPageEnabled: p.shareSettings.webPageEnabled,
      nfcSharingEnabled: p.shareSettings.nfcSharingEnabled,
    );
    await hce.setEnabled(hceSupported);
  }

  void _replace(DigitalCard c) {
    final list = [...cards];
    final i = list.indexWhere((x) => x.id == c.id);
    if (i >= 0) {
      list[i] = c;
    } else {
      list.add(c);
    }
    if (c.isPrimary) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].id != c.id && list[j].isPrimary) list[j] = list[j].copyWith(isPrimary: false);
      }
    }
    cards = list;
  }

  Future<AppError?> _guard(Future<void> Function(PersonalApi a) op) async {
    final a = api;
    if (a == null) return AppError.mob(MobError.sessionExpired);
    try {
      await op(a);
      await _saveCards();
      await syncHce();
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return AppError.api(e, switch (e.code) {
        'field_locked' => 'Some fields are managed by your company and can\'t be changed.',
        'plan_limit_reached' => 'Your plan\'s card limit is reached.',
        _ => e.message,
      });
    } on NetworkException catch (e) {
      return AppError.network(e, 'Cannot reach the server: ');
    }
  }

  Future<AppError?> saveCard(DigitalCard draft) =>
      _guard((a) async => _replace(await a.updateCard(draft.id, draft.toPatch())));

  Future<AppError?> setPrimary(String id) => _guard((a) async => _replace(await a.setPrimary(id)));

  Future<AppError?> rotateShareId(String id) => _guard((a) async => _replace(await a.rotateShareId(id)));

  Future<AppError?> duplicateCard(String id) => _guard((a) async => _replace(await a.duplicateCard(id)));

  Future<AppError?> createCard(String label) => _guard((a) async => _replace(await a.createCard(label: label)));

  Future<AppError?> deleteCard(String id) => _guard((a) async {
    await a.deleteCard(id);
    cards = cards.where((c) => c.id != id).toList();
    await refresh();
  });

  Future<AppError?> uploadImage(String cardId, String kind, String path) => _guard((a) async {
    final updated = await a.uploadImage(cardId, kind, path);
    if (updated != null) {
      _replace(updated);
    } else {
      _replace(cards.firstWhere((c) => c.id == cardId));
      await refresh();
    }
  });

  Future<AppError?> deleteImage(String cardId, String kind) => _guard((a) async {
    await a.deleteImage(cardId, kind);
    final c = cards.firstWhere((c) => c.id == cardId);
    _replace(switch (kind) {
      'photo' => c.copyWith(photoUrl: () => null),
      'cover' => c.copyWith(coverUrl: () => null),
      _ => c.copyWith(logoUrl: () => null),
    });
  });

  /// Share settings of the primary card (auto-exchange, NFC sharing, web page).
  Future<AppError?> updateShareSettings(ShareSettings s) async {
    final p = primary;
    if (p == null) return const AppError('No card yet.');
    return _guard((a) async => _replace(await a.updateCard(p.id, {'share_settings': s.toJson()})));
  }

  void _onUnauthorized(ApiException e) {
    if (_signingOut) return;
    unawaited(signOut(
      remote: false,
      notice: 'Your session on this phone was revoked or expired. Sign in again. (${e.ref ?? MobError.sessionExpired.ref})',
    ));
  }

  /// Signs out: revokes this session (best effort), wipes the local session, share key
  /// and card cache, and disables the HCE service.
  Future<void> signOut({bool remote = true, String? notice}) async {
    if (_signingOut) return;
    _signingOut = true;
    try {
      final a = api;
      final id = sessionId;
      if (remote && a != null && id != null) {
        try {
          await a.revokeSession(id);
        } catch (_) {}
      }
      api = null;
      user = null;
      shareKey = null;
      sessionId = null;
      cards = const [];
      for (final k in [_kToken, _kShareKey, _kUser, _kSessionId, _kCards]) {
        await store.delete(k);
      }
      await syncHce(); // → disables the service and wipes the cache (after any pending sync)
      this.notice = notice;
      notifyListeners();
    } finally {
      _signingOut = false;
    }
  }

  /// Default server for the sign-in form.
  String get defaultServer => serverUrl ?? AppConfig.defaultServerUrl;
}
