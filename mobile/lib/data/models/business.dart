/// Part 2 business-device models (C1–C3).
library;

class BusinessInfo {
  const BusinessInfo({required this.id, required this.name, this.slug, this.logoUrl});
  final String id;
  final String name;
  final String? slug;
  final String? logoUrl;

  static BusinessInfo? fromJson(Object? j) {
    if (j is! Map) return null;
    return BusinessInfo(
      id: j['id'] as String? ?? '',
      name: j['name'] as String? ?? '',
      slug: j['slug'] as String?,
      logoUrl: j['logo_url'] as String?,
    );
  }

  Map<String, Object?> toJson() => {'id': id, 'name': name, 'slug': slug, 'logo_url': logoUrl};
}

class AssignedEmployee {
  const AssignedEmployee({required this.id, required this.name});
  final String id;
  final String name;

  static AssignedEmployee? fromJson(Object? j) {
    if (j is! Map) return null;
    return AssignedEmployee(id: j['id'] as String? ?? '', name: j['name'] as String? ?? '');
  }

  Map<String, Object?> toJson() => {'id': id, 'name': name};
}

/// Device capabilities (C1).
class Capability {
  Capability._();
  static const registerCards = 'cards.register';
  static const programCards = 'cards.program';
}

/// `business` block of the `POST /device/events` response (C2).
class BusinessResult {
  const BusinessResult({
    required this.result,
    this.cardId,
    this.cardName,
    this.cardKind,
    this.cardStatus,
    this.effectiveStatus,
    this.assigneeType,
    this.assigneeName,
    this.assigneePosition,
    this.assigneePhotoUrl,
    this.actionType,
    this.actionLabel,
    this.actionUrl,
    this.message,
    required this.raw,
  });

  /// `recognized` | `unknown_card` | `inactive`.
  final String result;
  final String? cardId;
  final String? cardName;
  final String? cardKind;
  final String? cardStatus;
  final String? effectiveStatus;
  final String? assigneeType;
  final String? assigneeName;
  final String? assigneePosition;
  final String? assigneePhotoUrl;
  final String? actionType;
  final String? actionLabel;
  final String? actionUrl;
  final String? message;

  /// Original JSON (persisted with the local event).
  final Map<String, dynamic> raw;

  bool get isRecognized => result == 'recognized';
  bool get isUnknown => result == 'unknown_card';
  bool get isInactive => result == 'inactive';

  factory BusinessResult.fromJson(Map<String, dynamic> j) {
    final card = j['card'] is Map ? (j['card'] as Map).cast<String, dynamic>() : const <String, dynamic>{};
    final who = j['assignee'] is Map ? (j['assignee'] as Map).cast<String, dynamic>() : const <String, dynamic>{};
    final action = j['action'] is Map ? (j['action'] as Map).cast<String, dynamic>() : const <String, dynamic>{};
    return BusinessResult(
      result: j['result'] as String? ?? 'unknown_card',
      cardId: card['id'] as String?,
      cardName: card['name'] as String?,
      cardKind: card['kind'] as String?,
      cardStatus: card['status'] as String?,
      effectiveStatus: card['effective_status'] as String?,
      assigneeType: who['type'] as String?,
      assigneeName: who['name'] as String?,
      assigneePosition: who['position'] as String?,
      assigneePhotoUrl: who['photo_url'] as String?,
      actionType: action['type'] as String?,
      actionLabel: action['label'] as String?,
      actionUrl: action['url'] as String?,
      message: j['message'] as String?,
      raw: j,
    );
  }
}

/// Item of `GET /device/business/cards` (C3).
class BusinessCardItem {
  const BusinessCardItem({
    required this.id,
    required this.name,
    required this.kind,
    this.assigneeName,
    this.uidMasked,
    required this.tapUrl,
    required this.programmed,
  });

  final String id;
  final String name;
  final String kind;
  final String? assigneeName;
  final String? uidMasked;
  final String tapUrl;
  final bool programmed;

  factory BusinessCardItem.fromJson(Map<String, dynamic> j) => BusinessCardItem(
    id: j['id'] as String? ?? '',
    name: j['name'] as String? ?? '',
    kind: j['kind'] as String? ?? 'card',
    assigneeName: j['assignee_name'] as String?,
    uidMasked: j['uid_masked'] as String?,
    tapUrl: j['tap_url'] as String? ?? '',
    programmed: j['programmed'] as bool? ?? false,
  );
}

/// Only these schemes may be opened from a business result ("Open" button).
bool isOpenableActionUrl(String? url) {
  if (url == null || url.trim().isEmpty) return false;
  final u = Uri.tryParse(url.trim());
  if (u == null) return false;
  return switch (u.scheme.toLowerCase()) {
    'http' || 'https' => u.host.isNotEmpty, // includes https://wa.me/…
    'tel' || 'mailto' => u.path.isNotEmpty,
    _ => false,
  };
}
