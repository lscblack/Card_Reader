import 'dart:async';
import 'dart:io';

import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

import '../core/logger.dart';
import '../core/tap_links.dart';
import '../data/models/card_read.dart';
import 'ios_nfc.dart';
import 'nfc_service.dart';

/// A tag read without being a registered terminal: its UID and the URIs of its NDEF message.
class GuestTag {
  const GuestTag({required this.uid, this.uris = const [], this.hasNdef = false});
  final String uid;
  final List<String> uris;

  /// The tag carries an NDEF message at all (possibly without links).
  final bool hasNdef;
}

/// Reads the NDEF URIs of [tag] (cached by Android in reader mode without skipNdefCheck; read by iOS
/// when the tag was found).
GuestTag? guestTagFrom(NfcTag tag) {
  // Tag data is platform-specific (the other platform's parser would fail on it).
  if (Platform.isIOS) {
    final uid = iosTagInfo(tag).uid;
    if (uid == null) return null;
    final ndef = iosNdefUris(tag);
    return GuestTag(uid: uid, uris: ndef.uris, hasNdef: ndef.hasNdef);
  }
  final android = NfcTagAndroid.from(tag);
  final uid = android == null ? null : CardUtils.normalizeUid(CardUtils.bytesToHex(android.id));
  if (uid == null) return null;
  final msg = NdefAndroid.from(tag)?.cachedNdefMessage;
  final uris = <String>[
    for (final r in msg?.records ?? const [])
      ?ndefRecordUri(r.typeNameFormat.index, r.type, r.payload),
  ];
  return GuestTag(uid: uid, uris: uris, hasNdef: msg != null && msg.records.isNotEmpty);
}

/// "Guest tap" reader: while the phone is not a registered terminal, a tapped nexTap card simply
/// opens its link (no sign-in). Mockable.
abstract class GuestTapReader {
  /// Returns whether reading started (false: no NFC / NFC off). On iOS ([manual]) this only arms the
  /// reader: cards are read when the user taps "Scan a card" ([scan]).
  Future<bool> start(void Function(GuestTag tag) onTag);
  Future<void> stop();

  /// iOS: no background reading inside the app; the user starts each scan.
  bool get manual;

  /// iOS: opens the scan sheet for one card (delivered to the [start] callback). No-op on Android.
  Future<void> scan();
}

/// The guest reader for this phone's platform.
GuestTapReader platformGuestTapReader() => Platform.isIOS ? IosGuestTapReader() : AndroidGuestTapReader();

class AndroidGuestTapReader implements GuestTapReader {
  int? _lease;

  @override
  bool get manual => false;

  @override
  Future<void> scan() async {}

  @override
  Future<bool> start(void Function(GuestTag tag) onTag) async {
    try {
      if ((await NfcManager.instance.checkAvailability()) != NfcAvailability.enabled) return false;
      _lease = ReaderModeLease.take();
      await NfcManagerAndroid.instance.enableReaderMode(
        // NDEF check ON (the whole point: read the card's link).
        flags: {
          NfcReaderFlagAndroid.nfcA,
          NfcReaderFlagAndroid.nfcB,
          NfcReaderFlagAndroid.nfcF,
          NfcReaderFlagAndroid.nfcV,
          NfcReaderFlagAndroid.noPlatformSounds,
        },
        onTagDiscovered: (tag) async {
          final g = guestTagFrom(tag);
          if (g != null) onTag(g);
        },
      );
      return true;
    } catch (e) {
      Log.e('guest', 'cannot start guest reading', e);
      return false;
    }
  }

  @override
  Future<void> stop() async {
    final lease = _lease;
    _lease = null;
    // Don't switch off reader mode another session (terminal reader, scanner) enabled since.
    if (lease == null || !ReaderModeLease.isCurrent(lease)) return;
    try {
      await NfcManagerAndroid.instance.disableReaderMode();
    } catch (_) {}
  }
}

/// iOS: armed while a guest screen is showing; each "Scan a card" opens the scan sheet for one card.
/// (With the app closed, iOS itself reads the card's link and opens the app through a universal link.)
class IosGuestTapReader implements GuestTapReader {
  void Function(GuestTag tag)? _onTag;
  IosScanHandle? _sheet;

  @override
  bool get manual => true;

  @override
  Future<bool> start(void Function(GuestTag tag) onTag) async {
    try {
      if (await NfcManager.instance.checkAvailability() != NfcAvailability.enabled) return false;
    } catch (_) {
      return false;
    }
    _onTag = onTag;
    return true;
  }

  @override
  Future<void> scan() async {
    final deliver = _onTag;
    if (deliver == null) return;
    try {
      _sheet = await IosScanSheet.instance.open(
        prompt: 'Hold a nexTap card near the top of your iPhone.',
        onTag: (tag, sheet) async {
          final g = guestTagFrom(tag);
          if (g == null) return sheet.nextTag();
          await sheet.close();
          if (identical(_onTag, deliver)) deliver(g);
        },
        onEnd: (_) {},
      );
    } catch (e) {
      Log.e('guest', 'cannot open the scan sheet', e);
    }
  }

  @override
  Future<void> stop() async {
    _onTag = null;
    final sheet = _sheet;
    _sheet = null;
    await sheet?.close();
  }
}

class NoGuestTap implements GuestTapReader {
  const NoGuestTap();
  @override
  bool get manual => false;
  @override
  Future<void> scan() async {}
  @override
  Future<bool> start(void Function(GuestTag tag) onTag) async => false;
  @override
  Future<void> stop() async {}
}
