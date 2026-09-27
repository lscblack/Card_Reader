import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

import '../core/digital_card_token.dart';
import '../core/error_catalog.dart';
import 'guest_tap.dart';
import 'ios_nfc.dart';
import 'nfc_service.dart';

class ScanException implements Exception {
  const ScanException(this.error, {this.guestTag});
  final MobError error;

  /// For [MobError.notADigitalCard]: the tag's NDEF links (a nexTap card → guest tap flow).
  final GuestTag? guestTag;
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

  /// Aborts a running scan. Completes once the scan has released reader mode, so a caller
  /// can safely start its own reader session afterwards.
  Future<void> cancel();
}

/// The scanner for this phone's platform.
DigitalCardScanner platformDigitalCardScanner() => Platform.isIOS ? IosDigitalCardScanner() : AndroidDigitalCardScanner();

class AndroidDigitalCardScanner implements DigitalCardScanner {
  Completer<String>? _pending;

  /// Completes when the current/last scan has disabled its reader session.
  Future<void>? _released;

  @override
  Future<String> scanToken({Duration timeout = const Duration(seconds: 60)}) async {
    await cancel();
    final c = _pending = Completer<String>();
    int? lease;
    // cancel() may fail the completer before anyone awaits it: never an unhandled error.
    unawaited(c.future.then((_) {}, onError: (_) {}));
    final released = Completer<void>();
    _released = released.future;
    try {
      final availability = await NfcManager.instance.checkAvailability();
      if (availability == NfcAvailability.unsupported) throw const ScanException(MobError.nfcUnsupported);
      if (availability == NfcAvailability.disabled) throw const ScanException(MobError.nfcDisabled);
      lease = ReaderModeLease.take();
      await NfcManagerAndroid.instance.enableReaderMode(
        // NDEF check on: a tapped nexTap card (not a phone) opens its link (guest tap).
        flags: {
          NfcReaderFlagAndroid.nfcA,
          NfcReaderFlagAndroid.nfcB,
          NfcReaderFlagAndroid.nfcF,
          NfcReaderFlagAndroid.nfcV,
          NfcReaderFlagAndroid.noPlatformSounds,
        },
        onTagDiscovered: (tag) async {
          if (c.isCompleted) return;
          final token = await probeDigitalCard(tag, timeout: const Duration(milliseconds: 400));
          if (c.isCompleted) return;
          if (token == null) {
            c.completeError(ScanException(MobError.notADigitalCard, guestTag: guestTagFrom(tag)));
          } else {
            c.complete(token);
          }
        },
      );
      return await c.future.timeout(timeout, onTimeout: () => throw const ScanException(MobError.programmingTimeout));
    } finally {
      if (identical(_pending, c)) _pending = null;
      try {
        if (lease != null && ReaderModeLease.isCurrent(lease)) await NfcManagerAndroid.instance.disableReaderMode();
      } catch (_) {}
      released.complete();
    }
  }

  @override
  Future<void> cancel() async {
    final p = _pending;
    if (p != null && !p.isCompleted) p.completeError(const ScanException(MobError.programmingTimeout));
    await _released;
  }
}

/// iOS: one scan sheet. An Android phone sharing a card answers the SELECT; an iPhone can't share by
/// NFC (no card emulation), so iPhone-to-iPhone exchanges use the QR code.
class IosDigitalCardScanner implements DigitalCardScanner {
  Completer<String>? _pending;
  IosScanHandle? _sheet;

  @override
  Future<String> scanToken({Duration timeout = const Duration(seconds: 60)}) async {
    await cancel();
    final c = _pending = Completer<String>();
    unawaited(c.future.then((_) {}, onError: (_) {}));
    try {
      if (await NfcManager.instance.checkAvailability() != NfcAvailability.enabled) {
        throw const ScanException(MobError.nfcUnsupported);
      }
      _sheet = await IosScanSheet.instance.open(
        prompt: 'Hold your iPhone near the other phone or card.',
        onTag: (tag, sheet) async {
          if (c.isCompleted) return;
          final token = await iosProbeDigitalCard(tag);
          if (c.isCompleted) return;
          if (token != null) {
            c.complete(token);
            await sheet.close(message: 'Card received ✓');
          } else {
            c.completeError(ScanException(MobError.notADigitalCard, guestTag: guestTagFrom(tag)));
            await sheet.close();
          }
        },
        // Cancel / timeout: same as Android's timeout (no error message shown).
        onEnd: (_) {
          if (!c.isCompleted) c.completeError(const ScanException(MobError.programmingTimeout));
        },
      );
      return await c.future.timeout(timeout, onTimeout: () => throw const ScanException(MobError.programmingTimeout));
    } on PlatformException {
      throw const ScanException(MobError.nfcUnsupported);
    } finally {
      if (identical(_pending, c)) _pending = null;
      final sheet = _sheet;
      _sheet = null;
      await sheet?.close();
    }
  }

  @override
  Future<void> cancel() async {
    final p = _pending;
    if (p != null && !p.isCompleted) p.completeError(const ScanException(MobError.programmingTimeout));
    final sheet = _sheet;
    _sheet = null;
    await sheet?.close();
  }
}
