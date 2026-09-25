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
