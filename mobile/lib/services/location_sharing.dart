import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../core/logger.dart';
import '../data/models/api_models.dart' show GeoFix;
import '../data/models/device_config.dart';
import '../data/models/endpoint_reply.dart';

/// Where the phone stands on location access.
enum LocationAccess { unknown, granted, denied, deniedForever, serviceOff }

/// The platform side of location sharing (a seam so the sharer can be tested without a device).
abstract class LocationSource {
  /// Current state, never prompts.
  Future<LocationAccess> access();

  /// Shows the system permission dialog ("while using the app"; background sharing runs as a foreground
  /// service / with the system indicator, so "always" is not needed).
  Future<LocationAccess> request();

  /// A fix for a tap: the current position, else the last known one. Null when none is available in time.
  Future<GeoFix?> fixNow({Duration timeout = const Duration(seconds: 3)});

  /// Position updates while a session is open. On Android this runs as a foreground service with an ongoing
  /// notification ([title] / [text]); on iOS the system shows the blue location indicator.
  Stream<GeoFix> background({required String title, required String text});

  Future<void> openSettings();
}

class GeolocatorSource implements LocationSource {
  const GeolocatorSource();

  LocationAccess _map(LocationPermission p) => switch (p) {
    LocationPermission.whileInUse || LocationPermission.always => LocationAccess.granted,
    LocationPermission.deniedForever => LocationAccess.deniedForever,
    _ => LocationAccess.denied,
  };

  @override
  Future<LocationAccess> access() async {
    if (!await Geolocator.isLocationServiceEnabled()) return LocationAccess.serviceOff;
    return _map(await Geolocator.checkPermission());
  }

  @override
  Future<LocationAccess> request() async {
    final current = await Geolocator.checkPermission();
    final p = current == LocationPermission.denied ? await Geolocator.requestPermission() : current;
    if (!await Geolocator.isLocationServiceEnabled()) return LocationAccess.serviceOff;
    return _map(p);
  }

  static GeoFix _fix(Position p) =>
      GeoFix(lat: p.latitude, lng: p.longitude, accuracyM: p.accuracy.isFinite ? p.accuracy : null);

  @override
  Future<GeoFix?> fixNow({Duration timeout = const Duration(seconds: 3)}) async {
    try {
      final p = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(accuracy: LocationAccuracy.high, timeLimit: timeout),
      );
      return _fix(p);
    } catch (_) {
      try {
        final last = await Geolocator.getLastKnownPosition();
        return last == null ? null : _fix(last);
      } catch (_) {
        return null;
      }
    }
  }

  @override
  Stream<GeoFix> background({required String title, required String text}) {
    final LocationSettings settings = defaultTargetPlatform == TargetPlatform.android
        ? AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 0,
            intervalDuration: const Duration(seconds: 30),
            foregroundNotificationConfig: ForegroundNotificationConfig(
              notificationTitle: title,
              notificationText: text,
              notificationIcon: const AndroidResource(name: 'ic_launcher', defType: 'mipmap'),
              setOngoing: true,
            ),
          )
        : AppleSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 0,
            pauseLocationUpdatesAutomatically: false,
            allowBackgroundLocationUpdates: true,
            showBackgroundLocationIndicator: true,
          );
    return Geolocator.getPositionStream(locationSettings: settings).map(_fix);
  }

  @override
  Future<void> openSettings() async {
    await Geolocator.openAppSettings();
  }
}

/// Location sharing, opt-in per application ([DeviceConfig.shareLocation]).
///
/// * With each tap: [fixForTap] gives a fix (never prompts, null without permission or when sharing is off).
/// * In the background: only while the endpoint says a session is open (`session_open: true` in a reply).
///   Every [interval] the latest fix goes to the endpoint as a `location.update`; its reply keeps the session
///   going or ends it (`session_open: false`). Sharing also stops when the application's setting goes off, when
///   the user taps "Stop sharing", and after [maxSilence] without a reply saying the session is still open.
///
/// While sharing, [active] is true and the UI shows a persistent indicator (plus the system's own: a
/// notification on Android, the blue pill on iOS).
///
/// Every start is guarded by [_gen]: any stop or state change bumps it, so a start that was waiting on the
/// platform (permission check) never goes ahead after sharing was stopped, and two starts never both run.
class LocationSharing extends ChangeNotifier {
  LocationSharing({
    required this.source,
    required this.configProvider,
    required this.send,
    this.interval = const Duration(seconds: 60),
    this.maxSilence = const Duration(minutes: 30),
    DateTime Function()? clock,
  }) : _now = clock ?? DateTime.now;

