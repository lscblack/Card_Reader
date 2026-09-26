/// Static, build-time configuration and protocol constants.
///
/// Nothing in here is secret.
class AppConfig {
  AppConfig._();

  /// Default server URL, overridable at build time with
  /// `--dart-define=API_BASE_URL=https://api.example.com`.
  /// `10.0.2.2` is the host machine as seen from the Android emulator.
  static const String defaultServerUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );

  static const String apiPrefix = '/api/v1';

  /// User-Agent used for direct deliveries (contract section 4).
  static const String terminalUserAgent = 'nexTap-Terminal/1.0';

  /// User-Agent used for calls to the platform API.
  static const String apiUserAgent = 'NFCTerminal-Android/1.0';

  static const Duration heartbeatInterval = Duration(seconds: 60);
  static const Duration configSyncInterval = Duration(minutes: 5);
  static const Duration apiTimeout = Duration(seconds: 20);

  /// Same UID read again within this window is ignored.
  static const Duration debounceWindow = Duration(milliseconds: 1500);

  /// Local history cap (oldest rows are pruned).
  static const int historyCap = 1000;

  /// Server rejects `detected_at` older than this (contract: 7 days).
  static const Duration maxEventAge = Duration(days: 7);
}
