/// Part 5 renderer maths — a port of the web renderer (`web/src/personal/lib/v2.ts` +
/// `components/CardV2.tsx`); keep both in sync:
///
/// * Units: landscape 1750×1000, portrait 1000×1586; the whole card is scaled uniformly.
/// * Card radius 50 units (landscape) / 44 (portrait).
/// * Text colour on a zone: `design.text` when its WCAG contrast against the zone's `on` colour is
///   ≥ 4.5, else white or #111111, whichever contrasts more. Muted = 72 % alpha. Accent (icons,
///   subtitles) = `design.accent` when ≥ 3:1 on the zone, else the text colour.
/// * Zone overflow: shrink ×0.92 per step while it doesn't fit (stop once ≤ 0.5), then clip.
/// * Block gaps: 14 units between contact rows, else min(40, zone height / 12).
library;

import 'dart:math' as math;

import 'package:flutter/painting.dart';
import 'package:path_parsing/path_parsing.dart';

import '../../data/models/personal.dart';
import '../digital_card/card_style.dart';


/// WCAG 2.x relative luminance (sRGB).
double relativeLuminance(Color c) {
  double ch(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

double contrastRatio(Color a, Color b) {
  final la = relativeLuminance(a), lb = relativeLuminance(b);
  final hi = math.max(la, lb), lo = math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const _white = Color(0xFFFFFFFF);
const _nearBlack = Color(0xFF111111);

/// Text colour for content sitting on [on] (see library doc).
Color textColorOn(Color on, Color designText) {
  if (contrastRatio(designText, on) >= 4.5) return designText;
  return contrastRatio(_white, on) >= contrastRatio(_nearBlack, on) ? _white : _nearBlack;
}

/// Resolved colour tokens of a design.
class CardPalette {
  CardPalette(CardDesign d)
    : primary = hexColor(d.primary),
      secondary = hexColor(d.secondary, const Color(0xFF1F2937)),
      background = hexColor(d.background, _white),
      text = hexColor(d.text, const Color(0xFF111827)),
      accent = hexColor(d.accent, const Color(0xFFB91C1C));

  final Color primary, secondary, background, text, accent;

  /// Token or `#hex` → colour; `image` (and unknown tokens) → null.
  Color? resolve(String token) => switch (token) {
    'primary' => primary,
    'secondary' => secondary,
    'background' => background,
    'text' => text,
    'accent' => accent,
    _ when token.startsWith('#') => hexColor(token, background),
    _ => null,
  };

  /// Colour under a zone (for text contrast); `image` counts as the secondary colour.
  Color on(String token) => token == 'image' ? secondary : (resolve(token) ?? background);
}

/// Absolute/relative SVG path data (M L H V C S Q T A Z) → [Path]. Invalid data → empty path.
Path parseSvgPath(String d) {
  final path = Path();
  try {
    writeSvgPathDataToPath(d, _PathProxy(path));
  } catch (_) {
    return Path();
  }
  return path;
}

class _PathProxy extends PathProxy {
  _PathProxy(this.p);
  final Path p;
  @override
  void close() => p.close();
  @override
  void cubicTo(double x1, double y1, double x2, double y2, double x3, double y3) => p.cubicTo(x1, y1, x2, y2, x3, y3);
  @override
  void lineTo(double x, double y) => p.lineTo(x, y);
  @override
  void moveTo(double x, double y) => p.moveTo(x, y);
}

/// Hexagon like the web clip-path: polygon(50% 0, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%).
Path hexagonPath(Rect r) {
  Offset p(double x, double y) => Offset(r.left + r.width * x, r.top + r.height * y);
  return Path()
    ..moveTo(p(0.5, 0).dx, p(0.5, 0).dy)
    ..lineTo(p(0.933, 0.25).dx, p(0.933, 0.25).dy)
    ..lineTo(p(0.933, 0.75).dx, p(0.933, 0.75).dy)
    ..lineTo(p(0.5, 1).dx, p(0.5, 1).dy)
    ..lineTo(p(0.067, 0.75).dx, p(0.067, 0.75).dy)
    ..lineTo(p(0.067, 0.25).dx, p(0.067, 0.25).dy)
    ..close();
}

/// Code 128 needs printable ASCII (32–126), ≤ 48 chars (§2).
String? barcodeValueError(String? v) {
  if (v == null || v.isEmpty) return null;
  if (v.length > 48) return 'At most 48 characters';
  if (v.codeUnits.any((c) => c < 32 || c > 126)) return 'Letters, digits and basic symbols only (no accents)';
  return null;
}
