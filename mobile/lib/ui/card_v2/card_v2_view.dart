import 'dart:math' as math;

import 'package:barcode/barcode.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../data/models/personal.dart';
import 'card_math.dart';
import '../../data/models/template_v2.dart';

/// Part 5 v2 card renderer: SVG path layers clipped to the rounded card, zones with stacked
/// blocks, front/back with a 3D flip (tap), reduced-motion fallback and a thumbnail mode.
class CardV2View extends StatefulWidget {
  const CardV2View({
    super.key,
    required this.card,
    required this.template,
    this.side,
    this.onSideChanged,
    this.viewer = 'owner',
    this.thumbnail = false,
    this.today,
  });

  final DigitalCard card;
  final TemplateV2 template;

  /// Controlled side (`front` / `back`); null = the card flips itself on tap.
  final String? side;
  final ValueChanged<String>? onSideChanged;

  /// owner | contact | public | all (see [FieldVisibility.visibleTo]).
  final String viewer;

  /// Small, static, front only (galleries).
  final bool thumbnail;

  /// For the "expired" ribbon (tests pin it).
  final DateTime? today;

  @override
  State<CardV2View> createState() => _CardV2ViewState();
}

class _CardV2ViewState extends State<CardV2View> with SingleTickerProviderStateMixin {
  late final AnimationController _flip;
  late String _side = widget.side == 'back' ? 'back' : 'front';

  @override
  void initState() {
    super.initState();
    _flip = AnimationController(vsync: this, duration: const Duration(milliseconds: 700), value: widget.side == 'back' ? 1 : 0);
  }

  bool get _twoSided =>
      !widget.thumbnail && widget.template.hasBack && widget.card.sidesEnabled.contains('back');

  @override
  void didUpdateWidget(covariant CardV2View old) {
    super.didUpdateWidget(old);
    final want = widget.side;
    if (want != null && want != _side) _go(want);
    if (!_twoSided && _side == 'back') _go('front');
  }

  void _go(String side) {
    final target = side == 'back' && _twoSided ? 'back' : 'front';
    setState(() => _side = target);
    final reduce = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final v = target == 'back' ? 1.0 : 0.0;
    if (reduce) {
      _flip.value = v;
    } else {
      _flip.animateTo(v, curve: Curves.easeInOutCubic);
    }
  }

  void _toggle() {
    final next = _side == 'front' ? 'back' : 'front';
    if (widget.side == null) _go(next);
    widget.onSideChanged?.call(next);
  }

  @override
  void dispose() {
    _flip.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.template;
    Widget face(String side) => CardV2Side(
      card: widget.card,
      template: t,
      side: side,
      viewer: widget.viewer,
      today: widget.today,
    );
    final radius = (t.portrait ? 44 : 50) / t.unitWidth;
    Widget framed(Widget child) => LayoutBuilder(
      builder: (context, c) {
        final w = c.hasBoundedWidth ? c.maxWidth : 340.0;
        return Container(
          decoration: widget.thumbnail
              ? null
              : BoxDecoration(
                  borderRadius: BorderRadius.circular(radius * w),
                  boxShadow: [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.20), blurRadius: 22, offset: const Offset(0, 10)),
                  ],
                ),
          child: AspectRatio(
            aspectRatio: t.aspectRatio,
            child: FittedBox(fit: BoxFit.contain, child: child),
          ),
        );
      },
    );
    final name = widget.card.fields.fullName;
    if (!_twoSided) {
      // Static: the requested side (thumbnails / galleries can show a back), no flip.
      final side = widget.side == 'back' && t.hasBack ? 'back' : 'front';
      return Semantics(label: 'Digital card${name.isEmpty ? '' : ' of $name'}', child: framed(face(side)));
    }
    return Semantics(
      label: 'Digital card${name.isEmpty ? '' : ' of $name'}, ${_side == 'front' ? 'front' : 'back'} side',
      hint: 'Tap to flip',
      button: true,
      child: GestureDetector(
        key: const Key('cardFlip'),
        behavior: HitTestBehavior.opaque,
        onTap: _toggle,
        child: AnimatedBuilder(
          animation: _flip,
          builder: (context, _) {
            final angle = _flip.value * math.pi;
            final back = angle > math.pi / 2;
            return Transform(
              alignment: Alignment.center,
              transform: Matrix4.identity()
                ..setEntry(3, 2, 0.0012)
                ..rotateY(back ? angle - math.pi : angle),
              child: framed(face(back ? 'back' : 'front')),
            );
          },
        ),
      ),
    );
  }
}

