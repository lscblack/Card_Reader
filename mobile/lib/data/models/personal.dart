/// Part 4 personal-account models (digital cards, contacts, sessions…).
library;

import 'dart:convert';

Map<String, dynamic> _map(Object? o) => o is Map ? o.cast<String, dynamic>() : <String, dynamic>{};
List<Map<String, dynamic>> _maps(Object? o) =>
    o is List ? o.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList() : [];
String? _str(Object? o) => o is String && o.isNotEmpty ? o : null;

class CardDesign {
  const CardDesign({
    this.primary = '#B91C1C',
    this.background = '#FFFFFF',
    this.text = '#1F1414',
    this.accent = '#F59E0B',
    this.backgroundStyle = 'solid',
    this.pattern,
    this.font = 'sans',
    this.cornerRadius = 20,
    this.showQr = false,
  });

  final String primary, background, text, accent;

  /// solid | gradient | glass | pattern
  final String backgroundStyle;
  final String? pattern;

  /// sans | serif | mono | display
  final String font;
  final int cornerRadius;
  final bool showQr;

  factory CardDesign.fromJson(Object? json) {
    final j = _map(json);
    return CardDesign(
      primary: _str(j['primary']) ?? '#B91C1C',
      background: _str(j['background']) ?? '#FFFFFF',
      text: _str(j['text']) ?? '#1F1414',
      accent: _str(j['accent']) ?? '#F59E0B',
      backgroundStyle: _str(j['background_style']) ?? 'solid',
      pattern: _str(j['pattern']),
      font: _str(j['font']) ?? 'sans',
      cornerRadius: ((j['corner_radius'] as num?)?.toInt() ?? 20).clamp(0, 32),
      showQr: j['show_qr'] as bool? ?? false,
    );
  }

  Map<String, Object?> toJson() => {
    'primary': primary,
    'background': background,
    'text': text,
    'accent': accent,
    'background_style': backgroundStyle,
    'pattern': pattern,
    'font': font,
    'corner_radius': cornerRadius,
    'show_qr': showQr,
  };

  CardDesign copyWith({
    String? primary,
    String? background,
    String? text,
    String? accent,
    String? backgroundStyle,
    String? Function()? pattern,
    String? font,
    int? cornerRadius,
    bool? showQr,
  }) => CardDesign(
    primary: primary ?? this.primary,
    background: background ?? this.background,
    text: text ?? this.text,
    accent: accent ?? this.accent,
    backgroundStyle: backgroundStyle ?? this.backgroundStyle,
    pattern: pattern != null ? pattern() : this.pattern,
    font: font ?? this.font,
    cornerRadius: cornerRadius ?? this.cornerRadius,
    showQr: showQr ?? this.showQr,
  );
}

/// `{label, value}` / `{label, url}` / `{platform, url}` rows.
class LabeledValue {
  const LabeledValue(this.label, this.value);
  final String label;
  final String value;

  static List<LabeledValue> list(Object? o, String labelKey, String valueKey) => _maps(o)
      .map((m) => LabeledValue(m[labelKey]?.toString() ?? '', m[valueKey]?.toString() ?? ''))
      .toList();

  Map<String, String> toJson(String labelKey, String valueKey) => {labelKey: label, valueKey: value};
}

class CardFields {
  const CardFields({
    this.fullName = '',
    this.pronouns,
    this.headline,
    this.jobTitle,
    this.company,
    this.department,
    this.bio,
    this.phones = const [],
    this.emails = const [],
    this.websites = const [],
    this.address,
    this.socials = const [],
    this.customLinks = const [],
  });

  final String fullName;
  final String? pronouns, headline, jobTitle, company, department, bio, address;
  final List<LabeledValue> phones, emails, websites, socials, customLinks;

  static const keys = [
    'full_name', 'pronouns', 'headline', 'job_title', 'company', 'department', 'bio', 'phones', 'emails',
    'websites', 'address', 'socials', 'custom_links',
  ];

  factory CardFields.fromJson(Object? json) {
    final j = _map(json);
    return CardFields(
      fullName: j['full_name']?.toString() ?? '',
      pronouns: _str(j['pronouns']),
      headline: _str(j['headline']),
      jobTitle: _str(j['job_title']),
      company: _str(j['company']),
      department: _str(j['department']),
      bio: _str(j['bio']),
      phones: LabeledValue.list(j['phones'], 'label', 'value'),
      emails: LabeledValue.list(j['emails'], 'label', 'value'),
      websites: LabeledValue.list(j['websites'], 'label', 'url'),
      address: _str(j['address']),
      socials: LabeledValue.list(j['socials'], 'platform', 'url'),
      customLinks: LabeledValue.list(j['custom_links'], 'label', 'url'),
    );
  }

