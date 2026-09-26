import 'dart:async';

import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

import '../core/logger.dart';
import '../core/tap_links.dart';
import '../data/models/card_read.dart';
import 'nfc_service.dart';

/// A tag read without being a registered terminal: its UID and the URIs of its NDEF message.
class GuestTag {
  const GuestTag({required this.uid, this.uris = const [], this.hasNdef = false});
  final String uid;
  final List<String> uris;

  /// The tag carries an NDEF message at all (possibly without links).
  final bool hasNdef;
}

/// Reads the NDEF URIs of [tag] (cached by Android in reader mode without skipNdefCheck).
GuestTag? guestTagFrom(NfcTag tag) {
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
  /// Returns whether reading started (false: no NFC / NFC off).
  Future<bool> start(void Function(GuestTag tag) onTag);
  Future<void> stop();
}

class AndroidGuestTapReader implements GuestTapReader {
  int? _lease;

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

class NoGuestTap implements GuestTapReader {
  const NoGuestTap();
  @override
  Future<bool> start(void Function(GuestTag tag) onTag) async => false;
  @override
  Future<void> stop() async {}
}
