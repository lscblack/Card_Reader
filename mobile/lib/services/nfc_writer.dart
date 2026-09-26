import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:nfc_manager/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

import '../core/error_catalog.dart';
import '../data/models/card_read.dart';
import 'nfc_service.dart';

/// Failure while programming a card, with its `MOB-*` catalog entry.
class NfcWriteException implements Exception {
  const NfcWriteException(this.error, [this.detail]);
  final MobError error;
  final String? detail;

  @override
  String toString() => '${error.ref} ${error.code}${detail == null ? '' : ': $detail'}';
}

/// Writes an NDEF URI to the next presented tag (mockable).
abstract class NfcWriter {
  /// Waits for a tag, writes [uri] as an NDEF URI record and returns the tag
  /// UID (uppercase hex). Never makes the tag read-only. With [expectedUid], any other tag is
  /// refused before anything is written ([MobError.wrongCard]).
  /// Throws [NfcWriteException].
  Future<String> writeUri(String uri, {Duration timeout = const Duration(seconds: 60), String? expectedUid});

  /// Aborts a pending [writeUri].
  Future<void> cancel();
}

// ------------------------------------------------------------------ NDEF --

/// NFC Forum URI identifier codes (RTD-URI), longest prefixes first.
const _uriPrefixes = <int, String>{
  0x04: 'https://',
  0x03: 'http://',
  0x02: 'https://www.',
  0x01: 'http://www.',
  0x05: 'tel:',
  0x06: 'mailto:',
};

/// Well-known "U" record with prefix compression.
NdefRecord uriRecord(String uri) {
  var code = 0;
  var rest = uri;
  var best = '';
  _uriPrefixes.forEach((c, p) {
    if (uri.startsWith(p) && p.length > best.length) {
      best = p;
      code = c;
    }
  });
  if (best.isNotEmpty) rest = uri.substring(best.length);
  return NdefRecord(
    typeNameFormat: TypeNameFormat.wellKnown,
    type: Uint8List.fromList(const [0x55]), // 'U'
    identifier: Uint8List(0),
    payload: Uint8List.fromList([code, ...utf8.encode(rest)]),
  );
}

NdefMessage uriMessage(String uri) => NdefMessage(records: [uriRecord(uri)]);

enum NdefWriteMethod { write, format }

/// Decides how (or whether) a tag can take [messageSize] bytes of NDEF.
/// Throws [NfcWriteException] with the matching MOB code.
NdefWriteMethod planNdefWrite({
  required bool hasNdef,
  required bool isWritable,
  required int maxSize,
  required bool formatable,
  required int messageSize,
}) {
  if (hasNdef) {
    if (!isWritable) throw const NfcWriteException(MobError.tagReadOnly);
    if (maxSize > 0 && messageSize > maxSize) {
      throw NfcWriteException(MobError.tagTooSmall, 'needs $messageSize bytes, card has $maxSize');
    }
    return NdefWriteMethod.write;
  }
  if (formatable) return NdefWriteMethod.format;
  throw const NfcWriteException(MobError.tagNotNdef);
}

/// Maps a native failure (pigeon: code = Java exception class) to a MOB code.
MobError mobErrorForPlatform(PlatformException e) {
  final c = '${e.code} ${e.message ?? ''}';
  if (c.contains('TagLost')) return MobError.tagLost;
  if (c.contains('ReadOnly') || c.contains('read-only') || c.contains('read only')) return MobError.tagReadOnly;
  if (c.contains('FormatException')) return MobError.tagNotNdef;
  return MobError.ndefWriteFailed;
}

// --------------------------------------------------------------- Android --

class AndroidNfcWriter implements NfcWriter {
  Completer<String>? _pending;

  @override
  Future<String> writeUri(String uri, {Duration timeout = const Duration(seconds: 60), String? expectedUid}) async {
    await cancel();
    final completer = _pending = Completer<String>();
    final message = uriMessage(uri);
    try {
      // Own reader session WITHOUT skipNdefCheck (needed to see the Ndef tech).
      ReaderModeLease.take();
      await NfcManagerAndroid.instance.enableReaderMode(
        flags: {
          NfcReaderFlagAndroid.nfcA,
          NfcReaderFlagAndroid.nfcB,
          NfcReaderFlagAndroid.nfcF,
          NfcReaderFlagAndroid.nfcV,
          NfcReaderFlagAndroid.noPlatformSounds,
        },
        onTagDiscovered: (tag) async {
          if (completer.isCompleted) return;
          try {
            final uid = await _write(tag, message, expectedUid);
            if (!completer.isCompleted) completer.complete(uid);
          } on NfcWriteException catch (e) {
            if (!completer.isCompleted) completer.completeError(e);
          } on PlatformException catch (e) {
            if (!completer.isCompleted) completer.completeError(NfcWriteException(mobErrorForPlatform(e), e.code));
          } catch (e) {
            if (!completer.isCompleted) completer.completeError(NfcWriteException(MobError.ndefWriteFailed, '$e'));
          }
        },
      );
      return await completer.future.timeout(
        timeout,
        onTimeout: () => throw const NfcWriteException(MobError.programmingTimeout),
      );
    } on PlatformException catch (e) {
      throw NfcWriteException(
        e.code == 'not_supported' ? MobError.nfcUnsupported : MobError.ndefWriteFailed,
        e.code,
      );
    } finally {
      _pending = null;
      try {
        await NfcManagerAndroid.instance.disableReaderMode();
      } catch (_) {}
    }
  }

  Future<String> _write(NfcTag tag, NdefMessage message, String? expectedUid) async {
    final android = NfcTagAndroid.from(tag);
    final uid = android == null ? null : CardUtils.normalizeUid(CardUtils.bytesToHex(android.id));
    if (uid == null) throw const NfcWriteException(MobError.uidUnavailable);
    if (expectedUid != null && uid != expectedUid) throw const NfcWriteException(MobError.wrongCard);
    final ndef = NdefAndroid.from(tag);
    final formatable = NdefFormatableAndroid.from(tag);
    final method = planNdefWrite(
      hasNdef: ndef != null,
      isWritable: ndef?.isWritable ?? false,
      maxSize: ndef?.maxSize ?? 0,
      formatable: formatable != null,
      messageSize: message.byteLength,
    );
    switch (method) {
      case NdefWriteMethod.write:
        await ndef!.writeNdefMessage(message);
      case NdefWriteMethod.format:
        await formatable!.format(message); // never formatReadOnly
    }
    return uid;
  }

  @override
  Future<void> cancel() async {
    final p = _pending;
    if (p != null && !p.isCompleted) {
      p.completeError(const NfcWriteException(MobError.programmingTimeout, 'cancelled'));
    }
  }
}