/// Font sizes in template units — same table as the web `CardV2` (SIZES).
class V2Sizes {
  const V2Sizes(this.name, this.sub, this.company, this.dept, this.tagline, this.row, this.meta, this.bio);
  final double name, sub, company, dept, tagline, row, meta, bio;
  static const landscape = V2Sizes(86, 41, 52, 34, 38, 37, 35, 33);
  static const portrait = V2Sizes(82, 44, 50, 36, 40, 42, 42, 38);
}

/// Heading/body families of a font-pair id (`sans, display, geometric, elegant, serif, humanist,
/// condensed, mono`; v1 keys map to themselves). System families stand in for the web fonts.
({String? heading, String? body, FontWeight headingWeight}) fontsFor(String? font) => switch (font) {
  'display' => (heading: null, body: null, headingWeight: FontWeight.w900),
  'geometric' => (heading: null, body: null, headingWeight: FontWeight.w800),
  'elegant' => (heading: 'serif', body: null, headingWeight: FontWeight.w700),
  'serif' => (heading: 'serif', body: 'serif', headingWeight: FontWeight.w700),
  'humanist' => (heading: 'sans-serif-light', body: null, headingWeight: FontWeight.w700),
  'condensed' => (heading: 'sans-serif-condensed', body: null, headingWeight: FontWeight.w700),
  'mono' => (heading: 'monospace', body: null, headingWeight: FontWeight.w700),
  _ => (heading: null, body: null, headingWeight: FontWeight.w700),
};

/// One side at card-unit size (1750×1000 or 1000×1586); scale it with a [FittedBox].
class CardV2Side extends StatelessWidget {
  const CardV2Side({
    super.key,
    required this.card,
    required this.template,
    this.side = 'front',
    this.viewer = 'owner',
    this.today,
  });

  final DigitalCard card;
  final TemplateV2 template;
  final String side;
  final String viewer;
  final DateTime? today;