  final LocationSource source;
  final DeviceConfig? Function() configProvider;

  /// Sends one `location.update` ([DeliveryService.sendLocationUpdate]); true when the endpoint accepted it.
  /// The reply itself comes back through [onReply].
  final Future<bool> Function(DeviceConfig config, GeoFix fix) send;
  final Duration interval;
  final Duration maxSilence;
  final DateTime Function() _now;

  /// Consecutive failed updates after which the indicator says updates are not getting through.
  static const failuresBeforeWarning = 2;

  LocationAccess access = LocationAccess.unknown;

  /// Set when sharing could not start or died (platform error): the UI says so and offers a retry.
  String? problem;

  /// Consecutive background updates the endpoint did not accept.
  int failedUpdates = 0;

  /// The endpoint's last word: a session is open. Sharing runs only while this is true and the setting is on.
  bool _sessionOpen = false;
  bool _userPaused = false;
  DateTime? _lastOpenReply;
  GeoFix? _last;
  DateTime? _lastAt;
  StreamSubscription<GeoFix>? _sub;
  Timer? _timer;
  bool _disposed = false;
  bool _wasEnabled = false;

  int _gen = 0;
  int _seq = 0;
  int _appliedSeq = 0;

  bool get enabled => configProvider()?.shareLocation == true;

  /// Background sharing is running (the persistent indicator must be visible).
  bool get active => _sub != null;

  /// Updates are being sent but the endpoint keeps not accepting them.
  bool get deliveryTroubled => active && failedUpdates >= failuresBeforeWarning;

  /// The setting is on and permission is missing, so taps and sessions carry no location.
  bool get needsPermission => enabled && access != LocationAccess.granted && access != LocationAccess.unknown;

  /// A session is open but sharing is not running (the user stopped it, permission is missing, or it failed).
  bool get sessionWaiting => enabled && _sessionOpen && !active;

  /// Numbers requests in the order they are sent, so [onReply] can ignore a reply that was overtaken by a newer one.
  int nextSeq() => ++_seq;

  Future<void> refreshAccess() async {
    if (!enabled) return;
    try {
      access = await source.access();
    } catch (e) {
      Log.d('location', 'access check failed: ${e.runtimeType}');
      access = LocationAccess.unknown;
    }
    _notify();
    if (_sessionOpen) await _syncRunning();
  }

  /// Asks for permission (user action). Starts sharing right away if a session is already open.
  Future<LocationAccess> requestAccess() async {
    try {
      access = await source.request();
    } catch (e) {
      Log.d('location', 'permission request failed: ${e.runtimeType}');
      problem = 'Location permission could not be requested.';
    }
    _notify();
    if (_sessionOpen) await _syncRunning();
    return access;
  }

  Future<void> openSettings() => source.openSettings();

  /// A location for a tap, or null (setting off, no permission, no fix in time). Never shows a prompt.
  Future<GeoFix?> fixForTap() async {
    if (!enabled) return null;
    try {
      if (access != LocationAccess.granted) {
        access = await source.access();
        _notify();
        if (access != LocationAccess.granted) return null;
      }
      final fix = await source.fixNow();
      if (!enabled) return null; // switched off while the fix was being taken
      if (fix != null) _remember(fix);
      return fix;
    } catch (e) {
      Log.d('location', 'no fix for the tap: ${e.runtimeType}');
      return null;
    }
  }

  /// Every endpoint reply passes through here. `session_open` starts or stops background sharing. [seq] is the
  /// number [nextSeq] gave the request: a reply older than one already applied is ignored.
  void onReply(EndpointReply reply, {int seq = 0}) {
    final open = reply.sessionOpen;
    if (open == null) return;
    if (seq != 0) {
      if (seq < _appliedSeq) return;
      _appliedSeq = seq;
    }
    if (!enabled) {
      unawaited(stop());
      return;
    }
    if (open) {
      _lastOpenReply = _now();
      if (_sessionOpen) return;
      _sessionOpen = true;
      problem = null;
      _notify();
      unawaited(_syncRunning());
    } else {
      _userPaused = false; // a later session starts sharing again
      unawaited(stop());
    }
  }

