import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Minimal key/value secret storage, abstracted for tests.
abstract class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Android Keystore-backed storage (flutter_secure_storage 11: AES-GCM data
/// encryption with a Keystore-wrapped key; the legacy Jetpack
/// EncryptedSharedPreferences backend was removed upstream).
class FlutterSecureStore implements SecureStore {
  FlutterSecureStore() : _storage = const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// In-memory implementation (tests / previews).
class MemorySecureStore implements SecureStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// Typed access to the few values this app persists as secrets.
///
/// The API key is intentionally absent: it is used once for registration
/// and never stored.
class CredentialStore {
  CredentialStore(this._store);

  final SecureStore _store;

  /// Underlying store (shared with non-secret preferences).
  SecureStore get store => _store;

  static const _kServerUrl = 'server_url';
  static const _kDeviceToken = 'device_token';
  static const _kInstallationId = 'installation_id';
  static const _kSigningSecret = 'signing_secret';
  static const _kConfigCache = 'device_config';

  Future<String?> get serverUrl => _store.read(_kServerUrl);
  Future<String?> get deviceToken => _store.read(_kDeviceToken);
  Future<String?> get signingSecret => _store.read(_kSigningSecret);

  /// Last known device config without its signing secret (for offline start).
  Future<String?> get cachedConfigJson => _store.read(_kConfigCache);

  /// Returns the installation id, generating and persisting it on first use.
  Future<String> installationId(String Function() generate) async {
    final existing = await _store.read(_kInstallationId);
    if (existing != null && existing.isNotEmpty) return existing;
    final id = generate();
    await _store.write(_kInstallationId, id);
    return id;
  }

  Future<void> saveRegistration({
    required String serverUrl,
    required String deviceToken,
  }) async {
    await _store.write(_kServerUrl, serverUrl);
    await _store.write(_kDeviceToken, deviceToken);
  }

  Future<void> saveSigningSecret(String? secret) async {
    if (secret == null || secret.isEmpty) {
      await _store.delete(_kSigningSecret);
    } else {
      await _store.write(_kSigningSecret, secret);
    }
  }

  Future<void> saveConfigCache(String json) => _store.write(_kConfigCache, json);

  /// Removes everything tied to the current registration. The installation id
  /// survives so re-registering replaces the old device server-side.
  Future<void> wipeRegistration() async {
    await _store.delete(_kDeviceToken);
    await _store.delete(_kSigningSecret);
    await _store.delete(_kConfigCache);
  }
}
