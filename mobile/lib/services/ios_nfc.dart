import 'dart:async';
import 'dart:typed_data';

import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

import '../core/digital_card_token.dart';
import '../core/logger.dart';
import '../core/tap_links.dart';
import '../data/models/card_read.dart';

/// Why an iOS scan sheet closed.
enum IosScanEnd {
  /// The app closed it (done, stopped, or another feature opened its own sheet).
  stopped,

  /// The user tapped Cancel.
  cancelled,

  /// iOS closed it after about 60 s.
  timeout,

  /// Anything else (system busy, app sent to the background, NFC unavailable).
  failed,
}

/// A sheet opened with [IosScanSheet.open]. Stale handles (the sheet already closed) are harmless.
class IosScanHandle {
  IosScanHandle._(this._sheet, this._owner);
  final IosScanSheet _sheet;
  final _Owner _owner;

  bool get isOpen => identical(_sheet._current, _owner);

  /// Text shown on the sheet (e.g. the last card's result).
  Future<void> setMessage(String message) async {
    if (!isOpen) return;
    try {
      await NfcManagerIos.instance.tagSessionSetAlertMessage(alertMessage: message);
    } catch (e) {
      Log.d('ios-nfc', 'set message failed: $e');
    }
  }

  /// Done with the current tag: look for the next one (multi-card sheets).
  Future<void> nextTag() async {
    if (!isOpen) return;
    try {
      await NfcManagerIos.instance.tagSessionRestartPolling();
    } catch (e) {
      Log.d('ios-nfc', 'restart polling failed: $e');
    }
  }

  /// Closes the sheet, showing [message] (✓) or [error] (✗) briefly.
  Future<void> close({String? message, String? error}) => _sheet._close(_owner, IosScanEnd.stopped, message, error);
}

class _Owner {
  _Owner(this.onEnd);
  final void Function(IosScanEnd reason) onEnd;
  bool ended = false;

  void end(IosScanEnd reason) {
    if (ended) return;
    ended = true;
    onEnd(reason);
  }
}

/// iOS reads NFC only inside the system "Ready to Scan" sheet: one at a time, about 60 s, closed when the
/// app leaves the foreground, and it covers the app while open. Every iOS NFC feature (terminal reader,
/// card writer, personal scanner, guest scan) opens it here. Opening a sheet first closes the previous
/// owner's (its `onEnd` runs with [IosScanEnd.stopped]), like [ReaderModeLease] does for Android reader mode.
///
/// After each tag the sheet waits: call [IosScanHandle.nextTag] to read another card, or close it. This
/// leaves time to talk to the tag (digital-card SELECT, GET_VERSION, NDEF write) before polling moves on.
class IosScanSheet {
  IosScanSheet._();
  static final instance = IosScanSheet._();

  _Owner? _current;
  Future<void> _chain = Future.value();

  /// Opens a sheet showing [prompt]. [onTag] runs for each tag while this sheet is the current one;
  /// [onEnd] runs exactly once, however the sheet ends. Throws when iOS refuses to open it.
  Future<IosScanHandle> open({
    required String prompt,
    required FutureOr<void> Function(NfcTag tag, IosScanHandle sheet) onTag,
    required void Function(IosScanEnd reason) onEnd,
  }) {
    final done = Completer<IosScanHandle>();
    // Serialised: two features opening sheets at once must not interleave begin/invalidate.
    _chain = _chain.then((_) async {
      final previous = _current;
      if (previous != null) await _close(previous, IosScanEnd.stopped, null, null);
      final owner = _Owner(onEnd);
      final handle = IosScanHandle._(this, owner);
      _current = owner;
      Future<void> begin() => NfcManager.instance.startSession(
        // No FeliCa (iso18092): iOS then requires the system codes in Info.plist, or refuses every session.
        pollingOptions: {NfcPollingOption.iso14443, NfcPollingOption.iso15693},
        alertMessageIos: prompt,
        // The plugin never invalidates by itself: "true" only means "don't restart polling for us".
        invalidateAfterFirstReadIos: true,
        onDiscovered: (tag) async {
          if (!identical(_current, owner)) return;
          try {
            await onTag(tag, handle);
          } catch (e) {
            Log.e('ios-nfc', 'tag handler failed', e);
            await handle.nextTag();
          }
        },
        onSessionErrorIos: (e) => _systemEnded(owner, e.code),
      );
      try {
        try {
          await begin();
        } catch (e) {
          // A session left over by the plugin: release it and try once more.
          Log.d('ios-nfc', 'begin failed ($e), retrying');
          await _invalidateNative();
          await begin();
        }
        done.complete(handle);
      } catch (e, st) {
        if (identical(_current, owner)) _current = null;
        owner.ended = true; // never opened: no onEnd
        done.completeError(e, st);
      }
    });
    return done.future;
  }

  void _systemEnded(_Owner owner, NfcReaderErrorCodeIos code) {
    if (identical(_current, owner)) _current = null;
    owner.end(switch (code) {
      NfcReaderErrorCodeIos.readerSessionInvalidationErrorUserCanceled => IosScanEnd.cancelled,
      NfcReaderErrorCodeIos.readerSessionInvalidationErrorSessionTimeout => IosScanEnd.timeout,
      _ => IosScanEnd.failed,
    });
  }

