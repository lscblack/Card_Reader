import 'dart:async';

import 'package:flutter/services.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

import '../core/config.dart';
import '../core/logger.dart';
import '../data/models/card_read.dart';
import 'digital_card_scanner.dart';
import 'ios_nfc.dart';

enum NfcState { unsupported, disabled, enabled }

/// Platform-independent NFC interface (fake it in tests).
abstract class NfcService {
  Future<NfcState> checkAvailability();

  /// Adapter state changes (user toggling NFC in system settings).
  Stream<NfcState> get stateChanges;

  /// iOS: cards are read only inside a system scan sheet that the user opens (never automatically) and
  /// that closes by itself (about 60 s, Cancel, app sent to the background). Android: reader mode runs
  /// until stopped.
  bool get sessionBased;

  /// Enables Android reader mode, or opens the iOS scan sheet. [onCard] is called for every detected
  /// card (debouncing is the caller's job, see [UidDebouncer]). [onSessionEnd] runs when the iOS sheet
  /// closes, whatever the reason (never on Android).
  Future<void> startReading({
    required void Function(CardRead card) onCard,
    required void Function(Object error) onError,
    void Function()? onSessionEnd,
  });

  Future<void> stopReading();

  /// iOS: text on the open scan sheet (e.g. the last card's result). No-op on Android.
  Future<void> setSessionMessage(String message);

  /// Opens the system NFC settings screen.
  Future<bool> openNfcSettings();
}

/// Reader mode is one activity-wide session: whoever enabled it last owns it. Sessions that may
/// be stopped late (e.g. a screen disposed after the next one started reading) only disable it
/// while they are still the current owner.
class ReaderModeLease {
  ReaderModeLease._();
  static int _current = 0;

  /// Call right before enabling reader mode; returns this session's lease.
  static int take() => ++_current;
  static bool isCurrent(int lease) => lease == _current;
}

/// Ignores the same UID seen again within [window].
class UidDebouncer {
  UidDebouncer({this.window = AppConfig.debounceWindow});

  final Duration window;
  String? _lastUid;
  DateTime? _lastAt;

  bool accept(String uid, DateTime now) {
    final last = _lastAt;
    if (uid == _lastUid && last != null && now.difference(last).abs() < window) {
      _lastAt = now; // a card resting on the reader stays debounced
      return false;
    }
    _lastUid = uid;
    _lastAt = now;
    return true;
  }

  void reset() {
    _lastUid = null;
    _lastAt = null;
  }
}

/// Android implementation on top of `nfc_manager` 4.x reader mode.
class AndroidNfcService implements NfcService {
  AndroidNfcService({MethodChannel? settingsChannel})
    : _settings = settingsChannel ?? const MethodChannel('net.nexventures.nfc_terminal/settings');

  final MethodChannel _settings;

  @override
  Future<NfcState> checkAvailability() async {
    try {
      return switch (await NfcManager.instance.checkAvailability()) {
        NfcAvailability.enabled => NfcState.enabled,
        NfcAvailability.disabled => NfcState.disabled,
        NfcAvailability.unsupported => NfcState.unsupported,
      };
    } catch (e) {
      Log.e('nfc', 'availability check failed', e);
      return NfcState.unsupported;
    }
  }

  @override
  Stream<NfcState> get stateChanges => NfcManagerAndroid.instance.onStateChanged
      .where((s) => s == NfcAdapterStateAndroid.on || s == NfcAdapterStateAndroid.off)
      .map((s) => s == NfcAdapterStateAndroid.on ? NfcState.enabled : NfcState.disabled);

  @override
  bool get sessionBased => false;

  @override
  Future<void> setSessionMessage(String message) async {}

  @override
  Future<void> startReading({
    required void Function(CardRead card) onCard,
    required void Function(Object error) onError,
    void Function()? onSessionEnd,
  }) {
    _lease = ReaderModeLease.take();
    return NfcManagerAndroid.instance.enableReaderMode(
      // Reader mode: this app gets the tag, Android doesn't dispatch it to
      // other apps. IsoDep / MIFARE are discovered through NfcA/NfcB polling.
      flags: {
        NfcReaderFlagAndroid.nfcA,
        NfcReaderFlagAndroid.nfcB,
        NfcReaderFlagAndroid.nfcF,
        NfcReaderFlagAndroid.nfcV,
        NfcReaderFlagAndroid.skipNdefCheck,
        NfcReaderFlagAndroid.noPlatformSounds,
      },
      onTagDiscovered: (tag) async {
        try {
          final card = await _read(tag);
          if (card != null) onCard(card);
        } catch (e) {
          onError(e);
        }
      },
    );
  }

