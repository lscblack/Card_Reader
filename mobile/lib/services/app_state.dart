import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

import '../core/http_client.dart';
import '../core/logger.dart';
import '../core/app_error.dart';
import '../core/app_settings.dart';
import '../core/config.dart';
import '../core/pairing.dart';
import '../core/secure_store.dart';
import '../data/api_client.dart';
import '../data/event_repository.dart';
import '../data/models/api_models.dart';
import '../data/models/device_config.dart';
import '../data/models/event_record.dart';
import 'config_sync.dart';
import 'delivery_service.dart';
import 'platform_info.dart';
import 'retry_queue.dart';
import 'tag_dispatch.dart';
import 'update_check.dart';

enum AppPhase { loading, setup, ready }

/// Factory for [DeviceApi] so tests can inject a fake.
typedef DeviceApiFactory =
    DeviceApi Function(String baseUrl, String? token, void Function(ApiException) onUnauthorized);

/// Top-level session state: registration, config sync, delivery and the
/// retry queue. Contains no card business logic.
class AppState extends ChangeNotifier {
  AppState({
    required this.credentials,
    required this.httpClient,
    required this.platform,
    required this.repository,
    DeviceApiFactory? apiFactory,
    this.tagDispatch = const NoTagDispatch(),
    AppSettings? settings,
  }) : settings = settings ?? AppSettings(credentials.store),
       _apiFactory = apiFactory ??
           ((base, token, onUnauthorized) => ApiClient(
             client: httpClient,
             baseUrl: base,
             deviceToken: token,
             onUnauthorized: onUnauthorized,
           ));

  final CredentialStore credentials;
  final http.Client httpClient;
  final PlatformInfo platform;
  final EventRepository repository;
  final DeviceApiFactory _apiFactory;
  final TagDispatch tagDispatch;
  final AppSettings settings;

  /// "Read cards when app is closed": background taps on a terminal are delivered as events
  /// (off: they only run the card's action, like on an unregistered phone).
  bool backgroundReading = true;

  AppPhase phase = AppPhase.loading;

  /// Business terminals: open a recognized card's action automatically.
  bool autoRunActions = true;

  /// `system` | `light` | `dark` (Settings → Appearance).
  String themeMode = 'system';

  /// Dispatched tags (card tapped while the app wasn't reading) go to the terminal as events;
  /// otherwise the app runs the card's action (guest tap).
  bool get terminalTakesDispatchedTags => phase == AppPhase.ready && backgroundReading;

  Future<void> setAutoRunActions(bool on) async {
    autoRunActions = on;
    notifyListeners();
    await settings.setAutoRunActions(on);
  }

  Future<void> setThemeMode(String mode) async {
    themeMode = const ['light', 'dark'].contains(mode) ? mode : 'system';
    notifyListeners();
    await settings.setThemeMode(themeMode);
  }

  /// Shown on the setup screen (e.g. why the device was signed out).
  String? setupNotice;
  String? serverUrl;
  DeviceDetails? device;
  bool online = true;

  DeviceApi? _api;
  ConfigSync? configSync;
  DeliveryService? delivery;
  RetryQueue? retryQueue;
  StreamSubscription<bool>? _onlineSub;
  bool _handlingAuthFailure = false;

  DeviceConfig? get config => configSync?.config;

  Future<void> init() async {
    device = await platform.deviceDetails();
    online = await platform.isOnline();
    _onlineSub = platform.onlineChanges.listen((isOnline) {
      final regained = isOnline && !online;
      online = isOnline;
      notifyListeners();
      if (regained) {
        unawaited(configSync?.sync());
        unawaited(retryQueue?.kick());
      }
    });

    backgroundReading = await settings.backgroundReading;
    autoRunActions = await settings.autoRunActions;
    themeMode = await settings.themeMode;
    final url = await credentials.serverUrl;
    final token = await credentials.deviceToken;
    serverUrl = url;
    if (url != null && token != null) {
      await _startSession(url, token);
      phase = AppPhase.ready;
    } else {
      phase = AppPhase.setup;
    }
    unawaited(checkForUpdate(force: true));
    _updateTimer = Timer.periodic(UpdateChecker.interval, (_) => checkForUpdate());
    // Keep the alias in sync with the stored choice (and off when not registered).
    // Always on: a card tapped while the app is closed opens nexTap, which runs the card's action
    // (guest) or — on terminals with background reading — delivers the event. Cards with an http(s)
    // NDEF link are still opened by Android's NDEF dispatch (NDEF_DISCOVERED wins over our TECH filter).
    await tagDispatch.setDispatchEnabled(true);
    notifyListeners();
  }

