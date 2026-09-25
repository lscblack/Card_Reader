import 'dart:async';

import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

import '../core/digital_card_token.dart';
import '../core/error_catalog.dart';

class ScanException implements Exception {
  const ScanException(this.error);
  final MobError error;
  @override
  String toString() => '${error.ref} ${error.code}';
}

/// SELECT the digital-card AID on an IsoDep tag; returns the token or null (→ UID flow).
/// Used by both the terminal reader and the personal scanner.
Future<String?> probeDigitalCard(NfcTag tag, {Duration timeout = const Duration(milliseconds: 150)}) async {
  final iso = IsoDepAndroid.from(tag);
  if (iso == null) return null;
  try {
    await iso.setTimeout(timeout.inMilliseconds);
    final r = await iso.transceive(DigitalCardToken.selectApdu).timeout(timeout + const Duration(milliseconds: 350));
    return DigitalCardToken.parseSelectResponse(r);
  } catch (_) {
    return null;
  }
}

/// Personal "Scan" mode: one reader session to receive someone's digital card.
abstract class DigitalCardScanner {
  /// Returns the base64url token. Throws [ScanException].
  Future<String> scanToken({Duration timeout = const Duration(seconds: 60)});
  Future<void> cancel();
}

class AndroidDigitalCardScanner implements DigitalCardScanner {
  Completer<String>? _pending;

  @override
  Future<String> scanToken({Duration timeout = const Duration(seconds: 60)}) async {
    await cancel();
    final c = _pending = Completer<String>();
    try {
      final availability = await NfcManager.instance.checkAvailability();
      if (availability == NfcAvailability.unsupported) throw const ScanException(MobError.nfcUnsupported);
      if (availability == NfcAvailability.disabled) throw const ScanException(MobError.nfcDisabled);
      await NfcManagerAndroid.instance.enableReaderMode(
        flags: {
          NfcReaderFlagAndroid.nfcA,
          NfcReaderFlagAndroid.nfcB,
          NfcReaderFlagAndroid.skipNdefCheck,
          NfcReaderFlagAndroid.noPlatformSounds,
        },
        onTagDiscovered: (tag) async {
          if (c.isCompleted) return;
          final token = await probeDigitalCard(tag, timeout: const Duration(milliseconds: 400));
          if (c.isCompleted) return;
          if (token == null) {
            c.completeError(const ScanException(MobError.notADigitalCard));
          } else {
            c.complete(token);
          }
        },
      );
      return await c.future.timeout(timeout, onTimeout: () => throw const ScanException(MobError.programmingTimeout));
    } finally {
      _pending = null;
      try {
        await NfcManagerAndroid.instance.disableReaderMode();
      } catch (_) {}
    }
  }

  @override
  Future<void> cancel() async {
    final p = _pending;
    if (p != null && !p.isCompleted) p.completeError(const ScanException(MobError.programmingTimeout));
  }
}
