import 'package:flutter/material.dart';

import '../../data/models/personal.dart';

/// `#RRGGBB` / `#AARRGGBB` → Color (fallback on bad input).
Color hexColor(String? hex, [Color fallback = const Color(0xFFB91C1C)]) {
  if (hex == null) return fallback;
  var h = hex.trim().replaceFirst('#', '');
  if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
  if (h.length == 6) h = 'FF$h';
  final v = int.tryParse(h, radix: 16);
  return v == null || h.length != 8 ? fallback : Color(v);
}

String colorHex(Color c) {
  String two(double v) => (v * 255).round().clamp(0, 255).toRadixString(16).padLeft(2, '0');
  return '#${two(c.r)}${two(c.g)}${two(c.b)}'.toUpperCase();
}

/// Black or white, whichever reads better on [c].
Color onColor(Color c) => c.computeLuminance() > 0.45 ? const Color(0xFF141010) : Colors.white;

/// Resolved colours + typography of a card design.
class CardStyle {
  CardStyle(this.design)
    : primary = hexColor(design.primary),
      background = hexColor(design.background, Colors.white),
      text = hexColor(design.text, const Color(0xFF1F1414)),
      accent = hexColor(design.accent, const Color(0xFFF59E0B));

  final CardDesign design;
  final Color primary, background, text, accent;

  double get radius => design.cornerRadius.toDouble().clamp(0, 32);
  bool get isDisplay => design.font == 'display';

  String? get fontFamily => switch (design.font) {
    'serif' => 'serif',
    'mono' => 'monospace',
    _ => null,
  };

  /// Base colour the text sits on (for glass/gradient the text colour is used as given).
  Color get surface => design.backgroundStyle == 'solid' || design.backgroundStyle == 'pattern' ? background : primary;

  Color get muted => text.withValues(alpha: 0.72);
  Color get subtle => text.withValues(alpha: 0.12);

  TextStyle name(double size) => TextStyle(
    color: text,
    fontSize: size,
    fontFamily: fontFamily,
    fontWeight: isDisplay ? FontWeight.w900 : FontWeight.w700,
    letterSpacing: isDisplay ? -0.6 : -0.2,
    height: 1.1,
  );

  TextStyle body(double size, {Color? color, FontWeight? weight}) =>
      TextStyle(color: color ?? text, fontSize: size, fontFamily: fontFamily, fontWeight: weight, height: 1.3);

  BoxDecoration decoration() {
    final r = BorderRadius.circular(radius);
    return switch (design.backgroundStyle) {
      'gradient' => BoxDecoration(
        borderRadius: r,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [primary, background],
        ),
      ),
      'glass' => BoxDecoration(
        borderRadius: r,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color.lerp(primary, Colors.black, 0.15)!, background, Color.lerp(accent, background, 0.6)!],
        ),
      ),
      _ => BoxDecoration(borderRadius: r, color: background),
    };
  }
}

/// Subtle pattern overlay ("pattern" background style).
class CardPatternPainter extends CustomPainter {
  CardPatternPainter(this.color, this.pattern);
  final Color color;
  final String? pattern;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = color
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;
    switch (pattern) {
      case 'lines':
        for (double x = -size.height; x < size.width; x += 14) {
          canvas.drawLine(Offset(x, size.height), Offset(x + size.height, 0), p);
        }
      case 'grid':
        for (double x = 0; x < size.width; x += 18) {
          canvas.drawLine(Offset(x, 0), Offset(x, size.height), p);
        }
        for (double y = 0; y < size.height; y += 18) {
          canvas.drawLine(Offset(0, y), Offset(size.width, y), p);
        }
      case 'waves':
        for (double y = 10; y < size.height; y += 16) {
          final path = Path()..moveTo(0, y);
          for (double x = 0; x < size.width; x += 24) {
            path.quadraticBezierTo(x + 6, y - 5, x + 12, y);
            path.quadraticBezierTo(x + 18, y + 5, x + 24, y);
          }
          canvas.drawPath(path, p);
        }
      default: // dots
        p.style = PaintingStyle.fill;
        for (double y = 8; y < size.height; y += 16) {
          for (double x = 8; x < size.width; x += 16) {
            canvas.drawCircle(Offset(x, y), 1.4, p);
          }
        }
    }
  }

  @override
  bool shouldRepaint(covariant CardPatternPainter old) => old.color != color || old.pattern != pattern;
}

/// Colour presets for the editor.
const cardColorPresets = <String>[
  '#B91C1C', '#991B1B', '#DC2626', '#EA580C', '#D97706', '#CA8A04', '#15803D', '#0F766E',
  '#0369A1', '#1D4ED8', '#334155', '#111827', '#57534E', '#7C2D12', '#FFFFFF', '#FAFAF9',
  '#FFF7ED', '#FEF2F2', '#F5F5F4', '#1C1917', '#0C0A09',
];
