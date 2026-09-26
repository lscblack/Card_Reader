import 'secure_store.dart';

/// Non-secret user preferences (stored alongside credentials; survives unregister).
class AppSettings {
  AppSettings(this._store);

  final SecureStore _store;
  static const _kBackgroundReading = 'pref_background_reading';
  static const _kAutoRunActions = 'pref_auto_run_actions';
  static const _kThemeMode = 'pref_theme_mode';

  /// Business terminals: open a recognized card's action automatically. Default ON.
  Future<bool> get autoRunActions async => (await _store.read(_kAutoRunActions)) != 'false';
  Future<void> setAutoRunActions(bool on) => _store.write(_kAutoRunActions, on ? 'true' : 'false');

  /// `system` | `light` | `dark`.
  Future<String> get themeMode async {
    final v = await _store.read(_kThemeMode);
    return const ['light', 'dark'].contains(v) ? v! : 'system';
  }

  Future<void> setThemeMode(String mode) => _store.write(_kThemeMode, mode);

  /// "Read cards when app is closed". Default ON.
  Future<bool> get backgroundReading async => (await _store.read(_kBackgroundReading)) != 'false';

  Future<void> setBackgroundReading(bool on) => _store.write(_kBackgroundReading, on ? 'true' : 'false');
}