  Map<String, Object?> toJson() => {
    'full_name': fullName,
    'pronouns': pronouns,
    'headline': headline,
    'job_title': jobTitle,
    'company': company,
    'department': department,
    'bio': bio,
    'phones': phones.map((e) => e.toJson('label', 'value')).toList(),
    'emails': emails.map((e) => e.toJson('label', 'value')).toList(),
    'websites': websites.map((e) => e.toJson('label', 'url')).toList(),
    'address': address,
    'socials': socials.map((e) => e.toJson('platform', 'url')).toList(),
    'custom_links': customLinks.map((e) => e.toJson('label', 'url')).toList(),
  };

  CardFields copyWithJson(Map<String, Object?> patch) => CardFields.fromJson({...toJson(), ...patch});

  String get subtitle => [
    ?jobTitle,
    ?company,
  ].join(' · ');

  String get initials {
    final parts = fullName.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
  }
}

class ShareSettings {
  const ShareSettings({
    this.autoExchange = true,
    this.webPageEnabled = true,
    this.leadCaptureEnabled = true,
    this.nfcSharingEnabled = true,
  });

  final bool autoExchange, webPageEnabled, leadCaptureEnabled, nfcSharingEnabled;

  factory ShareSettings.fromJson(Object? json) {
    final j = _map(json);
    return ShareSettings(
      autoExchange: j['auto_exchange'] as bool? ?? true,
      webPageEnabled: j['web_page_enabled'] as bool? ?? true,
      leadCaptureEnabled: j['lead_capture_enabled'] as bool? ?? true,
      nfcSharingEnabled: j['nfc_sharing_enabled'] as bool? ?? true,
    );
  }

  Map<String, Object?> toJson() => {
    'auto_exchange': autoExchange,
    'web_page_enabled': webPageEnabled,
    'lead_capture_enabled': leadCaptureEnabled,
    'nfc_sharing_enabled': nfcSharingEnabled,
  };

  ShareSettings copyWith({bool? autoExchange, bool? webPageEnabled, bool? leadCaptureEnabled, bool? nfcSharingEnabled}) =>
      ShareSettings(
        autoExchange: autoExchange ?? this.autoExchange,
        webPageEnabled: webPageEnabled ?? this.webPageEnabled,
        leadCaptureEnabled: leadCaptureEnabled ?? this.leadCaptureEnabled,
        nfcSharingEnabled: nfcSharingEnabled ?? this.nfcSharingEnabled,
      );
}

class BusinessLink {
  const BusinessLink({required this.businessName, this.lockedFields = const [], this.templateLocked = false, this.status});
  final String businessName;
  final List<String> lockedFields;
  final bool templateLocked;
  final String? status;

  static BusinessLink? fromJson(Object? json) {
    if (json is! Map) return null;
    final j = json.cast<String, dynamic>();
    return BusinessLink(
      businessName: j['business_name']?.toString() ?? '',
      lockedFields: (j['locked_fields'] as List?)?.whereType<String>().toList() ?? const [],
      templateLocked: j['template_locked'] as bool? ?? false,
      status: _str(j['status']),
    );
  }
}

/// Visibility per field: public | contacts | hidden.
class FieldVisibility {
  static const defaults = <String, String>{
    'full_name': 'public', 'headline': 'public', 'company': 'public', 'job_title': 'public', 'photo': 'public',
    'socials': 'public', 'websites': 'public', 'pronouns': 'public', 'department': 'public', 'bio': 'public',
    'custom_links': 'public', 'phones': 'contacts', 'emails': 'contacts', 'address': 'hidden',
  };

  static Map<String, String> parse(Object? json) =>
      {...defaults, ..._map(json).map((k, v) => MapEntry(k, v.toString()))};
}

class DigitalCard {
  const DigitalCard({
    required this.id,
    required this.shareId,
    this.label = '',
    this.isPrimary = false,
    this.status = 'active',
    this.slug,
    this.publicUrl,
    this.templateId = 'modern',
    this.design = const CardDesign(),
    this.photoUrl,
    this.coverUrl,
    this.logoUrl,
    this.fields = const CardFields(),
    this.visibility = FieldVisibility.defaults,
    this.shareSettings = const ShareSettings(),
    this.businessLink,
    this.stats = const {},
    this.raw = const {},
  });

