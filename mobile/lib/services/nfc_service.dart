import 'dart:async';

import 'package:flutter/services.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

import '../core/config.dart';
import '../core/logger.dart';
import '../data/models/card_read.dart';

enum NfcState { unsupported, disabled, enabled }

/// Platform-independent NFC interface (fake it in tests).
abstract class NfcService {
  Future<NfcState> checkAvailability();

  /// Adapter state changes (user toggling NFC in system settings).
  Stream<NfcState> get stateChanges;

  /// Enables Android reader mode. [onCard] is called for every detected card
  /// (debouncing is the caller's job, see [UidDebouncer]).
  Future<void> startReading({
    required void Function(CardRead card) onCard,
    required void Function(Object error) onError,
  });

  Future<void> stopReading();

  /// Opens the system NFC settings screen.
  Future<bool> openNfcSettings();
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
  Future<void> startReading({
    required void Function(CardRead card) onCard,
    required void Function(Object error) onError,
  }) {
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

  @override
  Future<void> stopReading() async {
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
