import 'http_client.dart';

/// Parsed `nfcterminal://pair?v=1&server=...&code=nfcp_...&name=...` QR payload
/// (contract 7.3). The pairing code is single-use and is never persisted.
class PairingPayload {
  const PairingPayload({required this.serverUrl, required this.code, this.deviceName});

  /// Normalised server URL (validated with the same rules as manual entry).
  final String serverUrl;
  final String code;
  final String? deviceName;

  String get serverHost {
    final u = Uri.parse(serverUrl);
    return u.hasPort ? '${u.host}:${u.port}' : u.host;
  }

  bool get isInsecure => ServerUrl.isInsecure(serverUrl);

  static final _code = RegExp(r'^nfcp_[A-Za-z0-9_\-]{16,128}$');

  static bool looksLikePairingLink(String raw) =>
      raw.trim().toLowerCase().startsWith('nfcterminal://');

  /// Parses and validates [raw]. Throws [PairingFormatException] with a
  /// user-facing message when it is not a valid pairing QR code.
  static PairingPayload parse(String raw, {bool? allowLan}) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme.toLowerCase() != 'nfcterminal' || uri.host.toLowerCase() != 'pair') {
      throw const PairingFormatException('This is not an NFC Terminal pairing QR code.');
    }
    final q = uri.queryParameters;
    if (q['v'] != '1') {
      throw const PairingFormatException(
        'Unsupported pairing code version. Update the app or generate a new code.',
      );
    }
    final code = q['code']?.trim() ?? '';
    if (!_code.hasMatch(code)) {
      throw const PairingFormatException('The QR code has no valid pairing code.');
    }
    final server = q['server']?.trim() ?? '';
    final err = allowLan == null ? ServerUrl.validate(server) : ServerUrl.validate(server, allowLan: allowLan);
    if (err != null) throw PairingFormatException('Invalid server in QR code: $err');
    var name = q['name']?.trim();
    if (name != null && name.isEmpty) name = null;
    if (name != null && name.length > 100) name = name.substring(0, 100);
    return PairingPayload(serverUrl: ServerUrl.normalize(server), code: code, deviceName: name);
  }

  @override
  String toString() => 'PairingPayload(server=$serverUrl, code=nfcp_[REDACTED], name=$deviceName)';
}

class PairingFormatException implements Exception {
  const PairingFormatException(this.message);
  final String message;

  @override
  String toString() => message;
}