  Future<void> _close(_Owner owner, IosScanEnd reason, String? message, String? error) async {
    if (!identical(_current, owner)) return owner.end(reason);
    _current = null;
    await _invalidateNative(message: message, error: error);
    owner.end(reason);
  }

  Future<void> _invalidateNative({String? message, String? error}) async {
    try {
      await NfcManager.instance.stopSession(alertMessageIos: message, errorMessageIos: error);
    } catch (_) {
      // No active session (iOS already closed it).
    }
  }
}

// ------------------------------------------------------------- tag parsing --

/// What an iOS tag tells us, in the terms the app already uses for Android tags.
class IosTagInfo {
  const IosTagInfo({required this.uid, required this.technologies, required this.type});

  /// Uppercase hex, same byte order as Android's `Tag.getId()`; null when the tag gives no usable ID.
  final String? uid;

  /// Android-style short tech names (`NfcA`, `MifareUltralight`, `IsoDep`, …): the server and
  /// [CardUtils.guessCardType] already know them. Like the Android terminal (which skips the NDEF check),
  /// `Ndef` is never listed.
  final List<String> technologies;
  final String type;
}

/// UID, technologies and card type of [tag]. [productType] is byte 2 of a GET_VERSION answer (Type 2 tags).
IosTagInfo iosTagInfo(NfcTag tag, {int? productType}) {
  final mifare = MiFareIos.from(tag);
  if (mifare != null) {
    final techs = switch (mifare.mifareFamily) {
      MiFareFamilyIos.ultralight => ['NfcA', 'MifareUltralight'],
      MiFareFamilyIos.desfire => ['NfcA', 'IsoDep'],
      MiFareFamilyIos.plus => ['NfcA', 'IsoDep'],
      MiFareFamilyIos.unknown => ['NfcA'],
    };
    final type = switch (mifare.mifareFamily) {
      MiFareFamilyIos.ultralight => productType == 0x04 ? CardType.ntag : CardType.mifareUltralight,
      MiFareFamilyIos.desfire || MiFareFamilyIos.plus => CardType.isoDep,
      MiFareFamilyIos.unknown => CardType.unknown,
    };
    return IosTagInfo(uid: _uid(mifare.identifier), technologies: techs, type: type);
  }
  final iso7816 = Iso7816Ios.from(tag);
  if (iso7816 != null) {
    return IosTagInfo(
      uid: _uid(iso7816.identifier),
      technologies: const ['IsoDep'],
      type: CardType.isoDep,
    );
  }
  final iso15693 = Iso15693Ios.from(tag);
  if (iso15693 != null) {
    // iOS gives the ISO 15693 UID most significant byte first (E0…); Android's NfcV id is reversed.
    // Keep Android's order so a tag registered on either phone has the same card ID.
    return IosTagInfo(
      uid: _uid(iso15693.identifier.reversed.toList()),
      technologies: const ['NfcV'],
      type: CardType.iso15693,
    );
  }
  final felica = FeliCaIos.from(tag);
  if (felica != null) {
    return IosTagInfo(
      uid: _uid(felica.currentIDm),
      technologies: const ['NfcF'],
      type: CardType.felica,
    );
  }
  return const IosTagInfo(uid: null, technologies: [], type: CardType.unknown);
}

String? _uid(List<int> bytes) => CardUtils.normalizeUid(CardUtils.bytesToHex(bytes));

/// Links of the tag's NDEF message (read by iOS when the tag was found), and whether it had one at all.
({List<String> uris, bool hasNdef}) iosNdefUris(NfcTag tag) {
  final msg = NdefIos.from(tag)?.cachedNdefMessage;
  final uris = <String>[
    for (final r in msg?.records ?? const []) ?ndefRecordUri(r.typeNameFormat.index, r.type, r.payload),
  ];
  return (uris: uris, hasNdef: msg != null && msg.records.isNotEmpty);
}

/// SELECT the digital-card AID on a phone sharing a card (Android HCE). iOS only reports such a phone as
/// ISO 7816 because the AID is listed in Info.plist (`…iso7816.select-identifiers`).
Future<String?> iosProbeDigitalCard(NfcTag tag, {Duration timeout = const Duration(milliseconds: 500)}) async {
  final iso = Iso7816Ios.from(tag);
  if (iso == null) return null;
  try {
    final r = await iso.sendCommandRaw(data: DigitalCardToken.selectApdu).timeout(timeout);
    return DigitalCardToken.parseSelectResponse(Uint8List.fromList([...r.payload, r.statusWord1, r.statusWord2]));
  } catch (_) {
    return null;
  }
}

/// NXP GET_VERSION (0x60) on a MIFARE Ultralight-family tag: byte 2 = product type (0x04 NTAG).
Future<int?> iosType2ProductType(NfcTag tag) async {
  final mifare = MiFareIos.from(tag);
  if (mifare == null || mifare.mifareFamily != MiFareFamilyIos.ultralight) return null;
  try {
    final r = await mifare
        .sendMiFareCommand(commandPacket: Uint8List.fromList(const [0x60]))
        .timeout(const Duration(milliseconds: 400));
    return r.length >= 8 ? r[2] : null;
  } catch (_) {
    return null;
  }
}