  /// "Stop sharing" on the indicator: stops now; the next session (after the endpoint reports it closed) starts again.
  Future<void> pauseByUser() async {
    _userPaused = true;
    await _stopRunning();
  }

  /// "Share again" while the session is still open, or "Try again" after a failure.
  Future<void> resume() async {
    _userPaused = false;
    problem = null;
    await _syncRunning();
  }

  /// The configuration changed (sync, unregister): stop if sharing is no longer allowed, and look at the
  /// permission when it has just been switched on, so the "Allow" prompt shows without a session.
  void configChanged() {
    if (!enabled) {
      _wasEnabled = false;
      unawaited(stop());
      return;
    }
    if (!_wasEnabled || access == LocationAccess.unknown) {
      _wasEnabled = true;
      unawaited(refreshAccess());
    }
  }

  /// Stops everything: the session is over or sharing is off. The applied reply number is kept, so an older
  /// reply cannot reopen what a newer one closed.
  Future<void> stop() async {
    _sessionOpen = false;
    _lastOpenReply = null;
    await _stopRunning();
  }

  Future<void> _syncRunning() async {
    if (_disposed) return;
    bool wanted() => enabled && _sessionOpen && !_userPaused && !_disposed;
    if (!wanted()) {
      await _stopRunning();
      return;
    }
    if (active) return;
    final gen = ++_gen;
    try {
      access = await source.access();
    } catch (e) {
      Log.d('location', 'access check failed: ${e.runtimeType}');
      problem = 'Location could not be checked. Try again.';
      _notify();
      return;
    }
    // Anything that happened while the platform was answering (a stop, a newer start) cancels this start.
    if (gen != _gen || !wanted() || active) return;
    if (access != LocationAccess.granted) {
      _notify(); // the UI offers "Allow location"
      return;
    }
    final name = configProvider()?.applicationName ?? '';
    try {
      _sub = source
          .background(
            title: 'Sharing your location',
            text: name.isEmpty ? 'A session is open. Open nexTap to stop.' : '$name: a session is open. Open nexTap to stop.',
          )
          .listen(
            (fix) {
              final first = _last == null;
              _remember(fix);
              if (first) unawaited(_tick()); // the first fix goes out at once, then every [interval]
            },
            onError: (Object e) => _streamEnded('Location updates stopped (${e.runtimeType}).'),
            onDone: () => _streamEnded('Location updates stopped.'),
            cancelOnError: true,
          );
    } catch (e) {
      Log.d('location', 'could not start updates: ${e.runtimeType}');
      _sub = null;
      problem = 'Location updates could not be started.';
      _notify();
      return;
    }
    failedUpdates = 0;
    problem = null;
    _timer = Timer.periodic(interval, (_) => unawaited(_tick()));
    _notify();
  }

  /// The platform stream ended by itself: sharing is not running any more, so the indicator must not claim it is.
  void _streamEnded(String message) {
    if (_sub == null) return; // we stopped it ourselves
    Log.d('location', message);
    problem = message;
    unawaited(_stopRunning());
  }

  Future<void> _stopRunning() async {
    _gen++; // cancels a start that is still waiting on the platform
    final had = _sub != null || _timer != null;
    _timer?.cancel();
    _timer = null;
    final sub = _sub;
    _sub = null;
    _last = null; // a stopped sharer keeps no position
    _lastAt = null;
    failedUpdates = 0;
    try {
      await sub?.cancel();
    } catch (_) {}
    if (had) _notify();
  }

  Future<void> _tick() async {
    final config = configProvider();
    if (config == null || !config.shareLocation) {
      await stop();
      return;
    }
    final lastOk = _lastOpenReply;
    if (lastOk != null && _now().difference(lastOk) > maxSilence) {
      Log.d('location', 'no session confirmation for ${maxSilence.inMinutes} min: sharing stopped');
      await stop();
      return;
    }
    final fix = _last;
    final at = _lastAt;
    if (fix == null || at == null || _now().difference(at) > interval * 3) return;
    var ok = false;
    try {
      ok = await send(config, fix);
    } catch (e) {
      Log.d('location', 'update not sent: ${e.runtimeType}');
    }
    if (!active) return; // stopped while sending
    failedUpdates = ok ? 0 : failedUpdates + 1;
    _notify();
  }

  void _remember(GeoFix fix) {
    _last = fix;
    _lastAt = _now();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _gen++;
    _timer?.cancel();
    unawaited(_sub?.cancel());
    _sub = null;
    super.dispose();
  }
}