  @override
  Widget build(BuildContext context) {
    final t = template;
    final sc = t.side(side);
    final d = card.design;
    final pal = CardPalette(d);
    final arrangement = t.resolve(card.arrangement)[side] ?? const <String, List<String>>{};
    final cover = card.coverUrl;
    final fonts = fontsFor(d.font);
    final bgOpacity = d.backgroundImageOpacity ?? 0;
    final shownUntil = FieldVisibility.visibleTo(card.visibility['valid_until'], viewer);
    final expired = card.fields.isExpired(today ?? DateTime.now()) && shownUntil;

    final children = <Widget>[
      Positioned.fill(child: ColoredBox(color: pal.resolve(sc.background) ?? pal.background)),
    ];
    // Consecutive colour layers share one painter; image layers are clipped images (or, without a
    // cover image, the secondary colour with diagonal light stripes like the web pattern).
    var batch = <(Path, Paint)>[];
    void flush() {
      if (batch.isEmpty) return;
      final b = batch;
      children.add(Positioned.fill(child: CustomPaint(painter: _LayersPainter(b))));
      batch = [];
    }

    for (final l in t.layersFor(side, d.decorStyle)) {
      final path = _pathCache(l.path);
      if (l.fill == 'image') {
        if (cover == null) {
          batch.add((path, Paint()..shader = _stripes(pal.secondary)..color = Color.fromRGBO(0, 0, 0, 0.9)));
          continue;
        }
        flush();
        children.add(Positioned.fill(
          child: ClipPath(
            clipper: _PathClipper(path),
            child: Opacity(
              opacity: (bgOpacity > 0 ? bgOpacity : l.opacity).clamp(0.0, 1.0),
              child: _NetImage(cover, fit: BoxFit.cover),
            ),
          ),
        ));
      } else {
        final c = pal.resolve(l.fill);
        if (c != null) batch.add((path, Paint()..color = c.withValues(alpha: c.a * l.opacity)));
      }
    }
    flush();

    final sizes = t.portrait ? V2Sizes.portrait : V2Sizes.landscape;
    for (final zone in sc.zones) {
      final ids = (arrangement[zone.id] ?? const <String>[]).where(zone.accepts.contains).take(zone.maxBlocks).toList();
      if (ids.isEmpty) continue;
      final ctx = BlockContext(card: card, palette: pal, zone: zone, viewer: viewer, sizes: sizes, count: ids.length,
          headingFont: fonts.heading, headingWeight: fonts.headingWeight);
      const rowish = {'contacts', 'website', 'address'};
      final rendered = <Widget>[];
      String? prev;
      for (final id in ids) {
        final w = buildBlock(id, ctx);
        if (w == null) continue;
        final gap = prev == null ? 0.0 : (rowish.contains(prev) && rowish.contains(id) ? 14.0 : math.min(40.0, zone.h / 12));
        if (gap > 0) rendered.add(SizedBox(height: gap));
        rendered.add(id == 'badge_meta' || id == 'barcode' ? SizedBox(width: zone.w, child: w) : w);
        prev = id;
      }
      if (rendered.isEmpty) continue;
      children.add(Positioned(
        left: zone.x,
        top: zone.y,
        width: zone.w,
        height: zone.h,
        child: ZoneFit(
          align: zone.align,
          valign: zone.valign,
          child: Column(
            key: ValueKey('zone_${side}_${zone.id}'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: ctx.cross,
            children: rendered,
          ),
        ),
      ));
    }
    if (expired) children.add(_ExpiredRibbon(width: t.unitWidth, portrait: t.portrait));

    return SizedBox(
      width: t.unitWidth,
      height: t.unitHeight,
      child: DefaultTextStyle.merge(
        style: TextStyle(
          color: pal.text,
          fontFamily: fonts.body,
          decoration: TextDecoration.none,
          fontWeight: FontWeight.w400,
          height: 1.2,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(t.portrait ? 44 : 50),
          child: Stack(clipBehavior: Clip.hardEdge, children: children),
        ),
      ),
    );
  }
}

/// Web pattern: secondary colour with 14-unit white (6 %) stripes every 40 units, rotated 45°.
Shader _stripes(Color base) {
  final light = Color.alphaBlend(const Color(0x0FFFFFFF), base);
  return LinearGradient(
    begin: Alignment.topLeft,
    end: const Alignment(-0.9434, -0.9434),
    colors: [light, light, base, base],
    stops: const [0, 0.35, 0.35, 1],
    tileMode: TileMode.repeated,
  ).createShader(const Rect.fromLTWH(0, 0, 40 * 1.4142, 40 * 1.4142));
}

final _paths = <String, Path>{};
Path _pathCache(String d) {
  final p = _paths[d];
  if (p != null) return p;
  if (_paths.length > 400) _paths.clear();
  return _paths[d] = parseSvgPath(d);
}

class _LayersPainter extends CustomPainter {
  _LayersPainter(this.layers);
  final List<(Path, Paint)> layers;

  @override
  void paint(Canvas canvas, Size size) {
    for (final (path, paint) in layers) {
      canvas.drawPath(path, paint..isAntiAlias = true);
    }
  }

  @override
  bool shouldRepaint(covariant _LayersPainter old) {
    if (old.layers.length != layers.length) return true;
    for (var i = 0; i < layers.length; i++) {
      if (old.layers[i].$1 != layers[i].$1 || old.layers[i].$2.color != layers[i].$2.color) return true;
    }
    return false;
  }
}

class _PathClipper extends CustomClipper<Path> {
  _PathClipper(this.path);
  final Path path;
  @override
  Path getClip(Size size) => path;
  @override
  bool shouldReclip(covariant _PathClipper old) => old.path != path;
}

class _NetImage extends StatelessWidget {
  const _NetImage(this.url, {this.fit = BoxFit.cover, this.width, this.height});
  final String url;
  final BoxFit fit;
  final double? width, height;