  final String id;
  final String shareId;
  final String label;
  final bool isPrimary;
  final String status;
  final String? slug, publicUrl;
  final String templateId;
  final CardDesign design;
  final String? photoUrl, coverUrl, logoUrl;
  final CardFields fields;
  final Map<String, String> visibility;
  final ShareSettings shareSettings;
  final BusinessLink? businessLink;
  final Map<String, int> stats;
  final Map<String, dynamic> raw;

  bool get isActive => status == 'active';
  bool isLocked(String field) => businessLink?.lockedFields.contains(field) ?? false;

  factory DigitalCard.fromJson(Object? json) {
    final j = _map(json);
    return DigitalCard(
      id: j['id']?.toString() ?? '',
      shareId: j['share_id']?.toString() ?? '',
      label: j['label']?.toString() ?? '',
      isPrimary: j['is_primary'] as bool? ?? false,
      status: _str(j['status']) ?? 'active',
      slug: _str(j['slug']),
      publicUrl: _str(j['public_url']),
      templateId: _str(j['template_id']) ?? _str(j['template']) ?? 'modern',
      design: CardDesign.fromJson(j['design']),
      photoUrl: _str(j['photo_url']),
      coverUrl: _str(j['cover_url']),
      logoUrl: _str(j['logo_url']),
      fields: CardFields.fromJson(j['fields']),
      visibility: FieldVisibility.parse(j['visibility']),
      shareSettings: ShareSettings.fromJson(j['share_settings']),
      businessLink: BusinessLink.fromJson(j['business_link']),
      stats: _map(j['stats']).map((k, v) => MapEntry(k, (v as num?)?.toInt() ?? 0)),
      raw: j,
    );
  }

  /// Body for `PATCH /personal/cards/{id}` (editable parts only; locked fields left out).
  Map<String, Object?> toPatch() {
    final f = fields.toJson()..removeWhere((k, _) => isLocked(k));
    return {
      'label': label,
      if (!(businessLink?.templateLocked ?? false)) 'template_id': templateId,
      if (!(businessLink?.templateLocked ?? false)) 'design': design.toJson(),
      'fields': f,
      'visibility': visibility,
      'share_settings': shareSettings.toJson(),
    };
  }

  DigitalCard copyWith({
    String? label,
    String? templateId,
    CardDesign? design,
    CardFields? fields,
    Map<String, String>? visibility,
    ShareSettings? shareSettings,
    bool? isPrimary,
    String? Function()? photoUrl,
    String? Function()? coverUrl,
    String? Function()? logoUrl,
  }) => DigitalCard(
    id: id,
    shareId: shareId,
    label: label ?? this.label,
    isPrimary: isPrimary ?? this.isPrimary,
    status: status,
    slug: slug,
    publicUrl: publicUrl,
    templateId: templateId ?? this.templateId,
    design: design ?? this.design,
    photoUrl: photoUrl != null ? photoUrl() : this.photoUrl,
    coverUrl: coverUrl != null ? coverUrl() : this.coverUrl,
    logoUrl: logoUrl != null ? logoUrl() : this.logoUrl,
    fields: fields ?? this.fields,
    visibility: visibility ?? this.visibility,
    shareSettings: shareSettings ?? this.shareSettings,
    businessLink: businessLink,
    stats: stats,
    raw: raw,
  );

  String toCacheJson() => jsonEncode(raw.isEmpty ? {'id': id, 'share_id': shareId} : raw);
}

class CardTemplate {
  const CardTemplate({
    required this.id,
    required this.name,
    this.description = '',
    required this.layout,
    this.defaultDesign = const CardDesign(),
    this.supportsPhoto = true,
    this.supportsCover = false,
    this.supportsLogo = false,
    this.premium = false,
  });

  final String id, name, description;

  /// centered | left | split | hero_photo | banner | compact
  final String layout;
  final CardDesign defaultDesign;
  final bool supportsPhoto, supportsCover, supportsLogo, premium;

  static const layouts = ['centered', 'left', 'split', 'hero_photo', 'banner', 'compact'];

  factory CardTemplate.fromJson(Object? json) {
    final j = _map(json);
    final s = _map(j['supports']);
    final layout = _str(j['layout']) ?? 'centered';
    return CardTemplate(
      id: j['id']?.toString() ?? '',
      name: j['name']?.toString() ?? '',
      description: j['description']?.toString() ?? '',
      layout: layouts.contains(layout) ? layout : 'centered',
      defaultDesign: CardDesign.fromJson(j['default_design']),
      supportsPhoto: s['photo'] as bool? ?? true,
      supportsCover: s['cover'] as bool? ?? false,
      supportsLogo: s['logo'] as bool? ?? false,
      premium: j['premium'] as bool? ?? false,
    );
  }

