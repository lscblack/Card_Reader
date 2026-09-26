import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../core/logger.dart';

/// One code a card's `ussd` action offers (the first one is the main code).
class UssdOption {
  const UssdOption(this.label, this.code);
  final String label;
  final String code;
}

final _ussdCode = RegExp(r'^[*#][0-9*#]{1,40}$');

/// The USSD code in a `tel:` action URL (`tel:*182*8*1%23` → `*182*8*1#`), or null for normal numbers/links.
String? ussdCodeFromUrl(String? url) {
  if (url == null) return null;
  final u = Uri.tryParse(url.trim());
  if (u == null || u.scheme.toLowerCase() != 'tel') return null;
  final code = Uri.decodeComponent(u.path + (u.hasFragment ? '#${u.fragment}' : ''));
  return _ussdCode.hasMatch(code) ? code : null;
}

/// Dials USSD codes. On Android the call is placed directly (the phone permission is asked once);
/// if it's refused, or elsewhere, the dialer opens with the code filled in.
class UssdDialer {
  UssdDialer._();
  static const _ch = MethodChannel('net.nexventures.nfc_terminal/dialer');

  /// true when the call was placed or the dialer opened.
  static Future<bool> dial(String code) async {
    if (Platform.isAndroid) {
      try {
        final r = await _ch.invokeMethod<String>('dial', {'code': code});
        if (r == 'called' || r == 'dialer') return true;
      } catch (e) {
        Log.e('ussd', 'native dial failed', e);
      }
    }
    try {
      return await launchUrl(Uri(scheme: 'tel', path: code.replaceAll('#', '%23')), mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}

/// For a nexTap tap link (`…/t/{code}`): the card's USSD codes when its action is `ussd`, else null.
/// The server records the tap only when it answers with codes, so a null answer means "open the link as usual".
Future<List<UssdOption>?> fetchTapUssd(Uri tapLink, {http.Client? client}) async {
  // `{server}/t/{code}` — the server may live under a path prefix, which is kept.
  final segs = tapLink.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segs.length < 2 || segs[segs.length - 2] != 't') return null;
  final prefix = segs.sublist(0, segs.length - 2);
  final uri = Uri(scheme: tapLink.scheme, host: tapLink.host, port: tapLink.hasPort ? tapLink.port : null,
      pathSegments: [...prefix, 'api', 'v1', 'public', 't', segs.last, 'ussd']);
  final c = client ?? http.Client();
  try {
    final r = await c
        .post(uri, headers: {'User-Agent': 'nexTap/${Platform.operatingSystem} (${Platform.isAndroid ? 'Android' : 'iOS'})'})
        .timeout(const Duration(seconds: 5));
    if (r.statusCode != 200) return null;
    final body = jsonDecode(utf8.decode(r.bodyBytes));
    final opts = body is Map ? body['options'] : null;
    if (opts is! List) return null;
    final out = [
      for (final o in opts)
        if (o is Map && o['code'] is String && _ussdCode.hasMatch(o['code'] as String))
          UssdOption((o['label'] as String?) ?? 'Dial', o['code'] as String),
    ];
    return out.isEmpty ? null : out;
  } catch (_) {
    return null; // offline / older server: fall back to opening the link
  } finally {
    if (client == null) c.close();
  }
}