  @override
  Widget build(BuildContext context) => Image.network(
    url,
    fit: fit,
    width: width,
    height: height,
    gaplessPlayback: true,
    errorBuilder: (_, _, _) => SizedBox(width: width, height: height),
  );
}

/// Web: top 80/110 units, right −150, width 560, rotated 38°, 40-unit bold white text on #DC2626.
class _ExpiredRibbon extends StatelessWidget {
  const _ExpiredRibbon({required this.width, required this.portrait});
  final double width;
  final bool portrait;

  @override
  Widget build(BuildContext context) => Positioned(
    top: portrait ? 110 : 80,
    left: width + 150 - 560,
    width: 560,
    child: Transform.rotate(
      angle: 38 * math.pi / 180,
      child: Container(
        key: const Key('expiredRibbon'),
        padding: const EdgeInsets.symmetric(vertical: 10),
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          color: Color(0xFFDC2626),
          boxShadow: [BoxShadow(color: Color(0x40000000), blurRadius: 6, offset: Offset(0, 2))],
        ),
        child: const Text(
          'EXPIRED',
          textScaler: TextScaler.noScaling,
          style: TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w700, letterSpacing: 12),
        ),
      ),
    ),
  );
}

// -------------------------------------------------------------------- zone fit --

/// Web `Zone`: content that doesn't fit is shrunk in steps of ×0.92 (stops once ≤ 0.5), then
/// clipped. Here the whole stack is scaled uniformly by that factor.
double zoneFitScale(double contentHeight, double zoneHeight) {
  var f = 1.0;
  for (var i = 0; i < 12 && contentHeight * f > zoneHeight + 1 && f > 0.5; i++) {
    f *= 0.92;
  }
  return f;
}

class ZoneFit extends SingleChildRenderObjectWidget {
  const ZoneFit({super.key, required this.align, required this.valign, super.child});
  final String align, valign;

  @override
  RenderObject createRenderObject(BuildContext context) => RenderZoneFit(align, valign);

  @override
  void updateRenderObject(BuildContext context, RenderZoneFit renderObject) {
    renderObject
      ..align = align
      ..valign = valign;
  }
}

class RenderZoneFit extends RenderBox with RenderObjectWithChildMixin<RenderBox> {
  RenderZoneFit(this._align, this._valign);

  String _align, _valign;
  set align(String v) {
    if (v == _align) return;
    _align = v;
    markNeedsLayout();
  }

  set valign(String v) {
    if (v == _valign) return;
    _valign = v;
    markNeedsLayout();
  }

  double scale = 1;
  Offset _origin = Offset.zero;

  double _frac(String a) => switch (a) {
    'center' => 0.5,
    'end' => 1.0,
    _ => 0.0,
  };

  @override
  void performLayout() {
    size = constraints.biggest;
    final c = child;
    if (c == null) return;
    c.layout(BoxConstraints(maxWidth: size.width), parentUsesSize: true);
    final h = c.size.height;
    scale = zoneFitScale(h, size.height);
    final w = c.size.width * scale;
    final sh = h * scale;
    _origin = Offset((size.width - w) * _frac(_align), math.max(0, size.height - sh) * _frac(_valign));
  }

  @override
  Size computeDryLayout(covariant BoxConstraints constraints) => constraints.biggest;

  Matrix4 get _transform => Matrix4.translationValues(_origin.dx, _origin.dy, 0)..scaleByDouble(scale, scale, 1, 1);

  @override
  void paint(PaintingContext context, Offset offset) {
    final c = child;
    if (c == null) return;
    context.pushClipRect(needsCompositing, offset, Offset.zero & size, (ctx, off) {
      ctx.pushTransform(needsCompositing, off, _transform, (ctx2, off2) => ctx2.paintChild(c, off2));
    });
  }

