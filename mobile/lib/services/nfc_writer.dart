import 'dart:async';
import 'dart:io';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:nfc_manager/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

import '../core/error_catalog.dart';
import '../data/models/card_read.dart';
import 'ios_nfc.dart';
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

final _iosNfcCode = RegExp(r'NFCError Code=(\d+)');

/// Maps a native failure to a MOB code. Android (pigeon): code = Java exception class. iOS: the
/// NSError text (`Error Domain=NFCError Code=100 "Tag connection lost"`).
MobError mobErrorForPlatform(PlatformException e) {
  final c = '${e.code} ${e.message ?? ''}';
  if (c.contains('TagLost')) return MobError.tagLost;
  if (c.contains('ReadOnly') || c.contains('read-only') || c.contains('read only')) return MobError.tagReadOnly;
  if (c.contains('FormatException')) return MobError.tagNotNdef;
  // iOS NFCReaderError codes: 100/104 connection lost / not connected, 400 not writable, 402 too small.
  return switch (int.tryParse(_iosNfcCode.firstMatch(c)?.group(1) ?? '')) {
    100 || 104 => MobError.tagLost,
    400 => MobError.tagReadOnly,
    402 => MobError.tagTooSmall,
    _ => MobError.ndefWriteFailed,
  };
}

/// The writer for this phone's platform.
NfcWriter platformNfcWriter() => Platform.isIOS ? IosNfcWriter() : AndroidNfcWriter();

// --------------------------------------------------------------- Android --

class AndroidNfcWriter implements NfcWriter {
  Completer<String>? _pending;

  @override
  Future<String> writeUri(String uri, {Duration timeout = const Duration(seconds: 60), String? expectedUid}) async {
    await cancel();
    final completer = _pending = Completer<String>();
    int? lease;
    final message = uriMessage(uri);
    try {
      // Own reader session WITHOUT skipNdefCheck (needed to see the Ndef tech).
      lease = ReaderModeLease.take();
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
        if (lease != null && ReaderModeLease.isCurrent(lease)) await NfcManagerAndroid.instance.disableReaderMode();
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

// ------------------------------------------------------------------- iOS --

/// Writes through the iOS scan sheet ([IosScanSheet]): one card, then the sheet closes with the result.
class IosNfcWriter implements NfcWriter {
  Completer<String>? _pending;
  IosScanHandle? _sheet;

  @override
  Future<String> writeUri(String uri, {Duration timeout = const Duration(seconds: 60), String? expectedUid}) async {
    await cancel();
    final completer = _pending = Completer<String>();
    // Failed by the sheet ending before anyone awaits it: never an unhandled error.
    unawaited(completer.future.then((_) {}, onError: (_) {}));
    final message = uriMessage(uri);
    void fail(NfcWriteException e) {
      if (!completer.isCompleted) completer.completeError(e);
    }

    try {
      _sheet = await IosScanSheet.instance.open(
        prompt: 'Hold the card near the top of your iPhone to write its link.',
        onTag: (tag, sheet) async {
          if (completer.isCompleted) return;
          NfcWriteException? error;
          try {
            final uid = await _write(tag, message, expectedUid);
            // Complete before closing: the close ends the sheet, which would otherwise fail the write.
            if (!completer.isCompleted) completer.complete(uid);
            await sheet.close(message: 'Link written ✓');
            return;
          } on NfcWriteException catch (e) {
            error = e;
          } on PlatformException catch (e) {
            error = NfcWriteException(mobErrorForPlatform(e), e.code);
          } catch (e) {
            error = NfcWriteException(MobError.ndefWriteFailed, '$e');
          }
          fail(error);
          await sheet.close(error: error.error.title);
        },
        onEnd: (reason) => fail(NfcWriteException(
          MobError.programmingTimeout,
          reason == IosScanEnd.cancelled ? 'cancelled' : reason.name,
        )),
      );
      return await completer.future.timeout(
        timeout,
        onTimeout: () => throw const NfcWriteException(MobError.programmingTimeout),
      );
    } on PlatformException catch (e) {
      // The sheet could not open (no NFC on this iPhone, or iOS busy).
      throw NfcWriteException(MobError.nfcUnsupported, e.code);
    } finally {
      _pending = null;
      final sheet = _sheet;
      _sheet = null;
      await sheet?.close();
    }
  }

  Future<String> _write(NfcTag tag, NdefMessage message, String? expectedUid) async {
    final uid = iosTagInfo(tag).uid;
    if (uid == null) throw const NfcWriteException(MobError.uidUnavailable);
    if (expectedUid != null && uid != expectedUid) throw const NfcWriteException(MobError.wrongCard);
    final ndef = NdefIos.from(tag);
    final status = ndef?.status ?? NdefStatusIos.notSupported;
    // iOS can't format a tag for NDEF: NTAG / Ultralight / DESFire come NDEF-ready from the factory.
    planNdefWrite(
      hasNdef: status != NdefStatusIos.notSupported,
      isWritable: status == NdefStatusIos.readWrite,
      maxSize: ndef?.capacity ?? 0,
      formatable: false,
      messageSize: message.byteLength,
    );
    await ndef!.writeNdef(message);
    return uid;
  }

  @override
  Future<void> cancel() async {
    final p = _pending;
    if (p != null && !p.isCompleted) {
      p.completeError(const NfcWriteException(MobError.programmingTimeout, 'cancelled'));
    }
    final sheet = _sheet;
    _sheet = null;
    await sheet?.close();
  }
}
