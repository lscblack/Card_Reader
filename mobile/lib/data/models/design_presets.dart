/// `GET /personal/design-presets` (Part 5 §3): palettes and font pairs for the editor.
library;

Map<String, dynamic> _map(Object? o) => o is Map ? o.cast<String, dynamic>() : <String, dynamic>{};
final _hex = RegExp(r'^#[0-9a-fA-F]{6}$');

class CardPalettePreset {
  const CardPalettePreset({
    required this.id,
    required this.name,
    required this.primary,
    required this.secondary,
    required this.background,
    required this.text,
    required this.accent,
  });

  final String id, name, primary, secondary, background, text, accent;

  List<String> get swatches => [primary, secondary, accent, background, text];

  Map<String, Object?> toJson() => {
    'id': id, 'name': name, 'primary': primary, 'secondary': secondary, 'background': background, 'text': text,
    'accent': accent,
  };

  static CardPalettePreset? fromJson(Object? json) {
    final j = _map(json);
    String? c(String k) => j[k] is String && _hex.hasMatch(j[k] as String) ? (j[k] as String).toUpperCase() : null;
    final p = c('primary'), s = c('secondary'), b = c('background'), t = c('text'), a = c('accent');
    if (p == null || b == null || t == null) return null;
    return CardPalettePreset(
      id: j['id']?.toString() ?? p,
      name: j['name']?.toString() ?? '',
      primary: p,
      secondary: s ?? p,
      background: b,
      text: t,
      accent: a ?? p,
    );
  }
}

class FontPair {
  const FontPair({required this.id, required this.name, this.heading = '', this.body = '', this.style = ''});

  /// Stored as `design.font` (`sans, display, geometric, elegant, serif, humanist, condensed, mono`).
  final String id;
  final String name, heading, body;

  /// Short description ("Clean and modern").
  final String style;

  Map<String, Object?> toJson() => {'id': id, 'name': name, 'heading': heading, 'body': body, 'style': style};

  static FontPair? fromJson(Object? json) {
    final j = _map(json);
    final id = j['id'];
    if (id is! String || id.isEmpty) return null;
    return FontPair(
      id: id,
      name: j['name']?.toString() ?? id,
      heading: j['heading']?.toString() ?? '',
      body: j['body']?.toString() ?? '',
      style: j['style']?.toString() ?? '',
    );
  }
}

class DesignPresets {
  const DesignPresets({this.palettes = const [], this.fontPairs = const []});
  final List<CardPalettePreset> palettes;
  final List<FontPair> fontPairs;

  bool get isEmpty => palettes.isEmpty && fontPairs.isEmpty;

  Map<String, Object?> toJson() => {
    'palettes': [for (final p in palettes) p.toJson()],
    'font_pairs': [for (final f in fontPairs) f.toJson()],
  };

  factory DesignPresets.fromJson(Object? json) {
    final j = _map(json);
    return DesignPresets(
      palettes: [for (final p in (j['palettes'] as List?) ?? const []) ?CardPalettePreset.fromJson(p)],
      fontPairs: [for (final f in (j['font_pairs'] as List?) ?? const []) ?FontPair.fromJson(f)],
    );
  }

  /// Used until the server list (or the bundled asset) is loaded.
  static const fallback = DesignPresets(
    palettes: [
      CardPalettePreset(id: 'crimson_navy', name: 'Crimson & Navy', primary: '#B91C1C', secondary: '#1F2937',
          background: '#FFFFFF', text: '#111827', accent: '#B91C1C'),
      CardPalettePreset(id: 'mono', name: 'Mono', primary: '#111111', secondary: '#404040',
          background: '#FFFFFF', text: '#111111', accent: '#111111'),
    ],
    fontPairs: [
      FontPair(id: 'sans', name: 'Inter', heading: 'sans', body: 'sans'),
      FontPair(id: 'serif', name: 'Classic serif', heading: 'serif', body: 'serif'),
    ],
  );
}
