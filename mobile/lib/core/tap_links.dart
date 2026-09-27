import 'dart:convert';

import 'http_client.dart';

/// NFC Forum RTD-URI identifier codes (0x00–0x23).
const _uriPrefixes = <String>[
  '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:', 'ftp://anonymous:anonymous@',
  'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:',
  'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://',
  'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

/// URI of an NDEF record: well-known "U" (TNF 1, prefix-compressed) or absolute URI (TNF 3).
/// [tnf] is the TypeNameFormat index. Null for other records.
String? ndefRecordUri(int tnf, List<int> type, List<int> payload) {
  try {
    if (tnf == 1 && type.length == 1 && type[0] == 0x55 && payload.isNotEmpty) {
      final code = payload[0];
      final prefix = code < _uriPrefixes.length ? _uriPrefixes[code] : '';
      return prefix + utf8.decode(payload.sublist(1));
    }
    if (tnf == 3 && type.isNotEmpty) return utf8.decode(type);
  } catch (_) {}
  return null;
}

enum TapLinkKind {
  /// A nexTap card/tag link `/t/{code}`: the server resolves the card's action.
  tap,

  /// A digital-card page `/p/{slug}` (what phones sharing a card expose over NFC).
  card,

  /// Any other link: shown with an "Open" button, never opened automatically.
  other,
}

class TapLink {
  const TapLink(this.uri, this.kind, {this.trusted = false});
  final Uri uri;
  final TapLinkKind kind;

  /// The host is this phone's server (or the build's default): opened without asking.
  final bool trusted;

  String get host => uri.hasPort ? '${uri.host}:${uri.port}' : uri.host;

  /// Opens without confirmation: our link on a known host.
  bool get autoOpen => kind != TapLinkKind.other && trusted;
}

final _tapPath = RegExp(r'^/t/([A-Za-z0-9_-]{8,16})/?$');
final _cardPath = RegExp(r'^/p/[A-Za-z0-9_-]{1,80}/?$');

/// The card's public code of a tap link `http(s)://host/t/{code}`, else null.
String? tapCodeOf(Uri uri) {
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'https' && scheme != 'http') return null;
  return _tapPath.firstMatch(uri.path)?.group(1);
}

/// The iOS app claims tap links as universal links (apple-app-site-association), except those carrying
/// this query parameter: the app adds it when it opens a tap link in the browser itself, so iOS doesn't
/// hand the link straight back to the app. The server ignores it.
const iosBrowserMarker = 'via';
const iosBrowserMarkerValue = 'app';

/// [uri] with [iosBrowserMarker] added when it is a tap link (other links unchanged).
Uri tapLinkForBrowser(Uri uri) {
  if (tapCodeOf(uri) == null) return uri;
  return uri.replace(queryParameters: {...uri.queryParameters, iosBrowserMarker: iosBrowserMarkerValue});
}

/// Classifies an NDEF URI. [knownServers] are the configured server URLs (and the build default);
/// a link is trusted when its host (ignoring the port: API and web often differ only by port)
/// equals one of theirs. Non-http(s) schemes are only kept as [TapLinkKind.other].
TapLink? classifyTapLink(String raw, Iterable<String?> knownServers) {
  final uri = Uri.tryParse(raw.trim());
  if (uri == null || uri.scheme.isEmpty) return null;
  final scheme = uri.scheme.toLowerCase();
  final web = scheme == 'http' || scheme == 'https';
  if (!web || uri.host.isEmpty || uri.userInfo.isNotEmpty) return TapLink(uri, TapLinkKind.other);
  final hosts = {
    for (final s in knownServers)
      if (s != null && s.trim().isNotEmpty) Uri.tryParse(ServerUrl.normalize(s))?.host.toLowerCase(),
  }..remove(null);
  final trusted = hosts.contains(uri.host.toLowerCase());
  final kind = _tapPath.hasMatch(uri.path)
      ? TapLinkKind.tap
      : (_cardPath.hasMatch(uri.path) ? TapLinkKind.card : TapLinkKind.other);
  return TapLink(uri, kind, trusted: trusted);
}

/// The best link of a tag: a nexTap tap/card link first, else the first other URI.
TapLink? pickTapLink(Iterable<String> uris, Iterable<String?> knownServers) {
  final links = [for (final u in uris) ?classifyTapLink(u, knownServers)];
  for (final l in links) {
    if (l.kind != TapLinkKind.other) return l;
  }
  return links.isEmpty ? null : links.first;
}