  /// Offline fallback matching the backend's seeded templates (layouts verified against
  /// GET /personal/templates); the server list wins when loaded.
  static const builtIn = <CardTemplate>[
    CardTemplate(id: 'classic', name: 'Classic', layout: 'left', supportsLogo: true,
        defaultDesign: CardDesign(primary: '#1F2937', background: '#FFFFFF', text: '#111827', accent: '#B91C1C', font: 'serif')),
    CardTemplate(id: 'modern', name: 'Modern', layout: 'centered',
        defaultDesign: CardDesign(primary: '#B91C1C', background: '#FFFFFF', text: '#1F1414', accent: '#F59E0B')),
    CardTemplate(id: 'minimal', name: 'Minimal', layout: 'centered', supportsLogo: true,
        defaultDesign: CardDesign(primary: '#111111', background: '#FAFAFA', text: '#111111', accent: '#B91C1C', cornerRadius: 8)),
    CardTemplate(id: 'gradient', name: 'Gradient', layout: 'centered',
        defaultDesign: CardDesign(primary: '#B91C1C', background: '#7C2D12', text: '#FFFFFF', accent: '#FBBF24', backgroundStyle: 'gradient')),
    CardTemplate(id: 'glass', name: 'Glass', layout: 'banner', supportsCover: true,
        defaultDesign: CardDesign(primary: '#DC2626', background: '#1C1917', text: '#FFFFFF', accent: '#FCA5A5', backgroundStyle: 'glass')),
    CardTemplate(id: 'bold', name: 'Bold', layout: 'left',
        defaultDesign: CardDesign(primary: '#991B1B', background: '#FFF7ED', text: '#1C1917', accent: '#EA580C', font: 'display')),
    CardTemplate(id: 'split', name: 'Split', layout: 'split',
        defaultDesign: CardDesign(primary: '#B91C1C', background: '#FFFFFF', text: '#1F1414', accent: '#FDE68A')),
    CardTemplate(id: 'photo_hero', name: 'Photo hero', layout: 'hero_photo', supportsCover: true,
        defaultDesign: CardDesign(primary: '#B91C1C', background: '#0C0A09', text: '#FFFFFF', accent: '#F87171')),
    CardTemplate(id: 'business', name: 'Business', layout: 'compact', supportsLogo: true,
        defaultDesign: CardDesign(primary: '#7F1D1D', background: '#FFFFFF', text: '#1C1917', accent: '#B91C1C', cornerRadius: 10)),
  ];
}

class ShareKey {
  const ShareKey({required this.keyId, required this.secret});
  final int keyId;

  /// base64url, 32 raw bytes.
  final String secret;

  factory ShareKey.fromJson(Object? json) {
    final j = _map(json);
    return ShareKey(keyId: (j['key_id'] as num?)?.toInt() ?? 0, secret: j['secret']?.toString() ?? '');
  }

  Map<String, Object?> toJson() => {'key_id': keyId, 'secret': secret};
}

class PersonalSession {
  const PersonalSession({required this.id, this.deviceName, this.platform, this.model, this.lastSeenAt, this.createdAt, this.revokedAt});
  final String id;
  final String? deviceName, platform, model, lastSeenAt, createdAt, revokedAt;

  factory PersonalSession.fromJson(Object? json) {
    final j = _map(json);
    return PersonalSession(
      id: j['id']?.toString() ?? '',
      deviceName: _str(j['device_name']),
      platform: _str(j['platform']),
      model: _str(j['model']),
      lastSeenAt: _str(j['last_seen_at']),
      createdAt: _str(j['created_at']),
      revokedAt: _str(j['revoked_at']),
    );
  }
}

class PersonalUser {
  const PersonalUser({required this.id, required this.email, this.fullName = ''});
  final String id, email, fullName;

  factory PersonalUser.fromJson(Object? json) {
    final j = _map(json);
    return PersonalUser(id: j['id']?.toString() ?? '', email: j['email']?.toString() ?? '', fullName: j['full_name']?.toString() ?? '');
  }

  Map<String, Object?> toJson() => {'id': id, 'email': email, 'full_name': fullName};
}

/// Result of `POST /personal/sessions`.
class SessionGrant {
  const SessionGrant({required this.token, required this.session, required this.user, required this.shareKey, required this.cards});
  final String token;
  final PersonalSession session;
  final PersonalUser user;
  final ShareKey shareKey;
  final List<DigitalCard> cards;
}

