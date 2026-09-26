import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../data/models/design_presets.dart';
import '../../data/models/personal.dart';
import '../../data/models/template_v2.dart';
import '../card_v2/card_math.dart';
import '../card_v2/palette_extract.dart';
import '../card_v2/card_v2_view.dart' show fontsFor;
import '../digital_card/card_style.dart';
import '../digital_card/color_picker.dart';
import '../theme.dart';

/// Contrast problems of a design (text on background, accent icons on background).
List<String> contrastWarnings(CardDesign d) {
  final p = CardPalette(d);
  final out = <String>[];
  final text = contrastRatio(p.text, p.background);
  if (text < 4.5) {
    out.add('Text on background is ${text.toStringAsFixed(1)}:1 — below 4.5:1, hard to read. '
        'Zones switch to white text automatically where possible.');
  }
  final accent = contrastRatio(p.accent, p.background);
  if (accent < 3) out.add('Accent on background is ${accent.toStringAsFixed(1)}:1 — icons may be hard to see.');
  return out;
}

CardDesign applyPalette(CardDesign d, CardPalettePreset p) =>
    d.copyWith(primary: p.primary, secondary: p.secondary, background: p.background, text: p.text, accent: p.accent);

/// "Surprise me": random palette, photo shape and icon style (deterministic with [random]).
CardDesign surprise(CardDesign d, List<CardPalettePreset> palettes, math.Random random) {
  var next = palettes.isEmpty ? d : applyPalette(d, palettes[random.nextInt(palettes.length)]);
  next = next.copyWith(
    photoShape: CardDesign.photoShapes[random.nextInt(CardDesign.photoShapes.length)],
    iconStyle: const ['filled', 'outline'][random.nextInt(2)],
    photoRing: random.nextBool(),
  );
  return next;
}

/// Part 5 §5 "Design" panel for v2 cards.
class DesignV2Panel extends StatefulWidget {
  const DesignV2Panel({
    super.key,
    required this.card,
    required this.presets,
    required this.onChanged,
    this.locked = false,
    this.random,
    this.variants = const [],
  });

  final List<TemplateVariant> variants;
  final DigitalCard card;
  final DesignPresets presets;
  final ValueChanged<CardDesign> onChanged;
  final bool locked;
  final math.Random? random;

  @override
  State<DesignV2Panel> createState() => _DesignV2PanelState();
}

class _DesignV2PanelState extends State<DesignV2Panel> {
  CardPalettePreset? _extracted;
  bool _extracting = false;
  String? _extractError;
  late final math.Random _random = widget.random ?? math.Random();

  CardDesign get d => widget.card.design;
  void _set(CardDesign n) => widget.onChanged(n);

  Future<void> _extract(String url) async {
    setState(() {
      _extracting = true;
      _extractError = null;
    });
    final colors = await extractColors(NetworkImage(url));
    if (!mounted) return;
    setState(() {
      _extracting = false;
      _extracted = suggestPalette(colors);
      if (_extracted == null) _extractError = 'Could not read colours from this image.';
    });
  }

