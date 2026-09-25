/// Local, human-friendly timestamp (no intl dependency).
String formatLocalTime(DateTime t, {bool seconds = true}) {
  final l = t.toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  final time = '${two(l.hour)}:${two(l.minute)}${seconds ? ':${two(l.second)}' : ''}';
  final now = DateTime.now();
  if (l.year == now.year && l.month == now.month && l.day == now.day) return time;
  return '${l.year}-${two(l.month)}-${two(l.day)} $time';
}
