import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/services.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

class DeviceDetails {
  const DeviceDetails({
    required this.manufacturer,
    required this.model,
    required this.osVersion,
    required this.appVersion,
    this.buildNumber = 0,
  });

  final String manufacturer;
  final String model;

  /// e.g. `Android 15`.
  final String osVersion;
  final String appVersion;

  /// Android versionCode (compared with the published release's build_number).
  final int buildNumber;

  String get suggestedName {
    final m = model.trim();
    final brand = manufacturer.trim();
    if (brand.isEmpty || m.toLowerCase().startsWith(brand.toLowerCase())) return m;
    return '${brand[0].toUpperCase()}${brand.substring(1)} $m';
  }
}

/// Device, network and screen helpers behind one mockable interface.
abstract class PlatformInfo {
  Future<DeviceDetails> deviceDetails();

  /// Emits true when some network is available.
  Stream<bool> get onlineChanges;
  Future<bool> isOnline();
  Future<void> keepScreenOn(bool on);

  /// Opens this app's system settings page (e.g. to grant camera permission).
  Future<bool> openAppSettings();
}

class DefaultPlatformInfo implements PlatformInfo {
  final _connectivity = Connectivity();

  @override
  Future<DeviceDetails> deviceDetails() async {
    String manufacturer = '', model = 'Android device', os = 'Android';
    String appVersion = '1.0.0';
    var buildNumber = 0;
    try {
      final a = await DeviceInfoPlugin().androidInfo;
      manufacturer = a.manufacturer;
      model = a.model;
      os = 'Android ${a.version.release}';
    } catch (_) {}
    try {
      final p = await PackageInfo.fromPlatform();
      appVersion = p.version;
      buildNumber = int.tryParse(p.buildNumber) ?? 0;
    } catch (_) {}
    return DeviceDetails(
      manufacturer: manufacturer,
      model: model,
      osVersion: os,
      appVersion: appVersion,
      buildNumber: buildNumber,
    );
  }

  static bool _online(List<ConnectivityResult> r) => r.any((c) => c != ConnectivityResult.none);

  @override
  Stream<bool> get onlineChanges => _connectivity.onConnectivityChanged.map(_online).distinct();

  @override
  Future<bool> isOnline() async {
    try {
      return _online(await _connectivity.checkConnectivity());
    } catch (_) {
      return true;
    }
  }

  @override
  Future<void> keepScreenOn(bool on) async {
    try {
      await WakelockPlus.toggle(enable: on);
    } catch (_) {}
  }

  static const _settings = MethodChannel('net.nexventures.nfc_terminal/settings');

  @override
  Future<bool> openAppSettings() async {
    try {
      return await _settings.invokeMethod<bool>('openAppSettings') ?? false;
    } catch (_) {
      return false;
    }
  }
}
