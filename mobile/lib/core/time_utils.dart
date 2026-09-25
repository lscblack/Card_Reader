/// ISO-8601 UTC with second precision and a `Z` suffix, e.g. `2026-09-25T08:30:21Z`.
String isoUtc(DateTime t) {
  final u = t.toUtc();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${u.year.toString().padLeft(4, '0')}-${two(u.month)}-${two(u.day)}'
      'T${two(u.hour)}:${two(u.minute)}:${two(u.second)}Z';
}

/// Unix seconds as used by `X-NFC-Timestamp`.
int unixSeconds(DateTime t) => t.toUtc().millisecondsSinceEpoch ~/ 1000;