  Widget _section(String text) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
    child: Text(text, style: Theme.of(context).textTheme.titleSmall),
  );

  Widget _paletteTile(CardPalettePreset p) {
    final scheme = Theme.of(context).colorScheme;
    final selected = d.primary == p.primary && d.background == p.background && d.text == p.text &&
        (d.secondary ?? '') == p.secondary && d.accent == p.accent;
    return Padding(
      padding: const EdgeInsets.only(right: 10),
      child: InkWell(
        key: Key('palette_${p.id}'),
        borderRadius: BorderRadius.circular(14),
        onTap: widget.locked ? null : () => _set(applyPalette(d, p)),
        child: Container(
          width: 112,
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? scheme.primary : scheme.outlineVariant, width: selected ? 2 : 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  height: 28,
                  child: Row(children: [
                    for (final c in p.swatches) Expanded(child: ColoredBox(color: hexColor(c))),
                  ]),
                ),
              ),
              const SizedBox(height: 6),
              Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.labelMedium),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final locked = widget.locked;
    final warnings = contrastWarnings(d);
    Widget colorRow(String label, String value, ValueChanged<String> onPick) => ListTile(
      key: Key('color_$label'),
      enabled: !locked,
      dense: true,
      title: Text(label),
      subtitle: Text(value.toUpperCase()),
      trailing: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: hexColor(value),
          shape: BoxShape.circle,
          border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        ),
      ),
      onTap: () async {
        final c = await pickCardColor(context, value, title: label);
        if (c != null) onPick(c);
      },
    );
    final photo = widget.card.photoUrl, logo = widget.card.logoUrl, cover = widget.card.coverUrl;
    return ListView(
      key: const Key('designV2'),
      padding: const EdgeInsets.only(bottom: 32),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            FilledButton.tonalIcon(
              key: const Key('surpriseMe'),
              onPressed: locked ? null : () => _set(surprise(d, widget.presets.palettes, _random)),
              icon: const Icon(Icons.auto_awesome),
              label: const Text('Surprise me'),
            ),
            if (photo != null || logo != null)
              OutlinedButton.icon(
                key: const Key('extractColors'),
                onPressed: locked || _extracting ? null : () => _extract(logo ?? photo!),
                icon: _extracting
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.colorize),
                label: Text('Colours from ${logo != null ? 'logo' : 'photo'}'),
              ),
          ]),
        ),
        if (_extractError != null)
          Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), child: Text(_extractError!)),
        _section('Palettes'),
        SizedBox(
          height: 78,
          child: ListView(
            key: const Key('palettes'),
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              if (_extracted != null) _paletteTile(_extracted!),
              for (final p in widget.presets.palettes) _paletteTile(p),
            ],
          ),
        ),
        _section('Colours'),
        colorRow('Primary', d.primary, (c) => _set(d.copyWith(primary: c))),
        colorRow('Secondary', d.secondary ?? '#1F2937', (c) => _set(d.copyWith(secondary: c))),
        colorRow('Background', d.background, (c) => _set(d.copyWith(background: c))),
        colorRow('Text', d.text, (c) => _set(d.copyWith(text: c))),
        colorRow('Accent', d.accent, (c) => _set(d.copyWith(accent: c))),
        // Several warnings can show at once; sibling keys must be unique.
        for (final (i, w) in warnings.indexed)
          Padding(
            key: ValueKey('contrastWarning-$i'),
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(Icons.contrast, size: 18, color: StatusColors.warning(context)),
              const SizedBox(width: 8),
              Expanded(child: Text(w, style: Theme.of(context).textTheme.bodySmall)),
            ]),
          ),
        _section('Fonts'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            for (final f in widget.presets.fontPairs)
              Tooltip(
                message: f.style,
                child: ChoiceChip(
                  key: Key('font_${f.id}'),
                  label: Text(f.name, style: TextStyle(fontFamily: fontsFor(f.id).heading, fontWeight: fontsFor(f.id).headingWeight)),
                  selected: d.font == f.id,
                  onSelected: locked ? null : (_) => _set(d.copyWith(font: f.id)),
                ),
              ),
          ]),
        ),
        if (widget.variants.isNotEmpty) ...[
          _section('Decor'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Wrap(spacing: 8, runSpacing: 8, children: [
              ChoiceChip(
                key: const Key('variant_default'),
                label: const Text('Default'),
                selected: widget.variants.every((v) => v.id != d.decorStyle),
                onSelected: locked ? null : (_) => _set(d.copyWith(decorStyle: () => null)),
              ),
              for (final v in widget.variants)
                ChoiceChip(
                  key: Key('variant_${v.id}'),
                  label: Text(v.name),
                  selected: d.decorStyle == v.id,
                  onSelected: locked ? null : (_) => _set(d.copyWith(decorStyle: () => v.id)),
                ),
            ]),
          ),
        ],
        _section('Photo'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            for (final s in CardDesign.photoShapes)
              ChoiceChip(
                key: Key('shape_$s'),
                label: Text(s[0].toUpperCase() + s.substring(1)),
                selected: (d.photoShape ?? 'circle') == s,
                onSelected: locked ? null : (_) => _set(d.copyWith(photoShape: s)),
              ),
          ]),
        ),
        SwitchListTile(
          key: const Key('photoRing'),
          title: const Text('Ring around the photo'),
          value: d.photoRing ?? false,
          onChanged: locked ? null : (v) => _set(d.copyWith(photoRing: v)),
        ),
        _section('Icons'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            for (final s in CardDesign.iconStyles)
              ChoiceChip(
                key: Key('icons_$s'),
                label: Text(s[0].toUpperCase() + s.substring(1)),
                selected: (d.iconStyle ?? 'filled') == s,
                onSelected: locked ? null : (_) => _set(d.copyWith(iconStyle: s)),
              ),
          ]),
        ),
        _section('Background image · ${((d.backgroundImageOpacity ?? 0) * 100).round()} %'),
        if (cover == null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text('Add a cover image in Photos to use it as the card background.',
                style: Theme.of(context).textTheme.bodySmall),
          ),
        Slider(
          key: const Key('bgOpacity'),
          value: (d.backgroundImageOpacity ?? 0).clamp(0.0, 0.8),
          max: 0.8,
          divisions: 16,
          onChanged: locked || cover == null ? null : (v) => _set(d.copyWith(backgroundImageOpacity: v)),
        ),
        _section('Corner radius · ${d.cornerRadius}'),
        Slider(
          value: d.cornerRadius.toDouble(),
          max: 32,
          divisions: 32,
          onChanged: locked ? null : (v) => _set(d.copyWith(cornerRadius: v.round())),
        ),
      ],
    );
  }
}
