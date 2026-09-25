import 'digital_card_token.dart';
import 'http_client.dart';

class LinkFormatException implements Exception {
  const LinkFormatException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// `nfcterminal://login?v=1&server=<urlenc>&code=nfcl_…` (Part 4 §1.1). Code never persisted.
class LoginPayload {
  const LoginPayload({required this.serverUrl, required this.code});
  final String serverUrl;
  final String code;

  String get serverHost {
    final u = Uri.parse(serverUrl);
    return u.hasPort ? '${u.host}:${u.port}' : u.host;
  }

  static final _code = RegExp(r'^nfcl_[A-Za-z0-9_\-]{16,128}$');

  static LoginPayload parse(String raw, {bool? allowLan}) {
    final u = Uri.tryParse(raw.trim());
    if (u == null || u.scheme.toLowerCase() != 'nfcterminal' || u.host.toLowerCase() != 'login') {
      throw const LinkFormatException('This is not an NFC Terminal sign-in QR code.');
    }
    if (u.queryParameters['v'] != '1') throw const LinkFormatException('Unsupported sign-in code version.');
    final code = u.queryParameters['code']?.trim() ?? '';
    if (!_code.hasMatch(code)) throw const LinkFormatException('The QR code has no valid sign-in code.');
    final server = u.queryParameters['server']?.trim() ?? '';
    final err = allowLan == null ? ServerUrl.validate(server) : ServerUrl.validate(server, allowLan: allowLan);
    if (err != null) throw LinkFormatException('Invalid server in QR code: $err');
    return LoginPayload(serverUrl: ServerUrl.normalize(server), code: code);
  }

  @override
  String toString() => 'LoginPayload(server=$serverUrl, code=nfcl_[REDACTED])';
}

/// `nfcterminal://card?v=1&t=<token>` exchange QR (Part 4 §4).
class CardQrPayload {
  const CardQrPayload(this.token);
  final String token;

  static CardQrPayload parse(String raw) {
    final u = Uri.tryParse(raw.trim());
    if (u == null || u.scheme.toLowerCase() != 'nfcterminal' || u.host.toLowerCase() != 'card') {
      throw const LinkFormatException('This is not a digital-card QR code.');
    }
    if (u.queryParameters['v'] != '1') throw const LinkFormatException('Unsupported card QR version.');
    final t = u.queryParameters['t'] ?? '';
    if (DigitalCardToken.decode(t) == null) throw const LinkFormatException('The card QR code is damaged.');
    return CardQrPayload(t);
  }
}
