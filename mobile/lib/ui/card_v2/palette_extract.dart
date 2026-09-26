import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';

import '../../data/models/design_presets.dart';
import '../digital_card/card_style.dart';
import 'card_math.dart';

/// Dominant colours of an RGBA buffer: 4-bit-per-channel buckets (transparent pixels skipped),
/// sampled every [step] pixels, similar buckets merged, most frequent first.
List<Color> dominantColors(Uint8List rgba, {int max = 6, int step = 3}) {
  final counts = <int, int>{};
  final sums = <int, List<int>>{};
  for (var i = 0; i + 3 < rgba.length; i += 4 * step) {
    if (rgba[i + 3] < 128) continue;
    final r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    final key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    counts[key] = (counts[key] ?? 0) + 1;
    final s = sums.putIfAbsent(key, () => [0, 0, 0]);
    s[0] += r;
    s[1] += g;
    s[2] += b;
  }
  final keys = counts.keys.toList()..sort((a, b) => counts[b]!.compareTo(counts[a]!));
  final out = <Color>[];
  for (final k in keys) {
    final n = counts[k]!, s = sums[k]!;
    final c = Color.fromARGB(255, s[0] ~/ n, s[1] ~/ n, s[2] ~/ n);
    if (out.any((o) => _dist(o, c) < 60)) continue;
    out.add(c);
    if (out.length >= max) break;
  }
  return out;
}

double _dist(Color a, Color b) {
  final dr = (a.r - b.r) * 255, dg = (a.g - b.g) * 255, db = (a.b - b.b) * 255;
  return math.sqrt(dr * dr + dg * dg + db * db);
}

double _saturation(Color c) => HSVColor.fromColor(c).saturation;

/// A card palette from dominant colours: the most vivid mid-tone as primary, the darkest as
/// secondary, another vivid one as accent, white background and dark text (readable).
CardPalettePreset? suggestPalette(List<Color> colors) {
  if (colors.isEmpty) return null;
  bool mid(Color c) {
    final l = relativeLuminance(c);
    return l > 0.02 && l < 0.6;
  }

  final vivid = colors.where(mid).toList()..sort((a, b) => _saturation(b).compareTo(_saturation(a)));
  final primary = vivid.isNotEmpty ? vivid.first : colors.first;
  final rest = colors.where((c) => c != primary).toList()
    ..sort((a, b) => relativeLuminance(a).compareTo(relativeLuminance(b)));
  final secondary = rest.isNotEmpty && relativeLuminance(rest.first) < 0.2
      ? rest.first
      : Color.lerp(primary, const Color(0xFF000000), 0.55)!;
  final accent = vivid.length > 1 ? vivid[1] : primary;
  return CardPalettePreset(
    id: 'extracted',
    name: 'From your image',
    primary: colorHex(primary),
    secondary: colorHex(secondary),
    background: '#FFFFFF',
    text: '#111827',
    accent: colorHex(accent),
  );
}

/// Decodes [provider] (downscaled) and returns its dominant colours; empty on failure.
Future<List<Color>> extractColors(ImageProvider provider, {Duration timeout = const Duration(seconds: 15)}) async {
  final completer = Completer<ui.Image>();
  final stream = ResizeImage(provider, width: 96, height: 96, policy: ResizeImagePolicy.fit)
      .resolve(ImageConfiguration.empty);
  late final ImageStreamListener listener;
  listener = ImageStreamListener(
    (info, _) {
      if (!completer.isCompleted) completer.complete(info.image.clone());
      stream.removeListener(listener);
    },
    onError: (e, _) {
      if (!completer.isCompleted) completer.completeError(e);
      stream.removeListener(listener);
    },
  );
  stream.addListener(listener);
  try {
    final image = await completer.future.timeout(timeout);
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    image.dispose();
    return data == null ? const [] : dominantColors(data.buffer.asUint8List(), step: 1);
  } catch (_) {
    return const [];
  }
}