  @override
  void applyPaintTransform(covariant RenderObject child, Matrix4 transform) => transform.multiply(_transform);

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) {
    final c = child;
    if (c == null) return false;
    return result.addWithPaintTransform(
      transform: _transform,
      position: position,
      hitTest: (r, p) => c.hitTest(r, position: p),
    );
  }
}

// ---------------------------------------------------------------------- blocks --

class BlockContext {
  BlockContext({
    required this.card,
    required this.palette,
    required this.zone,
    required this.viewer,
    this.sizes = V2Sizes.landscape,
    this.count = 1,
    this.headingFont,
    this.headingWeight = FontWeight.w700,
  }) : on = palette.on(zone.on) {
    text = textColorOn(on, palette.text);
    muted = text.withValues(alpha: 0.72);
    accent = contrastRatio(palette.accent, on) >= 3 ? palette.accent : text;
  }

  final DigitalCard card;
  final CardPalette palette;
  final CardZone zone;
  final String viewer;
  final V2Sizes sizes;

  /// Blocks in the zone (a single block gets more room: photo 92 %, QR 86 %, logo 62 %).
  final int count;
  final String? headingFont;
  final FontWeight headingWeight;
  final Color on;
  late final Color text, muted, accent;

  bool get single => count == 1;
  CardFields get f => card.fields;
  CardDesign get d => card.design;
  bool visible(String field) => FieldVisibility.visibleTo(card.visibility[field], viewer);
  String? v(String field, String? value) => value != null && value.trim().isNotEmpty && visible(field) ? value : null;

  TextAlign get textAlign => switch (zone.align) {
    'center' => TextAlign.center,
    'end' => TextAlign.end,
    _ => TextAlign.start,
  };

  CrossAxisAlignment get cross => switch (zone.align) {
    'center' => CrossAxisAlignment.center,
    'end' => CrossAxisAlignment.end,
    _ => CrossAxisAlignment.start,
  };

  /// Kept for callers: accent for icons (accent when it reads on the zone, else the text colour).
  Color get iconAccent => accent;
}

Widget? buildBlock(String id, BlockContext c) => switch (id) {
  'photo' => _photo(c),
  'name' => _name(c),
  'company' => _company(c),
  'logo' => _logo(c),
  'tagline' => _para(c, c.v('headline', c.f.headline), c.sizes.tagline, 2, letterSpacing: 0.04),
  'contacts' => _contacts(c),
  'website' => _website(c),
  'address' => _row(c, Icons.place_outlined, c.v('address', c.f.address)),
  'socials' => _socials(c),
  'bio' => _para(c, c.v('bio', c.f.bio), c.sizes.bio, 3, height: 1.35),
  'qr' => _qr(c),
  'barcode' => _barcode(c),
  'badge_meta' => _badgeMeta(c),
  _ => null,
};

Text _line(String text, TextStyle style, BlockContext c, {int lines = 1}) => Text(
  text,
  maxLines: lines,
  softWrap: lines > 1,
  overflow: TextOverflow.ellipsis,
  textAlign: c.textAlign,
  textScaler: TextScaler.noScaling,
  style: style,
);

Widget? _para(BlockContext c, String? text, double size, int lines, {double? letterSpacing, double height = 1.3}) {
  if (text == null) return null;
  return _line(text, TextStyle(color: c.muted, fontSize: size, height: height,
      letterSpacing: letterSpacing == null ? null : letterSpacing * size), c, lines: lines);
}

String _initials(String n) {
  final p = n.trim().split(RegExp(r'\s+')).where((x) => x.isNotEmpty).toList();
  final s = ((p.isNotEmpty ? p.first[0] : '') + (p.length > 1 ? p.last[0] : '')).toUpperCase();
  return s.isEmpty ? '•' : s;
}

