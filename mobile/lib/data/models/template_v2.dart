/// Part 5 §1: v2 "shape" templates (layers + zones + blocks) and the arrangement rules shared
/// with the web renderer and the backend validator.
library;

Map<String, dynamic> _map(Object? o) => o is Map ? o.cast<String, dynamic>() : <String, dynamic>{};
String? _str(Object? o) => o is String && o.isNotEmpty ? o : null;

/// All blocks a card can place (each at most once per card).
const cardBlocks = <String>[
  'photo', 'name', 'logo', 'company', 'tagline', 'qr', 'contacts', 'socials', 'website', 'address', 'bio',
  'badge_meta', 'barcode',
];

const blockLabels = <String, String>{
  'photo': 'Photo', 'name': 'Name & title', 'logo': 'Logo', 'company': 'Company', 'tagline': 'Tagline',
  'qr': 'QR code', 'contacts': 'Phone & email', 'socials': 'Social icons', 'website': 'Website',
  'address': 'Address', 'bio': 'About', 'badge_meta': 'Badge details', 'barcode': 'Barcode',
};

class CardLayer {
  const CardLayer({required this.path, required this.fill, this.opacity = 1});
  final String path;

  /// Colour token (`primary, secondary, background, text, accent, image`) or `#RRGGBB`.
  final String fill;
  final double opacity;

  factory CardLayer.fromJson(Object? json) {
    final j = _map(json);
    return CardLayer(
      path: j['path']?.toString() ?? '',
      fill: _str(j['fill']) ?? 'primary',
      opacity: ((j['opacity'] as num?)?.toDouble() ?? 1).clamp(0.0, 1.0),
    );
  }
}

class CardZone {
  const CardZone({
    required this.id,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    this.align = 'start',
    this.valign = 'start',
    this.on = 'background',
    this.accepts = cardBlocks,
    this.maxBlocks = 4,
  });

  final String id;
  final double x, y, w, h;

  /// start | center | end
  final String align, valign;

  /// Token of what is underneath the zone (drives the text colour, see [textColorOn]).
  final String on;
  final List<String> accepts;
  final int maxBlocks;

  String get label {
    final s = id.replaceAll('_', ' ');
    return s.isEmpty ? id : s[0].toUpperCase() + s.substring(1);
  }

  factory CardZone.fromJson(Object? json) {
    final j = _map(json);
    final r = (j['rect'] as List?)?.map((e) => (e as num?)?.toDouble() ?? 0).toList() ?? const [0, 0, 0, 0];
    String pick(Object? v, String d) => const ['start', 'center', 'end'].contains(v) ? v as String : d;
    return CardZone(
      id: j['id']?.toString() ?? '',
      x: r.isNotEmpty ? r[0] : 0,
      y: r.length > 1 ? r[1] : 0,
      w: r.length > 2 ? r[2] : 0,
      h: r.length > 3 ? r[3] : 0,
      align: pick(j['align'], 'start'),
      valign: pick(j['valign'], 'start'),
      on: _str(j['on']) ?? 'background',
      accepts: (j['accepts'] as List?)?.whereType<String>().where(cardBlocks.contains).toList() ?? cardBlocks,
      maxBlocks: ((j['max_blocks'] as num?)?.toInt() ?? 4).clamp(1, cardBlocks.length),
    );
  }
}

class SideCanvas {
  const SideCanvas({this.background = 'background', this.layers = const [], this.zones = const []});
  final String background;
  final List<CardLayer> layers;
  final List<CardZone> zones;

  CardZone? zone(String id) {
    for (final z in zones) {
      if (z.id == id) return z;
    }
    return null;
  }

  factory SideCanvas.fromJson(Object? json) {
    final j = _map(json);
    return SideCanvas(
      background: _str(j['background']) ?? 'background',
      layers: (j['layers'] as List?)?.map(CardLayer.fromJson).where((l) => l.path.isNotEmpty).toList() ?? const [],
      zones: (j['zones'] as List?)?.map(CardZone.fromJson).where((z) => z.id.isNotEmpty).toList() ?? const [],
    );
  }
}

/// Arrangement: `{side: {zoneId: [blockId]}}`.
typedef Arrangement = Map<String, Map<String, List<String>>>;

