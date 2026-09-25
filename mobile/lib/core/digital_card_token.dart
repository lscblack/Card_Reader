import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Digital-card token (Part 4 §3). Must match the Kotlin `DigitalCardToken` and the
/// server byte for byte:
///
/// `0x01 ‖ share_id (16, UUID big-endian) ‖ key_id (u32 BE) ‖ issued_at (u32 BE) ‖
///  HMAC_SHA256(secret, first 25 bytes)[0..16]` → 41 bytes, text form base64url
/// without padding (55 chars).
class DigitalCardToken {
  DigitalCardToken._();

  static const version = 0x01;
  static const length = 41;

  /// `SELECT 00 A4 04 00 07 F0 4E 46 43 44 43 01 00`.
  static final selectApdu = Uint8List.fromList(const [
    0x00, 0xA4, 0x04, 0x00, 0x07, 0xF0, 0x4E, 0x46, 0x43, 0x44, 0x43, 0x01, 0x00, //
  ]);

  static Uint8List uuidBytes(String uuid) {
    final hex = uuid.replaceAll('-', '');
    if (!RegExp(r'^[0-9a-fA-F]{32}$').hasMatch(hex)) throw FormatException('Invalid UUID: $uuid');
    return Uint8List.fromList([for (var i = 0; i < 32; i += 2) int.parse(hex.substring(i, i + 2), radix: 16)]);
  }

  static Uint8List generate({
    required String shareId,
    required int keyId,
    required int issuedAt,
    required List<int> secret,
  }) {
    if (keyId < 0 || keyId > 0xFFFFFFFF || issuedAt < 0 || issuedAt > 0xFFFFFFFF) {
      throw RangeError('key_id / issued_at must be u32');
    }
    final head = BytesBuilder()
      ..addByte(version)
      ..add(uuidBytes(shareId))
      ..add(_u32(keyId))
      ..add(_u32(issuedAt));
    final h = head.toBytes();
    final mac = Hmac(sha256, secret).convert(h).bytes.sublist(0, 16);
    return Uint8List.fromList([...h, ...mac]);
  }

  static Uint8List _u32(int v) => Uint8List(4)..buffer.asByteData().setUint32(0, v);

  static String encode(List<int> token) => base64Url.encode(token).replaceAll('=', '');

  static Uint8List? decode(String text) {
    try {
      final padded = text.padRight((text.length + 3) ~/ 4 * 4, '=');
      final b = base64Url.decode(padded);
      return b.length == length && b[0] == version ? b : null;
    } catch (_) {
      return null;
    }
  }

  /// Decodes a base64url secret (share_key.secret, 32 bytes).
  static Uint8List decodeSecret(String b64) => base64Url.decode(b64.padRight((b64.length + 3) ~/ 4 * 4, '='));

  /// `share_id` hex (32 uppercase chars, no dashes) — the `card_id` terminals send.
  static String? shareIdHex(String token) {
    final b = decode(token);
    if (b == null) return null;
    return b.sublist(1, 17).map((x) => x.toRadixString(16).padLeft(2, '0')).join().toUpperCase();
  }

  static int? issuedAt(String token) {
    final b = decode(token);
    return b == null ? null : ByteData.sublistView(b, 21, 25).getUint32(0);
  }

  /// Parses the SELECT answer: `"NFCDC" ‖ token(41) ‖ 90 00` → base64url token, else null.
  static String? parseSelectResponse(List<int> r) {
    if (r.length != 5 + length + 2) return null;
    if (ascii.decode(r.sublist(0, 5), allowInvalid: true) != 'NFCDC') return null;
    if (r[r.length - 2] != 0x90 || r[r.length - 1] != 0x00) return null;
    final token = r.sublist(5, 5 + length);
    if (token[0] != version) return null;
    return encode(token);
  }
}