Widget? _name(BlockContext c) {
  final full = c.f.fullName;
  final sub = c.v('job_title', c.f.jobTitle) ?? (c.f.jobTitle == null ? c.v('headline', c.f.headline) : null);
  final long = full.length > 18;
  return Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: c.cross,
    children: [
      _line(full.isEmpty ? 'Your name' : full, TextStyle(
        color: c.text,
        fontSize: c.sizes.name * (long ? 0.86 : 1),
        fontWeight: c.headingWeight,
        fontFamily: c.headingFont,
        letterSpacing: -0.025 * c.sizes.name,
        height: 1.08,
      ), c),
      if (sub != null) ...[
        const SizedBox(height: 8),
        _line(sub, TextStyle(color: c.accent, fontSize: c.sizes.sub, fontWeight: FontWeight.w500,
            letterSpacing: 0.02 * c.sizes.sub), c),
      ],
    ],
  );
}

Widget? _company(BlockContext c) {
  final company = c.v('company', c.f.company) ?? (c.visible('company') ? c.card.businessLink?.businessName : null);
  final dept = c.v('department', c.f.department);
  if (company == null && dept == null) return null;
  return Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: c.cross,
    children: [
      if (company != null && company.isNotEmpty)
        _line(company.toUpperCase(), TextStyle(color: c.text, fontSize: c.sizes.company, fontWeight: FontWeight.w700,
            fontFamily: c.headingFont, letterSpacing: 0.025 * c.sizes.company, height: 1.1), c),
      if (dept != null) ...[
        const SizedBox(height: 6),
        _line(dept, TextStyle(color: c.muted, fontSize: c.sizes.dept), c),
      ],
    ],
  );
}

Widget? _logo(BlockContext c) {
  final h = math.min(c.zone.h * (c.single ? 0.62 : 0.45), c.single ? 240.0 : 150.0);
  final src = c.card.logoUrl;
  if (src != null) {
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: c.zone.w, maxHeight: h),
      child: _NetImage(src, fit: BoxFit.contain, height: h),
    );
  }
  final name = c.v('company', c.f.company) ?? c.card.businessLink?.businessName ?? c.f.fullName;
  if (name.isEmpty) return null;
  final tint = contrastRatio(c.palette.primary, c.on) >= 2 ? c.palette.primary : c.text;
  final ini = _initials(name);
  return Container(
    key: const Key('logoInitials'),
    width: h,
    height: h,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(h * 0.24)),
    child: Text(ini.length > 2 ? ini.substring(0, 2) : ini, textScaler: TextScaler.noScaling,
        style: TextStyle(color: textColorOn(tint, c.palette.text), fontSize: h * 0.46, fontWeight: FontWeight.w700,
            fontFamily: c.headingFont)),
  );
}

Widget? _icon(BlockContext c, IconData icon) {
  final style = c.d.iconStyle ?? 'filled';
  if (style == 'none') return null;
  final size = c.sizes.row * 1.45;
  final filled = style == 'filled';
  return Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: filled ? c.accent : null,
      border: filled ? null : Border.all(color: c.accent, width: 3),
    ),
    child: Icon(icon, size: c.sizes.row * 0.8, color: filled ? textColorOn(c.accent, c.palette.text) : c.accent),
  );
}

Widget? _row(BlockContext c, IconData icon, String? text) {
  if (text == null) return null;
  final i = _icon(c, icon);
  final label = Flexible(child: _line(text, TextStyle(color: c.text, fontSize: c.sizes.row, height: 1.25), c));
  final gap = SizedBox(width: c.sizes.row * 0.5);
  final end = c.zone.align == 'end';
  return Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      if (i != null && !end) ...[i, gap],
      label,
      if (i != null && end) ...[gap, i],
    ],
  );
}

Widget? _column(BlockContext c, List<Widget> rows) => rows.isEmpty
    ? null
    : Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: c.cross,
        children: [for (var i = 0; i < rows.length; i++) ...[if (i > 0) const SizedBox(height: 12), rows[i]]],
      );