class TemplateV2 {
  const TemplateV2({
    required this.id,
    required this.name,
    this.category = 'business',
    this.description = '',
    this.premium = false,
    this.format = 'landscape',
    this.sides = const ['front'],
    this.defaultDesign = const {},
    this.canvas = const {},
    this.defaultArrangement = const {},
    this.variants = const [],
  });

  /// Alternative decor (`design.decor_style` = variant id): replaces a side's layers, zones unchanged.
  final List<TemplateVariant> variants;

  /// Layers of [side], or those of the selected variant (unknown id → default).
  List<CardLayer> layersFor(String side, String? decorStyle) {
    for (final v in variants) {
      if (v.id == decorStyle) return v.layers[side] ?? this.side(side).layers;
    }
    return this.side(side).layers;
  }

  final String id, name, category, description;
  final bool premium;

  /// landscape (1750×1000) | portrait (1000×1586, CR80 badge).
  final String format;
  final List<String> sides;
  final Map<String, dynamic> defaultDesign;
  final Map<String, SideCanvas> canvas;
  final Arrangement defaultArrangement;

  static const categories = ['business', 'badge', 'minimal'];

  bool get portrait => format == 'portrait';
  double get unitWidth => portrait ? 1000 : 1750;
  double get unitHeight => portrait ? 1586 : 1000;
  double get aspectRatio => unitWidth / unitHeight;
  bool get hasBack => sides.contains('back') && canvas.containsKey('back');

  SideCanvas side(String s) => canvas[s] ?? canvas['front'] ?? const SideCanvas();

  static TemplateV2? fromJson(Object? json) {
    final j = _map(json);
    if (j['engine'] != 'v2') return null;
    final id = _str(j['id']);
    if (id == null) return null;
    final canvas = {
      for (final e in _map(j['canvas']).entries)
        if (e.key == 'front' || e.key == 'back') e.key: SideCanvas.fromJson(e.value),
    };
    if (!canvas.containsKey('front')) return null;
    final sides = (j['sides'] as List?)?.whereType<String>().where(canvas.containsKey).toList() ?? const ['front'];
    return TemplateV2(
      id: id,
      name: _str(j['name']) ?? id,
      category: categories.contains(j['category']) ? j['category'] as String : 'business',
      description: j['description']?.toString() ?? '',
      premium: j['premium'] as bool? ?? false,
      format: j['format'] == 'portrait' ? 'portrait' : 'landscape',
      sides: sides.isEmpty ? const ['front'] : sides,
      defaultDesign: _map(j['default_design']),
      canvas: canvas,
      defaultArrangement: _parseArrangement(j['default_arrangement']),
      variants: [for (final v in (j['variants'] as List?) ?? const []) ?TemplateVariant.fromJson(v)],
    );
  }

  static Arrangement _parseArrangement(Object? json) => {
    for (final side in _map(json).entries)
      side.key: {
        for (final z in _map(side.value).entries)
          if (z.value is List) z.key: (z.value as List).whereType<String>().toList(),
      },
  };

  // ------------------------------------------------------------- arrangement --

  /// Validates [a] like the backend (`422 invalid_arrangement`): known sides/zones, blocks accepted
  /// by the zone, `max_blocks`, each block at most once. Returns human-readable problems.
  List<String> validate(Arrangement a) {
    final problems = <String>[];
    final seen = <String>{};
    for (final side in a.entries) {
      if (!canvas.containsKey(side.key) || !sides.contains(side.key)) {
        problems.add('unknown side ${side.key}');
        continue;
      }
      final sc = canvas[side.key]!;
      for (final z in side.value.entries) {
        final zone = sc.zone(z.key);
        if (zone == null) {
          problems.add('unknown zone ${side.key}.${z.key}');
          continue;
        }
        if (z.value.length > zone.maxBlocks) problems.add('${side.key}.${z.key}: at most ${zone.maxBlocks} blocks');
        for (final b in z.value) {
          if (!zone.accepts.contains(b)) problems.add('${side.key}.${z.key} does not accept $b');
          if (!seen.add(b)) problems.add('$b is placed twice');
        }
      }
    }
    return problems;
  }