class Contact {
  const Contact({
    required this.id,
    required this.source,
    required this.card,
    this.notes = '',
    this.tags = const [],
    this.favorite = false,
    this.live = false,
    this.metAt,
    this.templateLayout,
  });

  final String id, source;

  /// Snapshot of the other person's card (fields/design/template/photo).
  final DigitalCard card;
  final String notes;
  final List<String> tags;
  final bool favorite, live;
  final String? metAt;
  final String? templateLayout;

  String get name => card.fields.fullName.isEmpty ? 'Unnamed contact' : card.fields.fullName;

  factory Contact.fromJson(Object? json) {
    final j = _map(json);
    return Contact(
      id: j['id']?.toString() ?? '',
      source: j['source']?.toString() ?? 'manual',
      card: DigitalCard.fromJson({'id': j['counterpart_card_id'] ?? '', 'share_id': '', ..._map(j['card'])}),
      notes: j['notes']?.toString() ?? '',
      tags: (j['tags'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      favorite: j['favorite'] as bool? ?? false,
      live: j['live'] as bool? ?? false,
      metAt: _str(j['met_at']) ?? _str(j['created_at']),
      templateLayout: _str(_map(j['card'])['layout']),
    );
  }

  Contact copyWith({String? notes, List<String>? tags, bool? favorite}) => Contact(
    id: id, source: source, card: card, notes: notes ?? this.notes, tags: tags ?? this.tags,
    favorite: favorite ?? this.favorite, live: live, metAt: metAt, templateLayout: templateLayout);
}

class ExchangeResult {
  const ExchangeResult({required this.contact, required this.mutual, required this.alreadyConnected});
  final Contact contact;
  final bool mutual, alreadyConnected;

  factory ExchangeResult.fromJson(Object? json) {
    final j = _map(json);
    return ExchangeResult(
      contact: Contact.fromJson(j['contact']),
      mutual: j['mutual'] as bool? ?? false,
      alreadyConnected: j['already_connected'] as bool? ?? false,
    );
  }
}

class ActivityItem {
  const ActivityItem({required this.type, required this.title, this.detail, this.createdAt, this.source});
  final String type, title;
  final String? detail, createdAt, source;

  static String typeLabel(String type) => switch (type) {
    'view' => 'Card viewed',
    'nfc_tap' => 'NFC tap',
    'exchange' => 'Cards exchanged',
    'lead' => 'New lead',
    'terminal_read' => 'Read by a terminal',
    _ => type.replaceAll('_', ' '),
  };

  factory ActivityItem.fromJson(Object? json) {
    final j = _map(json);
    final type = j['type']?.toString() ?? 'event';
    final who = _str(j['counterpart_name']);
    return ActivityItem(
      type: type,
      title: _str(j['detail']) ?? _str(j['title']) ?? '${typeLabel(type)}${who == null ? '' : ' · $who'}',
      detail: _str(j['card_label']),
      createdAt: _str(j['created_at']) ?? _str(j['at']),
      source: _str(j['source']),
    );
  }
}

class BusinessInvite {
  const BusinessInvite({required this.id, required this.businessName, this.employeeName, this.status = 'pending', this.createdAt});
  final String id, businessName, status;
  final String? employeeName, createdAt;

  factory BusinessInvite.fromJson(Object? json) {
    final j = _map(json);
    return BusinessInvite(
      id: j['id']?.toString() ?? '',
      businessName: _str(j['business_name']) ?? _str(_map(j['business'])['name']) ?? 'A business',
      employeeName: _str(j['employee_name']),
      status: _str(j['status']) ?? 'pending',
      createdAt: _str(j['created_at']),
    );
  }
}

/// Terminal-side `digital_card` block (Part 4 §5), public fields only.
class DigitalCardSummary {
  const DigitalCardSummary({
    required this.id,
    required this.verified,
    this.fullName,
    this.headline,
    this.company,
    this.jobTitle,
    this.photoUrl,
    this.publicUrl,
    this.raw = const {},
  });

  final String id;
  final bool verified;
  final String? fullName, headline, company, jobTitle, photoUrl, publicUrl;
  final Map<String, dynamic> raw;

  static DigitalCardSummary? fromJson(Object? json) {
    if (json is! Map) return null;
    final j = json.cast<String, dynamic>();
    return DigitalCardSummary(
      id: j['id']?.toString() ?? '',
      verified: j['verified'] as bool? ?? false,
      fullName: _str(j['full_name']),
      headline: _str(j['headline']),
      company: _str(j['company']),
      jobTitle: _str(j['job_title']),
      photoUrl: _str(j['photo_url']),
      publicUrl: _str(j['public_url']),
      raw: j,
    );
  }
}
