import 'package:flutter/foundation.dart';

/// Debug-only logger that redacts credentials before printing.
///
/// Never pass raw secrets on purpose; the redaction is a safety net.
class Log {
  Log._();

  static final List<RegExp> _patterns = [
    // API keys, device tokens, webhook secrets.
    RegExp(r'\b(nfc_|nfcd_|nfcp_|whsec_)[A-Za-z0-9_\-]+'),
    // Authorization headers.
    RegExp(r'(Bearer\s+)[A-Za-z0-9._\-]+', caseSensitive: false),
    // Signatures and 64-hex signing secrets.
    RegExp(r'v1=[0-9a-fA-F]+'),
    RegExp(r'\b[0-9a-fA-F]{64}\b'),
    // JSON fields that may carry secrets.
    RegExp(
      r'("(?:signing_secret|device_token|api_key|webhook_secret|authorization)"\s*:\s*)"[^"]*"',
      caseSensitive: false,
    ),
  ];

  /// Replaces anything that looks like a credential with a marker.
  static String redact(String input) {
    var out = input;
    out = out.replaceAllMapped(_patterns[0], (m) => '${m[1]}[REDACTED]');
    out = out.replaceAllMapped(_patterns[1], (m) => '${m[1]}[REDACTED]');
    out = out.replaceAll(_patterns[2], 'v1=[REDACTED]');
    out = out.replaceAll(_patterns[3], '[REDACTED]');
    out = out.replaceAllMapped(_patterns[4], (m) => '${m[1]}"[REDACTED]"');
    return out;
  }

  static void d(String tag, String message) {
    if (!kDebugMode) return;
    debugPrint('[$tag] ${redact(message)}');
  }

  static void e(String tag, String message, [Object? error]) {
    if (!kDebugMode) return;
    final suffix = error == null ? '' : ' | ${error.runtimeType}: $error';
    debugPrint('[$tag] ERROR ${redact('$message$suffix')}');
  }
}
