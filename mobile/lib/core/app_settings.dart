import 'secure_store.dart';

/// Non-secret user preferences (stored alongside credentials; survives unregister).
class AppSettings {
  AppSettings(this._store);

  final SecureStore _store;
  static const _kBackgroundReading = 'pref_background_reading';

  /// "Read cards when app is closed". Default ON.
  Future<bool> get backgroundReading async => (await _store.read(_kBackgroundReading)) != 'false';

  Future<void> setBackgroundReading(bool on) => _store.write(_kBackgroundReading, on ? 'true' : 'false');
}