Widget? _contacts(BlockContext c) {
  final rows = <Widget>[
    if (c.visible('phones'))
      for (final p in c.f.phones.where((p) => p.value.trim().isNotEmpty).take(2)) ?_row(c, Icons.call_outlined, p.value),
    if (c.visible('emails'))
      for (final e in c.f.emails.where((e) => e.value.trim().isNotEmpty).take(2)) ?_row(c, Icons.mail_outline, e.value),
  ];
  return _column(c, rows);
}

String _bareUrl(String u) => u.replaceFirst(RegExp(r'^https?://(www\.)?'), '').replaceFirst(RegExp(r'/$'), '');

Widget? _website(BlockContext c) {
  if (!c.visible('websites')) return null;
  final w = c.f.websites.where((w) => w.value.trim().isNotEmpty).firstOrNull;
  return w == null ? null : _row(c, Icons.language, _bareUrl(w.value));
}

Widget? _socials(BlockContext c) {
  if (!c.visible('socials')) return null;
  final list = c.f.socials.where((s) => s.value.trim().isNotEmpty).take(5).toList();
  if (list.isEmpty) return null;
  final size = c.sizes.row * 1.5;
  final filled = (c.d.iconStyle ?? 'filled') == 'filled';
  return Wrap(
    spacing: 10,
    runSpacing: 10,
    alignment: switch (c.zone.align) {
      'center' => WrapAlignment.center,
      'end' => WrapAlignment.end,
      _ => WrapAlignment.start,
    },
    children: [
      for (final s in list)
        Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: filled ? c.accent : null,
            border: filled ? null : Border.all(color: c.accent, width: 3),
          ),
          child: Text(
            s.label == 'x' ? 'X' : (s.label.length > 2 ? s.label.substring(0, 2) : s.label).toUpperCase(),
            textScaler: TextScaler.noScaling,
            style: TextStyle(color: filled ? textColorOn(c.accent, c.palette.text) : c.accent, fontSize: size * 0.42,
                fontWeight: FontWeight.w600),
          ),
        ),
    ],
  );
}

Widget? _qr(BlockContext c) {
  final url = c.card.publicUrl;
  if (url == null || url.isEmpty) return null;
  final size = math.min(c.zone.w, c.zone.h) * (c.single ? 0.86 : 0.55);
  return Container(
    width: size,
    height: size,
    padding: EdgeInsets.all(size * 0.05),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(size * 0.08)),
    child: QrImageView(
      data: url,
      padding: EdgeInsets.zero,
      backgroundColor: Colors.white,
      eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Color(0xFF111111)),
      dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Color(0xFF111111)),
    ),
  );
}

Widget? _barcode(BlockContext c) {
  final value = c.v('barcode_value', c.f.barcodeValue);
  if (value == null || barcodeValueError(value) != null) return null;
  final light = contrastRatio(Colors.white, c.on) < 1.6;
  final width = c.zone.w * (c.single ? 0.92 : 0.70);
  return Align(
    alignment: switch (c.zone.align) {
      'center' => Alignment.center,
      'end' => Alignment.centerRight,
      _ => Alignment.centerLeft,
    },
    child: Container(
      key: const Key('barcode'),
      width: width,
      padding: light ? EdgeInsets.zero : const EdgeInsets.all(14),
      decoration: light ? null : BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(height: math.min(c.zone.h * 0.62, 110), width: double.infinity, child: CustomPaint(painter: Code128Painter(value))),
          const SizedBox(height: 6),
          Text(value, textScaler: TextScaler.noScaling,
              style: const TextStyle(color: Color(0xFF333333), fontSize: 26, fontFamily: 'monospace', letterSpacing: 5.2)),
        ],
      ),
    ),
  );
}

/// Code 128 bars (package:barcode picks the code set).
class Code128Painter extends CustomPainter {
  Code128Painter(this.value);
  final String value;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = const Color(0xFF111111);
    try {
      for (final e in Barcode.code128().make(value, width: size.width, height: size.height)) {
        if (e is BarcodeBar && e.black) canvas.drawRect(Rect.fromLTWH(e.left, e.top, e.width, e.height), paint);
      }
    } catch (_) {
      // invalid data → nothing (validated before)
    }
  }

  @override
  bool shouldRepaint(covariant Code128Painter old) => old.value != value;
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Jun 30, 2027" (the web shows the viewer's locale date; en-US style here).
String formatCardDate(String iso) {
  final d = DateTime.tryParse(iso.length >= 10 ? iso.substring(0, 10) : iso);
  return d == null ? iso : '${_months[d.month - 1]} ${d.day}, ${d.year}';
}

