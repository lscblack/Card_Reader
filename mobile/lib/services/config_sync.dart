import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../core/config.dart';
import '../core/logger.dart';
import '../core/secure_store.dart';
import '../data/api_client.dart';
import '../data/models/api_models.dart';
import '../data/models/device_config.dart';

/// Keeps the device config fresh (start, every few minutes, pull-to-refresh)
/// and sends heartbeats while the app is in the foreground.
///
/// The signing secret only lives in memory and in secure storage.
class ConfigSync extends ChangeNotifier {
  ConfigSync({required this.api, required this.credentials, DateTime Function()? clock})
    : _now = clock ?? DateTime.now;

  final DeviceApi api;
  final CredentialStore credentials;
  final DateTime Function() _now;

  DeviceConfig? _config;
  DeviceConfig? get config => _config;

  /// null = unknown yet.
  bool? serverReachable;
  DateTime? lastSyncAt;
  DateTime? lastHeartbeatAt;
  String? lastError;
  bool syncing = false;

  /// The application is paused in the dashboard (`403 application_disabled`).
  bool applicationDisabled = false;

  Timer? _heartbeatTimer;
  Timer? _syncTimer;
  bool _disposed = false;

  /// Restores the last known config (offline start).
  Future<void> loadCached() async {
    try {
      final raw = await credentials.cachedConfigJson;
      if (raw == null) return;
      final cfg = DeviceConfig.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      _config = cfg.withSigningSecret(await credentials.signingSecret);
      _notify();
    } catch (e) {
      Log.e('config', 'cannot read cached config', e);
    }
  }

  /// Applies and persists a config (from registration or sync).
  Future<void> apply(DeviceConfig cfg) async {
    _config = cfg;
    await credentials.saveSigningSecret(
      cfg.deliveryMode == DeliveryMode.direct ? cfg.signingSecret : null,
    );
    await credentials.saveConfigCache(cfg.toCacheJson());
    _notify();
  }

  /// Fetches `GET /device/config`. Returns true on success.
  Future<bool> sync() async {
    if (syncing || _disposed) return false;
    syncing = true;
    _notify();
    try {
      final cfg = await api.getConfig();
      await apply(cfg);
      serverReachable = true;
      applicationDisabled = false;
      lastSyncAt = _now();
      lastError = null;
      Log.d('config', 'synced $cfg');
      return true;
    } on ApiException catch (e) {
      serverReachable = true;
      applicationDisabled = e.isApplicationDisabled;
      lastError = e.message;
      return false;
    } on NetworkException catch (e) {
      serverReachable = false;
      lastError = e.message;
      return false;
    } finally {
      syncing = false;
      _notify();
    }
  }

  Future<void> heartbeat() async {
    if (_disposed) return;
    try {
      await api.heartbeat();
      serverReachable = true;
      applicationDisabled = false;
      lastHeartbeatAt = _now();
    } on ApiException catch (e) {
      serverReachable = true;
      applicationDisabled = e.isApplicationDisabled;
      lastError = e.message;
    } on NetworkException catch (e) {
      serverReachable = false;
      lastError = e.message;
    }
    _notify();
  }

  /// Starts foreground timers and does an immediate sync + heartbeat.
  void start() {
    stop();
    _heartbeatTimer = Timer.periodic(AppConfig.heartbeatInterval, (_) => heartbeat());
    _syncTimer = Timer.periodic(AppConfig.configSyncInterval, (_) => sync());
    unawaited(sync().then((_) => heartbeat()));
  }

  void stop() {
    _heartbeatTimer?.cancel();
    _syncTimer?.cancel();
    _heartbeatTimer = null;
    _syncTimer = null;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    stop();
    super.dispose();
  }
}
