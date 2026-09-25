import 'package:flutter/services.dart';

import '../core/logger.dart';

/// Bridge to the Kotlin HCE service (Part 4 §3): cache + component toggle.
abstract class HceBridge {
  Future<bool> isSupported();

  /// Writes the encrypted cache read by the HCE service.
  Future<void> setCache({
    required String shareId,
    required int keyId,
    required String secret,
    String? publicUrl,
    required bool webPageEnabled,
    required bool nfcSharingEnabled,
  });
  Future<void> clearCache();
  Future<void> setEnabled(bool enabled);
  Future<bool> isEnabled();

  /// Prefer our service over other apps with the same AIDs while the Share screen is shown.
  Future<void> setPreferred(bool preferred);
}

class AndroidHceBridge implements HceBridge {
  static const _ch = MethodChannel('net.nexventures.nfc_terminal/hce');

  Future<T?> _call<T>(String m, [Object? a]) async {
    try {
      return await _ch.invokeMethod<T>(m, a);
    } on PlatformException catch (e) {
      Log.e('hce', '$m failed', e);
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Future<bool> isSupported() async => await _call<bool>('isSupported') ?? false;

  @override
  Future<void> setCache({
    required String shareId,
    required int keyId,
    required String secret,
    String? publicUrl,
    required bool webPageEnabled,
    required bool nfcSharingEnabled,
  }) => _call<void>('setCache', {
    'share_id': shareId,
    'key_id': keyId,
    'secret': secret,
    'public_url': publicUrl ?? '',
    'web_page_enabled': webPageEnabled,
    'nfc_sharing_enabled': nfcSharingEnabled,
  });

  @override
  Future<void> clearCache() => _call<void>('clearCache');

  @override
  Future<void> setEnabled(bool enabled) => _call<void>('setServiceEnabled', enabled);

  @override
  Future<bool> isEnabled() async => await _call<bool>('isServiceEnabled') ?? false;

  @override
  Future<void> setPreferred(bool preferred) => _call<void>('setPreferred', preferred);
}

class NoHce implements HceBridge {
  const NoHce();
  @override
  Future<bool> isSupported() async => false;
  @override
  Future<void> setCache({required String shareId, required int keyId, required String secret, String? publicUrl,
      required bool webPageEnabled, required bool nfcSharingEnabled}) async {}
  @override
  Future<void> clearCache() async {}
  @override
  Future<void> setEnabled(bool enabled) async {}
  @override
  Future<bool> isEnabled() async => false;
  @override
  Future<void> setPreferred(bool preferred) async {}
}