Widget? _badgeMeta(BlockContext c) {
  final rows = <(String, String)>[
    if (c.v('id_number', c.f.idNumber) case final v?) ('ID NO', v),
    if (c.v('department', c.f.department) case final v?) ('DEPT', v),
    if (c.v('valid_from', c.f.validFrom) case final v?) ('ISSUED', formatCardDate(v)),
    if (c.v('valid_until', c.f.validUntil) case final v?) ('VALID UNTIL', formatCardDate(v)),
  ];
  if (rows.isEmpty) return null;
  final m = c.sizes.meta;
  return Table(
    key: const Key('badgeMeta'),
    columnWidths: const {0: IntrinsicColumnWidth(), 1: FlexColumnWidth()},
    defaultVerticalAlignment: TableCellVerticalAlignment.middle,
    children: [
      for (var i = 0; i < rows.length; i++)
        TableRow(children: [
          Padding(
            padding: EdgeInsets.only(right: 28, top: i == 0 ? 0 : 10),
            child: Text(rows[i].$1, textScaler: TextScaler.noScaling,
                style: TextStyle(color: c.muted, fontSize: m * 0.84, fontWeight: FontWeight.w600, letterSpacing: 0.025 * m)),
          ),
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : 10),
            child: Text(rows[i].$2, maxLines: 1, overflow: TextOverflow.ellipsis, textScaler: TextScaler.noScaling,
                style: TextStyle(color: c.text, fontSize: m, fontWeight: FontWeight.w500)),
          ),
        ]),
    ],
  );
}

Widget? _photo(BlockContext c) {
  if (!c.visible('photo')) return null;
  final url = c.card.photoUrl;
  final size = math.min(c.zone.w, c.zone.h) * (c.single ? 0.92 : 0.5);
  final shape = c.d.photoShape ?? 'circle';
  final ringW = (c.d.photoRing ?? false) ? size * 0.045 : 0.0;
  final phBg = contrastRatio(c.palette.primary, c.on) >= 1.5 ? c.palette.primary : c.palette.secondary;
  final inner = size - 2 * ringW;
  final content = url == null
      ? Container(
          color: phBg,
          alignment: Alignment.center,
          child: Text(_initials(c.f.fullName), textScaler: TextScaler.noScaling,
              style: TextStyle(color: textColorOn(phBg, c.palette.text), fontSize: size * 0.34, fontWeight: FontWeight.w600,
                  fontFamily: c.headingFont)),
        )
      : ColoredBox(color: phBg, child: _NetImage(url, fit: BoxFit.cover, width: inner, height: inner));
  Widget clip(double s, Widget child) => SizedBox(
    width: s,
    height: s,
    child: switch (shape) {
      'hexagon' => ClipPath(clipper: _HexClipper(), child: child),
      'square' => ClipRRect(borderRadius: BorderRadius.circular(s * 0.04), child: child),
      'rounded' => ClipRRect(borderRadius: BorderRadius.circular(s * 0.18), child: child),
      _ => ClipOval(child: child),
    },
  );
  if (ringW == 0) return SizedBox(key: const Key('blockPhoto'), width: size, height: size, child: clip(size, content));
  // Accent ring (padding) with a thin gap in the zone colour, like the web box-shadow.
  final gap = ringW * 0.35;
  return SizedBox(
    key: const Key('blockPhoto'),
    width: size,
    height: size,
    child: clip(size, ColoredBox(
      color: c.palette.accent,
      child: Center(child: clip(inner, ColoredBox(color: c.on, child: Center(child: clip(inner - 2 * gap, content))))),
    )),
  );
}

class _HexClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) => hexagonPath(Offset.zero & size);
  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}
