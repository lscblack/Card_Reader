import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/http_client.dart';

/// Looks up a registered card's public tap link by chip ID — no sign-in needed.
/// Used when a tapped card is registered on the platform but has no tap link written to its chip.
typedef CardResolver = Future<String?> Function(String uid);

/// Asks the first known server (`GET /api/v1/public/cards/resolve?uid=`); null when unknown/offline.
CardResolver httpCardResolver(Iterable<String?> Function() servers, {http.Client? client}) {
  return (String uid) async {
    for (final s in servers()) {
      if (s == null || s.trim().isEmpty) continue;
      final base = ServerUrl.normalize(s);
      final uri = Uri.parse('$base/api/v1/public/cards/resolve').replace(queryParameters: {'uid': uid});
      try {
        final c = client ?? http.Client();
        try {
          final r = await c.get(uri).timeout(const Duration(seconds: 6));
          if (r.statusCode != 200) return null; // 404 card_not_registered: the answer for this server
          final body = jsonDecode(utf8.decode(r.bodyBytes));
          final url = body is Map ? body['tap_url'] : null;
          return url is String && url.isNotEmpty ? url : null;
        } finally {
          if (client == null) c.close();
        }
      } catch (_) {
        continue; // unreachable: try the next known server
      }
    }
    return null;
  };
}
