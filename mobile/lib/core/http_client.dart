import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// Creates the production HTTP client. Everything else depends on the
/// `http.Client` interface so tests can inject `MockClient`.
http.Client createHttpClient() {
  final io = HttpClient()
    ..connectionTimeout = const Duration(seconds: 10)
    ..idleTimeout = const Duration(seconds: 15);
  return IOClient(io);
}

/// Result of a single raw HTTP exchange.
class RawResponse {
  const RawResponse(this.statusCode, this.body, this.headers);
  final int statusCode;
  final String body;
  final Map<String, String> headers;
}

/// Sends [bytes] as the exact request body, never following redirects, with an
/// overall [timeout] covering connect + headers + body.
Future<RawResponse> sendBytes(
  http.Client client, {
  required String method,
  required Uri url,
  required Map<String, String> headers,
  List<int>? bytes,
  required Duration timeout,
  int maxBodyChars = 64 * 1024,
}) async {
  Future<RawResponse> run() async {
    final req = http.Request(method, url)
      ..followRedirects = false
      ..maxRedirects = 0
      ..headers.addAll(headers);
    if (bytes != null) req.bodyBytes = bytes;
    final streamed = await client.send(req);
    final res = await http.Response.fromStream(streamed);
    // JSON is UTF-8 (RFC 8259); package:http would fall back to Latin-1 when
    // the server omits `charset`, garbling names like "Café".
    var body = utf8.decode(res.bodyBytes, allowMalformed: true);
    if (body.length > maxBodyChars) body = body.substring(0, maxBodyChars);
    return RawResponse(res.statusCode, body, res.headers);
  }

  return run().timeout(timeout);
}

/// Normalises and validates a server URL entered by the user.
class ServerUrl {
  ServerUrl._();

  static const _localHosts = {'10.0.2.2', 'localhost', '127.0.0.1'};

  /// Trims, removes trailing slashes and a trailing `/api/v1`.
  static String normalize(String input) {
    var s = input.trim();
    while (s.endsWith('/')) {
      s = s.substring(0, s.length - 1);
    }
    if (s.toLowerCase().endsWith('/api/v1')) {
      s = s.substring(0, s.length - '/api/v1'.length);
    }
    return s;
  }

  /// Returns an error message, or null when valid.
  /// [allowLan] permits plain http:// to private LAN IPs (debug builds only,
  /// matching the debug network security config).
  static String? validate(String input, {bool allowLan = kDebugMode}) {
    final s = normalize(input);
    if (s.isEmpty) return 'Server URL is required';
    final uri = Uri.tryParse(s);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      return 'Enter a full URL, e.g. https://api.example.com';
    }
    if (uri.scheme != 'https' && uri.scheme != 'http') {
      return 'URL must start with https:// or http://';
    }
    if (uri.userInfo.isNotEmpty) return 'Credentials in the URL are not allowed';
    if (uri.hasQuery || uri.hasFragment) return 'Remove query/fragment from the URL';
    if (uri.scheme == 'http' &&
        !_localHosts.contains(uri.host) &&
        !(allowLan && isPrivateIPv4(uri.host))) {
      return allowLan
          ? 'Plain http:// is only allowed for local or LAN addresses (e.g. http://192.168.1.20:8000)'
          : 'This app requires https:// servers. Plain http:// only works for 10.0.2.2, localhost and '
                '127.0.0.1 (a LAN http:// server needs a debug build).';
    }
    return null;
  }

  /// True for 10.x.x.x, 172.16-31.x.x and 192.168.x.x literals.
  static bool isPrivateIPv4(String host) {
    final parts = host.split('.');
    if (parts.length != 4) return false;
    final o = parts.map(int.tryParse).toList();
    if (o.any((v) => v == null || v < 0 || v > 255)) return false;
    return o[0] == 10 ||
        (o[0] == 172 && o[1]! >= 16 && o[1]! <= 31) ||
        (o[0] == 192 && o[1] == 168);
  }

  /// True when the URL is valid but not encrypted (dev-only hosts).
  static bool isInsecure(String input) =>
      Uri.tryParse(normalize(input))?.scheme == 'http';
}