  /// The arrangement actually rendered (web `resolveArrangement`): the card's own arrangement (or the
  /// template default when it has none), cleaned so it is always valid — unknown zones dropped,
  /// rejected / duplicate / over-capacity blocks skipped.
  Arrangement resolve(Arrangement? a) {
    final source = a != null && a.isNotEmpty ? a : defaultArrangement;
    final seen = <String>{};
    final out = <String, Map<String, List<String>>>{};
    for (final s in sides) {
      final sc = canvas[s];
      if (sc == null) continue;
      final zones = <String, List<String>>{};
      for (final zone in sc.zones) {
        final list = <String>[];
        for (final b in source[s]?[zone.id] ?? const <String>[]) {
          if (list.length < zone.maxBlocks && zone.accepts.contains(b) && seen.add(b)) list.add(b);
        }
        zones[zone.id] = list;
      }
      out[s] = zones;
    }
    return out;
  }

  /// Blocks not placed anywhere in [a] (the "hidden" tray).
  List<String> hiddenBlocks(Arrangement a) {
    final placed = {for (final s in a.values) for (final l in s.values) ...l};
    return [for (final b in cardBlocks) if (!placed.contains(b)) b];
  }

  /// Best-effort mapping when switching template (§2): blocks keep their order and go to the
  /// first zone (front, then back) that accepts them and has room. An empty [old] → default.
  Arrangement mapFrom(Arrangement old) {
    final order = [
      for (final s in const ['front', 'back'])
        for (final l in (old[s] ?? const <String, List<String>>{}).values) ...l,
    ];
    if (order.isEmpty) return resolve(null);
    final out = <String, Map<String, List<String>>>{
      for (final s in sides) s: {for (final z in canvas[s]?.zones ?? const <CardZone>[]) z.id: <String>[]},
    };
    final seen = <String>{};
    for (final b in order) {
      if (!seen.add(b)) continue;
      outer:
      for (final s in sides) {
        for (final z in canvas[s]?.zones ?? const <CardZone>[]) {
          final list = out[s]![z.id]!;
          if (z.accepts.contains(b) && list.length < z.maxBlocks) {
            list.add(b);
            break outer;
          }
        }
      }
    }
    return out;
  }

  /// Can [block] be dropped into [side].[zoneId] of [a] (moving it from wherever it is)?
  bool canPlace(Arrangement a, String side, String zoneId, String block) {
    final zone = canvas[side]?.zone(zoneId);
    if (zone == null || !zone.accepts.contains(block)) return false;
    final current = a[side]?[zoneId] ?? const <String>[];
    return current.contains(block) || current.length < zone.maxBlocks;
  }

  /// Moves [block] to [side].[zoneId] at [index] (end when null); removes it from its old place.
  /// Returns [a] unchanged when the drop is not allowed.
  Arrangement move(Arrangement a, String block, String side, String zoneId, [int? index]) {
    if (!canPlace(a, side, zoneId, block)) return a;
    final out = copy(a);
    int? oldIndex;
    for (final s in out.entries) {
      for (final z in s.value.entries) {
        final i = z.value.indexOf(block);
        if (i >= 0) {
          if (s.key == side && z.key == zoneId) oldIndex = i;
          z.value.removeAt(i);
        }
      }
    }
    final list = out.putIfAbsent(side, () => {}).putIfAbsent(zoneId, () => []);
    var at = index ?? list.length;
    if (oldIndex != null && index != null && oldIndex < index) at -= 1;
    list.insert(at.clamp(0, list.length), block);
    return out;
  }

  /// Removes [block] from the card (to the hidden tray).
  static Arrangement hide(Arrangement a, String block) {
    final out = copy(a);
    for (final s in out.values) {
      for (final l in s.values) {
        l.remove(block);
      }
    }
    return out;
  }

  static Arrangement copy(Arrangement a) => {
    for (final s in a.entries) s.key: {for (final z in s.value.entries) z.key: [...z.value]},
  };
}

class TemplateVariant {
  const TemplateVariant({required this.id, required this.name, this.layers = const {}});
  final String id, name;
  final Map<String, List<CardLayer>> layers;

  static TemplateVariant? fromJson(Object? json) {
    final j = _map(json);
    final id = _str(j['id']);
    if (id == null) return null;
    return TemplateVariant(
      id: id,
      name: _str(j['name']) ?? id,
      layers: {
        for (final e in _map(j['canvas']).entries)
          if (_map(e.value)['layers'] is List)
            e.key: [for (final l in _map(e.value)['layers'] as List) CardLayer.fromJson(l)],
      },
    );
  }
}