  /// Registers this phone. The API key is only used for this call and is
  /// never stored. Returns an error message, or null on success.
  Future<AppError?> register({
    required String serverUrl,
    required String apiKey,
    required String deviceName,
  }) async {
    final key = apiKey.trim();
    if (!key.startsWith('nfc_') || key.startsWith('nfcd_')) {
      return const AppError('That does not look like an API key (it starts with "nfc_").');
    }
    return _register(serverUrl: serverUrl, credential: key, deviceName: deviceName);
  }

  /// Registers with a single-use pairing code from a QR code (contract 7.3).
  /// The code is never stored. Returns an error message, or null on success.
  Future<AppError?> registerWithPairing(PairingPayload pairing, {String? deviceName}) async {
    return _register(
      serverUrl: pairing.serverUrl,
      credential: pairing.code,
      deviceName: deviceName ?? pairing.deviceName ?? '',
      onSuccess: () => pairedNotice =
          'Paired with ${config?.applicationName ?? 'your application'} on ${pairing.serverHost}',
    );
  }

  /// One-time message shown after a successful QR pairing.
  String? pairedNotice;

  Future<AppError?> _register({
    required String serverUrl,
    required String credential,
    required String deviceName,
    void Function()? onSuccess,
  }) async {
    final urlError = ServerUrl.validate(serverUrl);
    if (urlError != null) return AppError(urlError);
    final base = ServerUrl.normalize(serverUrl);
    final details = device ?? await platform.deviceDetails();
    final installationId = await credentials.installationId(() => const Uuid().v4());
    try {
      final api = _apiFactory(base, null, (_) {});
      final result = await api.register(
        apiKey: credential,
        registration: DeviceRegistration(
          deviceName: deviceName.trim().isEmpty ? details.suggestedName : deviceName.trim(),
          model: details.model,
          osVersion: details.osVersion,
          appVersion: details.appVersion,
          installationId: installationId,
        ),
      );
      await credentials.saveRegistration(serverUrl: base, deviceToken: result.deviceToken);
      this.serverUrl = base;
      await _startSession(base, result.deviceToken, initial: result.config);
      setupNotice = null;
      onSuccess?.call();
      phase = AppPhase.ready;
      notifyListeners();
      if (backgroundReading) {
        await tagDispatch.setDispatchEnabled(true);
        unawaited(tagDispatch.requestNotificationPermission());
      }
      return null;
    } on ApiException catch (e) {
      return AppError.api(e, registrationErrorMessage(e, pairing: credential.startsWith('nfcp_')));
    } on NetworkException catch (e) {
      return AppError.network(e, 'Cannot reach the server: ');
    }
  }

  /// User-facing message for a failed `POST /device/register`.
  /// With [pairing], any 401 means the single-use code was not accepted.
  static String registrationErrorMessage(ApiException e, {bool pairing = false}) => switch (e.code) {
    _ when pairing && e.statusCode == 401 =>
      'This code was already used or has expired — generate a new one in the dashboard.',
    'invalid_pairing_code' =>
      'This code was already used or has expired — generate a new one in the dashboard.',
    'invalid_api_key' => 'Invalid API key. Check that you copied the whole key.',
    'api_key_revoked' => 'This API key was revoked. Create a new one in the dashboard.',
    'application_disabled' => 'This application is paused in the dashboard.',
    'plan_limit_reached' => 'Plan limit reached: ${e.message}',
    _ when e.statusCode == 401 || e.statusCode == 403 => 'Registration rejected: ${e.message}',
    _ => e.message,
  };

