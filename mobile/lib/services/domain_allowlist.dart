/// Endpoint domain allowlist matching (contract 7.1).
///
/// Entries are hostnames (`api.example.com`, exact) or `*.example.com` (any
/// subdomain, not the apex). Case-insensitive. An empty list means no
/// restriction.
bool isHostAllowed(String host, List<String> allowedDomains) {
  if (allowedDomains.isEmpty) return true;
  var h = host.trim().toLowerCase();
  if (h.endsWith('.')) h = h.substring(0, h.length - 1);
  if (h.isEmpty) return false;
  for (final raw in allowedDomains) {
    final entry = raw.trim().toLowerCase();
    if (entry.isEmpty) continue;
    if (entry.startsWith('*.')) {
      final suffix = entry.substring(1); // ".example.com"
      if (suffix.length > 1 && h.endsWith(suffix) && h.length > suffix.length) return true;
    } else if (h == entry) {
      return true;
    }
  }
  return false;
}

/// Whether a link returned by an endpoint (`action_url`) may be opened on the phone.
///
/// Opt-in: an empty [linkDomains] list means never. The URL must be an absolute `https` URL with a host on the
/// list (same entry format as [isHostAllowed]: exact host, or `*.example.com` for subdomains only), no
/// `user:password@` part and no `@` at all (so `https://allowed.com@evil.com` is refused), no port other than 443, and no
/// whitespace, control or backslash characters (browsers read `\` as `/`, which can move the real host).
bool isActionUrlAllowed(String? url, List<String> linkDomains) {
  if (url == null || linkDomains.isEmpty) return false;
  final raw = url.trim();
  if (raw.isEmpty || raw.length > 2048) return false;
  for (final unit in raw.codeUnits) {
    // Whitespace, control characters and backslash: browsers read `\` as `/`, which can move the real host.
    if (unit <= 0x20 || unit == 0x7f || unit == 0x5c) return false;
  }
  final uri = Uri.tryParse(raw);
  if (uri == null || !uri.isAbsolute || uri.scheme != 'https') return false;
  if (uri.userInfo.isNotEmpty || raw.contains('@')) return false;
  if (uri.hasPort && uri.port != 443) return false;
  final host = uri.host;
  if (host.isEmpty) return false;
  return isHostAllowed(host, linkDomains);
}