  Future<CardRead?> _read(NfcTag tag) async {
    final detectedAt = DateTime.now().toUtc();
    final android = NfcTagAndroid.from(tag);
    if (android == null) return null;
    final uid = CardUtils.normalizeUid(CardUtils.bytesToHex(android.id));
    if (uid == null) throw const FormatException('Card returned no usable UID');
    final techs = android.techList.map(CardUtils.shortTechName).toList();

    // Part 4 §3 reader side: phones sharing a digital card answer the SELECT.
    if (techs.contains('IsoDep')) {
      final token = await probeDigitalCard(tag);
      if (token != null) {
        final digital = digitalCardRead(token, techs, detectedAt);
        if (digital != null) return digital;
      }
    }

    final nfcA = NfcAAndroid.from(tag);
    int? productType;
    final isType2 = techs.contains('MifareUltralight') || (nfcA != null && nfcA.sak == 0x00);
    if (nfcA != null && isType2 && !techs.contains('IsoDep')) {
      productType = await _type2ProductType(nfcA);
    }
    return CardRead(
      uid: uid,
      technologies: techs,
      type: CardUtils.guessCardType(technologies: techs, sak: nfcA?.sak, ultralightProductType: productType),
      detectedAt: detectedAt,
    );
  }

  /// NXP GET_VERSION (0x60): byte 2 = product type (0x03 Ultralight, 0x04 NTAG).
  /// Best effort; older Ultralight tags don't support it.
  Future<int?> _type2ProductType(NfcAAndroid nfcA) async {
    try {
      final r = await nfcA
          .transceive(Uint8List.fromList(const [0x60]))
          .timeout(const Duration(milliseconds: 400));
      return r.length >= 8 ? r[2] : null;
    } catch (_) {
      return null;
    }
  }

  int? _lease;

  @override
  Future<void> stopReading() async {
    final lease = _lease;
    _lease = null;
    // Only switch reader mode off while this session still owns it (see [ReaderModeLease]).
    if (lease == null || !ReaderModeLease.isCurrent(lease)) return;
    try {
      await NfcManagerAndroid.instance.disableReaderMode();
    } catch (e) {
      Log.e('nfc', 'disable reader mode failed', e);
    }
  }

  @override
  Future<bool> openNfcSettings() async {
    try {
      return await _settings.invokeMethod<bool>('openNfcSettings') ?? false;
    } on PlatformException catch (e) {
      Log.e('nfc', 'cannot open settings', e);
      return false;
    }
  }
}

/// iOS implementation: the terminal reader runs in the system scan sheet ([IosScanSheet]), reading card
/// after card until it times out or the user closes it.
class IosNfcService implements NfcService {
  IosScanHandle? _sheet;

  @override
  bool get sessionBased => true;

  @override
  Future<NfcState> checkAvailability() async {
    try {
      // iOS has no NFC switch: readable (iPhone 7 or newer) or not.
      return await NfcManager.instance.checkAvailability() == NfcAvailability.enabled
          ? NfcState.enabled
          : NfcState.unsupported;
    } catch (e) {
      Log.e('nfc', 'availability check failed', e);
      return NfcState.unsupported;
    }
  }

  @override
  Stream<NfcState> get stateChanges => const Stream.empty();

  @override
  Future<void> startReading({
    required void Function(CardRead card) onCard,
    required void Function(Object error) onError,
    void Function()? onSessionEnd,
  }) async {
    _sheet = await IosScanSheet.instance.open(
      prompt: 'Hold a card near the top of your iPhone.',
      onTag: (tag, sheet) async {
        try {
          onCard(await _read(tag));
        } catch (e) {
          onError(e);
        }
        await sheet.nextTag();
      },
      onEnd: (_) => onSessionEnd?.call(),
    );
  }

  Future<CardRead> _read(NfcTag tag) async {
    final detectedAt = DateTime.now().toUtc();
    // Part 4 §3 reader side: an Android phone sharing a digital card answers the SELECT.
    if (Iso7816Ios.from(tag) != null) {
      final token = await iosProbeDigitalCard(tag);
      if (token != null) {
        final digital = digitalCardRead(token, iosTagInfo(tag).technologies, detectedAt);
        if (digital != null) return digital;
      }
    }
    final info = iosTagInfo(tag, productType: await iosType2ProductType(tag));
    final uid = info.uid;
    if (uid == null) throw const FormatException('Card returned no usable UID');
    return CardRead(uid: uid, technologies: info.technologies, type: info.type, detectedAt: detectedAt);
  }

  @override
  Future<void> stopReading() async {
    final sheet = _sheet;
    _sheet = null;
    // Only closes the sheet this service opened, and only while it is still the current one.
    await sheet?.close();
  }

  @override
  Future<void> setSessionMessage(String message) async => _sheet?.setMessage(message);

  @override
  Future<bool> openNfcSettings() async => false; // iOS has no NFC setting.
}