  Future<void> _startSession(String base, String token, {DeviceConfig? initial}) async {
    final api = _apiFactory(base, token, _onUnauthorized);
    _api = api;
    final sync = ConfigSync(api: api, credentials: credentials);
    if (initial != null) {
      await sync.apply(initial);
    } else {
      await sync.loadCached();
    }
    sync.addListener(notifyListeners);
    configSync = sync;
    delivery = DeliveryService(
      api: api,
      httpClient: httpClient,
      repository: repository,
      isOnline: () => online,
    );
    retryQueue = RetryQueue(repository: repository, delivery: delivery!, configProvider: () => configSync?.config)
      ..start();
    sync.start();
  }

  Future<void> _endSession() async {
    retryQueue?.stop();
    retryQueue = null;
    delivery = null;
    final sync = configSync;
    configSync = null;
    _api = null;
    sync?.removeListener(notifyListeners);
    sync?.dispose();
  }

  /// Local events that can no longer be sent with these credentials.
  Future<void> _abandonQueued(String reason) async {
    for (final e in await repository.list(status: EventStatus.queued, limit: 5000)) {
      await repository.upsert(e.copyWith(
        status: EventStatus.failed,
        lastError: () => reason,
        nextAttemptAt: () => null,
        pendingReport: () => null,
      ));
    }
  }

  void _onUnauthorized(ApiException e) {
    if (_handlingAuthFailure || phase != AppPhase.ready) return;
    _handlingAuthFailure = true;
    Log.d('session', 'device token rejected (${e.code}), signing out');
    unawaited(() async {
      try {
        await _endSession();
        await credentials.wipeRegistration();
        await tagDispatch.setDispatchEnabled(true); // guest taps keep working
        await _abandonQueued('Not sent: device signed out (${e.code})');
        setupNotice = e.isRevoked
            ? 'This device was revoked from the dashboard. Register it again with a valid API key.'
            : 'The server no longer accepts this device (${e.code}). Register it again with a valid API key.';
        phase = AppPhase.setup;
        notifyListeners();
      } finally {
        _handlingAuthFailure = false;
      }
    }());
  }

  /// Wipes local credentials. History is kept; queued events are abandoned.
  Future<void> unregister() async {
    await _endSession();
    await credentials.wipeRegistration();
    await tagDispatch.setDispatchEnabled(true); // guest taps keep working
    await _abandonQueued('Not sent: device unregistered');
    setupNotice = 'Device unregistered. Its record stays in the dashboard until you delete it there.';
    phase = AppPhase.setup;
    notifyListeners();
  }

  /// Turns "Read cards when app is closed" on/off and persists the choice.
  /// Returns false when notifications were refused (reading still works; MOB-1016).
  Future<bool> setBackgroundReading(bool on) async {
    backgroundReading = on;
    notifyListeners();
    await settings.setBackgroundReading(on);
    if (on) return tagDispatch.requestNotificationPermission();
    return true;
  }

  /// Foreground: sync, heartbeat and retry what's due.
  void onResumed() {
    configSync?.start();
    unawaited(checkForUpdate());
    unawaited(retryQueue?.kick());
    unawaited(platform.isOnline().then((v) {
      online = v;
      notifyListeners();
    }));
  }

  /// Background: stop heartbeats (they only run in the foreground).
  void onPaused() => configSync?.stop();

  bool get hasApi => _api != null;

  /// Newer APK published on the server (Part 3 §9), if any.
  AppRelease? availableUpdate;
  UpdateChecker? _updates;
  Timer? _updateTimer;

  /// Checks for an app update now if due (start, daily, resume). Never throws.
  Future<void> checkForUpdate({bool force = false}) async {
    final updates = _updates ??= UpdateChecker(client: httpClient, installedBuild: device?.buildNumber ?? 0);
    if (!force && !updates.isDue) return;
    final release = await updates.check(serverUrl ?? AppConfig.defaultServerUrl);
    if (release?.buildNumber != availableUpdate?.buildNumber) {
      availableUpdate = release;
      notifyListeners();
    }
  }

  /// Device API of the current session (null when not registered).
  DeviceApi? get api => _api;

  @override
  void dispose() {
    _onlineSub?.cancel();
    _updateTimer?.cancel();
    unawaited(_endSession());
    super.dispose();
  }
}
