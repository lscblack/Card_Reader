import 'dart:convert';

/// How a reply's `display.tone` is shown. Unknown or missing tones are [neutral].
enum ReplyTone {
  success,
  warning,
  error,
  info,
  neutral;

  static ReplyTone parse(Object? v) {
    if (v is! String) return neutral;
    return switch (v.trim().toLowerCase()) {
      'success' => success,
      'warning' => warning,
      'error' => error,
      'info' => info,
      _ => neutral,
    };
  }
}

/// What the developer's endpoint answered to a delivery, as far as the phone uses it:
///
/// ```json
/// {"display": {"title": "...", "message": "...", "tone": "success|warning|error|info"},
///  "action_url": "https://...", "session_open": true}
/// ```
///
/// Every key is optional. Relay mode gets the same shape from the platform as `endpoint_reply`.
class EndpointReply {
  const EndpointReply({this.title, this.message, this.tone = ReplyTone.neutral, this.actionUrl, this.sessionOpen});

  static const titleMax = 120;
  static const messageMax = 500;
  static const urlMax = 2048;

  final String? title;
  final String? message;
  final ReplyTone tone;

  /// A link the endpoint wants opened. Never opened without [isActionUrlAllowed].
  final String? actionUrl;

  /// Location sharing: true while the endpoint has a session open, false when it ended, null = no statement.
  final bool? sessionOpen;

  bool get hasDisplay => (title ?? '').isNotEmpty || (message ?? '').isNotEmpty;
  bool get isEmpty => !hasDisplay && actionUrl == null && sessionOpen == null;

  /// Parses a decoded JSON value; null when it is not an object or carries none of the three keys.
  static EndpointReply? fromJson(Object? json) {
    if (json is! Map) return null;
    String? text(Object? v, int max) {
      if (v is! String) return null;
      final s = v.trim();
      if (s.isEmpty) return null;
      return s.length > max ? s.substring(0, max) : s;
    }

    final display = json['display'];
    final reply = EndpointReply(
      title: display is Map ? text(display['title'], titleMax) : null,
      message: display is Map ? text(display['message'], messageMax) : null,
      tone: display is Map ? ReplyTone.parse(display['tone']) : ReplyTone.neutral,
      actionUrl: text(json['action_url'], urlMax),
      sessionOpen: json['session_open'] is bool ? json['session_open'] as bool : null,
    );
    return reply.isEmpty ? null : reply;
  }

  /// Parses a raw HTTP response body (direct mode). Anything that is not a JSON object is no reply.
  static EndpointReply? fromBody(String body) {
    final trimmed = body.trim();
    if (trimmed.isEmpty || !trimmed.startsWith('{')) return null;
    try {
      return fromJson(jsonDecode(trimmed));
    } catch (_) {
      return null;
    }
  }
}
