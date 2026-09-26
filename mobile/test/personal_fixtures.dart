import 'package:nfc_terminal/data/models/personal.dart';

Map<String, dynamic> cardJson({
  String id = 'card-1',
  String shareId = '3b241101-e2bb-4255-8caf-4136c566a962',
  bool primary = true,
  String template = 'modern',
  String style = 'solid',
  String font = 'sans',
  String name = 'Jane Mukamana-Uwimana with a Very Long Name',
  bool nfc = true,
  bool web = true,
  Map<String, Object?>? businessLink,
}) => {
  'id': id,
  'share_id': shareId,
  'label': 'Work',
  'is_primary': primary,
  'status': 'active',
  'slug': 'jane',
  'public_url': 'https://cards.example.com/p/jane',
  'template_id': template,
  'design': {
    'primary': '#B91C1C', 'background': '#FFFFFF', 'text': '#1F1414', 'accent': '#F59E0B',
    'background_style': style, 'pattern': 'dots', 'font': font, 'corner_radius': 24, 'show_qr': true,
  },
  'photo_url': null,
  'cover_url': null,
  'logo_url': null,
  'fields': {
    'full_name': name,
    'pronouns': 'she/her',
    'headline': 'Helping teams ship delightful NFC experiences across East Africa and beyond',
    'job_title': 'Head of Partnerships and Strategic Alliances',
    'company': 'Nexventures International Holdings Ltd',
    'department': 'Growth',
    'bio': 'I connect people and products. Ask me about NFC, payments and good coffee.',
    'phones': [
      {'label': 'Mobile', 'value': '+250 788 123 456'},
      {'label': 'Office', 'value': '+250 252 000 111'},
    ],
    'emails': [
      {'label': 'Work', 'value': 'jane.mukamana-uwimana@nexventures-international.example.com'},
    ],
    'websites': [{'label': 'Site', 'url': 'https://nexventures.net'}],
    'address': 'KG 7 Ave, Kigali Heights, 4th floor, Kigali, Rwanda',
    'socials': [
      {'platform': 'linkedin', 'url': 'https://linkedin.com/in/jane'},
      {'platform': 'x', 'url': 'https://x.com/jane'},
    ],
    'custom_links': [{'label': 'Book a meeting', 'url': 'https://cal.example.com/jane'}],
  },
  'visibility': {'address': 'contacts'},
  'share_settings': {'auto_exchange': true, 'web_page_enabled': web, 'lead_capture_enabled': true, 'nfc_sharing_enabled': nfc},
  'business_link': businessLink,
  'stats': {'views': 12, 'nfc_taps': 4, 'exchanges': 3, 'leads': 1},
};

DigitalCard sampleCard({String template = 'modern', String style = 'solid', String font = 'sans', String? name}) =>
    DigitalCard.fromJson(cardJson(template: template, style: style, font: font, name: name ?? 'Jane Mukamana-Uwimana with a Very Long Name'));

/// A v2 card on [template] (Part 5) with badge fields set.
DigitalCard v2Card(String template, {bool back = true, String? validUntil = '2099-12-31', Map<String, Object?>? design}) {
  final j = cardJson(template: template, name: 'Jane Mukamana');
  j['design_version'] = 2;
  j['sides_enabled'] = back ? ['front', 'back'] : ['front'];
  j['design'] = {
    'primary': '#B91C1C', 'secondary': '#1F2937', 'background': '#FFFFFF', 'text': '#111827', 'accent': '#B91C1C',
    'font': 'sans', 'corner_radius': 16, 'photo_shape': 'circle', 'photo_ring': true, 'icon_style': 'filled',
    'background_image_opacity': 0.0, ...?design,
  };
  (j['fields'] as Map)
    ..['job_title'] = 'Head of Partnerships'
    ..['company'] = 'Nexventures'
    ..['id_number'] = 'NX-0042'
    ..['valid_until'] = validUntil
    ..['barcode_value'] = 'NX0042';
  return DigitalCard.fromJson(j);
}
