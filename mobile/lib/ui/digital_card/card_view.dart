import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../data/models/personal.dart';
import '../widgets/business_result.dart';
import 'card_style.dart';

/// Renders a digital card with its template layout and design (Part 4 §2) — the same
/// six layouts as the web: centered, left, split, hero_photo, banner, compact.
class DigitalCardView extends StatelessWidget {
  const DigitalCardView({
    super.key,
    required this.card,
    required this.layout,
    this.showFields = true,
    this.interactive = true,
    this.hideHiddenFields = true,
  });

  final DigitalCard card;

  /// Template layout (see [CardTemplate.layouts]).
  final String layout;
  final bool showFields;
  final bool interactive;

  /// Owner preview: fields marked `hidden` are not rendered.
  final bool hideHiddenFields;

  @override
  Widget build(BuildContext context) {
    final style = CardStyle(card.design);
    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.hasBoundedWidth ? constraints.maxWidth : 360.0;
        final s = (w / 360).clamp(0.78, 1.35);
        final data = _CardData(card, style, s, interactive, hideHiddenFields, showFields);
        final Widget body = switch (layout) {
          'left' => _LeftLayout(data),
          'split' => _SplitLayout(data, wide: w >= 520, width: w),
          'hero_photo' => _HeroLayout(data),
          'banner' => _BannerLayout(data),
          'compact' => _CompactLayout(data, width: w),
          _ => _CenteredLayout(data),
        };
        return Semantics(
          label: 'Digital card of ${card.fields.fullName}',
          child: Container(
            key: ValueKey('card_$layout'),
            clipBehavior: Clip.antiAlias,
            decoration: style.decoration().copyWith(
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.18), blurRadius: 18, offset: const Offset(0, 8)),
              ],
            ),
            child: Stack(
              children: [
                if (card.design.backgroundStyle == 'pattern')
                  Positioned.fill(
                    child: CustomPaint(painter: CardPatternPainter(style.primary.withValues(alpha: 0.10), card.design.pattern)),
                  ),
                if (card.design.backgroundStyle == 'glass')
                  Positioned(
                    right: -40 * s,
                    top: -40 * s,
                    child: Container(
                      width: 160 * s,
                      height: 160 * s,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: style.accent.withValues(alpha: 0.25)),
                    ),
                  ),
                body,
              ],
            ),
          ),
        );
      },
    );
  }
}

class _CardData {
  _CardData(this.card, this.style, this.s, this.interactive, this.hideHidden, this.showFields);
  final DigitalCard card;
  final CardStyle style;
  final double s;
  final bool interactive, hideHidden, showFields;

  CardFields get f => card.fields;
  bool visible(String field) => !hideHidden || card.visibility[field] != 'hidden';
  String? get photo => visible('photo') ? card.photoUrl : null;
  String? get headline => visible('headline') ? f.headline : null;
  String get role => [
    if (visible('job_title')) ?f.jobTitle,
    if (visible('company')) ?f.company,
  ].join(' · ');
  bool get glass => card.design.backgroundStyle == 'glass';
}

// ------------------------------------------------------------------ pieces --

class _Avatar extends StatelessWidget {
  const _Avatar(this.d, this.size, {this.ring});
  final _CardData d;
  final double size;
  final Color? ring;

  @override
  Widget build(BuildContext context) {
    final bg = d.style.primary;
    final url = d.photo;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: bg,
        border: ring == null ? null : Border.all(color: ring!, width: size * 0.05),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.15), blurRadius: 8)],
      ),
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      child: url == null
          ? Text(d.f.initials, style: TextStyle(color: onColor(bg), fontSize: size * 0.36, fontWeight: FontWeight.w700))
          : Image.network(url, width: size, height: size, fit: BoxFit.cover,
              errorBuilder: (_, _, _) => Text(d.f.initials,
                  style: TextStyle(color: onColor(bg), fontSize: size * 0.36, fontWeight: FontWeight.w700))),
    );
  }
}

class _NameBlock extends StatelessWidget {
  const _NameBlock(this.d, {this.align = CrossAxisAlignment.start, this.color, this.nameSize = 24});
  final _CardData d;
  final CrossAxisAlignment align;
  final Color? color;
  final double nameSize;

  @override
  Widget build(BuildContext context) {
    final st = d.style;
    final ta = align == CrossAxisAlignment.center ? TextAlign.center : TextAlign.start;
    final c = color ?? st.text;
    return Column(
      crossAxisAlignment: align,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          d.f.fullName.isEmpty ? 'Your name' : d.f.fullName,
          textAlign: ta,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: st.name(nameSize * d.s).copyWith(color: c),
        ),
        if (d.visible('pronouns') && d.f.pronouns != null)
          Text(d.f.pronouns!, textAlign: ta, style: st.body(12 * d.s, color: c.withValues(alpha: 0.7))),
        if (d.headline != null) ...[
          SizedBox(height: 4 * d.s),
          Text(d.headline!, textAlign: ta, maxLines: 2, overflow: TextOverflow.ellipsis,
              style: st.body(14.5 * d.s, color: c.withValues(alpha: 0.9), weight: FontWeight.w500)),
        ],
        if (d.role.isNotEmpty) ...[
          SizedBox(height: 2 * d.s),
          Text(d.role, textAlign: ta, maxLines: 2, overflow: TextOverflow.ellipsis,
              style: st.body(13 * d.s, color: c.withValues(alpha: 0.72))),
        ],
        if (d.card.businessLink != null) ...[
          SizedBox(height: 6 * d.s),
          _Chip(Icons.apartment, d.card.businessLink!.businessName, c),
        ],
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.icon, this.text, this.color);
  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, size: 12, color: color),
      const SizedBox(width: 4),
      Flexible(child: Text(text, overflow: TextOverflow.ellipsis, style: TextStyle(color: color, fontSize: 11.5))),
    ]),
  );
}

/// Call / email / website quick actions.
class _Actions extends StatelessWidget {
  const _Actions(this.d, {this.center = false, this.onPanel});
  final _CardData d;
  final bool center;
  final Color? onPanel;

  @override
  Widget build(BuildContext context) {
    final items = <(IconData, String, String)>[
      if (d.visible('phones') && d.f.phones.isNotEmpty) (Icons.call, 'Call', 'tel:${d.f.phones.first.value}'),
      if (d.visible('emails') && d.f.emails.isNotEmpty) (Icons.mail_outline, 'Email', 'mailto:${d.f.emails.first.value}'),
      if (d.visible('websites') && d.f.websites.isNotEmpty) (Icons.language, 'Web', _url(d.f.websites.first.value)),
      if (d.card.publicUrl != null) (Icons.ios_share, 'Page', d.card.publicUrl!),
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    final bg = d.style.primary;
    return Wrap(
      alignment: center ? WrapAlignment.center : WrapAlignment.start,
      spacing: 10 * d.s,
      runSpacing: 8,
      children: [
        for (final (icon, label, url) in items)
          Tooltip(
            message: label,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: d.interactive ? () => openActionUrl(url) : null,
              child: Container(
                width: 42 * d.s,
                height: 42 * d.s,
                decoration: BoxDecoration(shape: BoxShape.circle, color: onPanel ?? bg),
                child: Icon(icon, size: 20 * d.s, color: onColor(onPanel ?? bg)),
              ),
            ),
          ),
      ],
    );
  }
}

String _url(String v) => v.startsWith('http') ? v : 'https://$v';

/// The detailed field rows.
class _Fields extends StatelessWidget {
  const _Fields(this.d);
  final _CardData d;

  @override
  Widget build(BuildContext context) {
    if (!d.showFields) return const SizedBox.shrink();
    final c = d.style.text;
    final rows = <Widget>[];
    void row(IconData icon, String label, String value, [String? url]) => rows.add(
      InkWell(
        onTap: d.interactive && url != null ? () => openActionUrl(url) : null,
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 6 * d.s),
          child: Row(
            children: [
              Container(
                width: 32 * d.s,
                height: 32 * d.s,
                decoration: BoxDecoration(color: d.style.primary.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(9)),
                child: Icon(icon, size: 17 * d.s, color: d.style.primary.computeLuminance() < 0.05 && c.computeLuminance() > 0.5 ? c : d.style.primary),
              ),
              SizedBox(width: 12 * d.s),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(value, maxLines: 2, overflow: TextOverflow.ellipsis,
                        style: d.style.body(14 * d.s, color: c, weight: FontWeight.w500)),
                    if (label.isNotEmpty)
                      Text(label, style: d.style.body(11.5 * d.s, color: c.withValues(alpha: 0.6))),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (d.visible('bio') && d.f.bio != null) {
      rows.add(Padding(
        padding: EdgeInsets.only(bottom: 6 * d.s),
        child: Text(d.f.bio!, style: d.style.body(13.5 * d.s, color: c.withValues(alpha: 0.85))),
      ));
    }
    if (d.visible('phones')) {
      for (final p in d.f.phones) {
        row(Icons.call_outlined, p.label, p.value, 'tel:${p.value}');
      }
    }
    if (d.visible('emails')) {
      for (final e in d.f.emails) {
        row(Icons.mail_outline, e.label, e.value, 'mailto:${e.value}');
      }
    }
    if (d.visible('websites')) {
      for (final w in d.f.websites) {
        row(Icons.language, w.label, w.value.replaceFirst(RegExp(r'^https?://'), ''), _url(w.value));
      }
    }
    if (d.visible('address') && d.f.address != null) row(Icons.place_outlined, 'Address', d.f.address!);
    if (d.visible('socials')) {
      for (final so in d.f.socials) {
        row(_socialIcon(so.label), so.label, so.value.replaceFirst(RegExp(r'^https?://(www\.)?'), ''), _url(so.value));
      }
    }
    if (d.visible('custom_links')) {
      for (final l in d.f.customLinks) {
        row(Icons.link, '', l.label.isEmpty ? l.value : l.label, _url(l.value));
      }
    }
    if (d.visible('department') && d.f.department != null) row(Icons.groups_outlined, 'Department', d.f.department!);
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
  }
}

IconData _socialIcon(String platform) => switch (platform.toLowerCase()) {
  'linkedin' => Icons.work_outline,
  'x' || 'twitter' => Icons.alternate_email,
  'instagram' => Icons.camera_alt_outlined,
  'facebook' => Icons.thumb_up_alt_outlined,
  'github' => Icons.code,
  'youtube' => Icons.play_circle_outline,
  'tiktok' => Icons.music_note_outlined,
  'whatsapp' => Icons.chat_outlined,
  _ => Icons.public,
};

class _Qr extends StatelessWidget {
  const _Qr(this.d, this.size);
  final _CardData d;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = d.card.publicUrl;
    if (url == null) return SizedBox(width: size, height: size);
    return Container(
      padding: EdgeInsets.all(size * 0.06),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
      child: QrImageView(data: url, size: size * 0.88, padding: EdgeInsets.zero,
          eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Color(0xFF111111)),
          dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Color(0xFF111111))),
    );
  }
}

class _Logo extends StatelessWidget {
  const _Logo(this.d, this.height);
  final _CardData d;
  final double height;

  @override
  Widget build(BuildContext context) {
    final url = d.card.logoUrl;
    if (url == null) return const SizedBox.shrink();
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: height, maxWidth: height * 3),
      child: Image.network(url, fit: BoxFit.contain, errorBuilder: (_, _, _) => const SizedBox.shrink()),
    );
  }
}

Widget _cover(_CardData d, double height, {bool overlay = false}) {
  final url = d.card.coverUrl ?? (overlay ? d.card.photoUrl : null);
  final st = d.style;
  final placeholder = Container(
    decoration: BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [st.primary, Color.lerp(st.primary, st.accent, 0.55)!],
      ),
    ),
  );
  return SizedBox(
    height: height,
    width: double.infinity,
    child: Stack(
      fit: StackFit.expand,
      children: [
        if (url == null) placeholder
        else Image.network(url, fit: BoxFit.cover, errorBuilder: (_, _, _) => placeholder),
        if (overlay)
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Colors.transparent, Color(0xCC000000)],
                stops: [0.35, 1],
              ),
            ),
          ),
      ],
    ),
  );
}

Widget _glassPanel(_CardData d, Widget child) => d.glass
    ? Container(
        margin: EdgeInsets.all(12 * d.s),
        padding: EdgeInsets.all(14 * d.s),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular((d.style.radius - 6).clamp(4, 28)),
          border: Border.all(color: Colors.white.withValues(alpha: 0.22)),
        ),
        child: child,
      )
    : child;

// ----------------------------------------------------------------- layouts --

class _CenteredLayout extends StatelessWidget {
  const _CenteredLayout(this.d);
  final _CardData d;

  @override
  Widget build(BuildContext context) {
    final pad = 20 * d.s;
    return _glassPanel(
      d,
      Padding(
        padding: EdgeInsets.all(d.glass ? 4 : pad),
        child: Column(
          children: [
            _Avatar(d, 92 * d.s, ring: d.style.background.withValues(alpha: 0.9)),
            SizedBox(height: 14 * d.s),
            _NameBlock(d, align: CrossAxisAlignment.center, nameSize: 25),
            SizedBox(height: 14 * d.s),
            _Actions(d, center: true),
            if (d.showFields) ...[
              SizedBox(height: 10 * d.s),
              Divider(color: d.style.subtle),
              _Fields(d),
            ],
            if (d.card.design.showQr) ...[SizedBox(height: 10 * d.s), _Qr(d, 96 * d.s)],
          ],
        ),
      ),
    );
  }
}

class _LeftLayout extends StatelessWidget {
  const _LeftLayout(this.d);
  final _CardData d;

  @override
  Widget build(BuildContext context) {
    return _glassPanel(
      d,
      Padding(
        padding: EdgeInsets.all(d.glass ? 4 : 20 * d.s),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                _Avatar(d, 68 * d.s),
                SizedBox(width: 14 * d.s),
                Expanded(child: _NameBlock(d, nameSize: 22)),
                if (d.card.logoUrl != null) ...[SizedBox(width: 8 * d.s), _Logo(d, 32 * d.s)],
              ],
            ),
            SizedBox(height: 14 * d.s),
            Container(height: 3, width: 44 * d.s, alignment: Alignment.centerLeft, color: d.style.primary),
            SizedBox(height: 12 * d.s),
            _Actions(d),
            if (d.showFields) ...[SizedBox(height: 8 * d.s), _Fields(d)],
            if (d.card.design.showQr) Align(alignment: Alignment.centerRight, child: _Qr(d, 84 * d.s)),
          ],
        ),
      ),
    );
  }
}

class _SplitLayout extends StatelessWidget {
  const _SplitLayout(this.d, {required this.wide, required this.width});
  final _CardData d;
  final bool wide;
  final double width;

  @override
  Widget build(BuildContext context) {
    final panelColor = d.style.primary;
    final onPanel = onColor(panelColor);
    final panel = Container(
      color: wide ? null : panelColor,
      padding: EdgeInsets.all(20 * d.s),
      child: Column(
        crossAxisAlignment: wide ? CrossAxisAlignment.start : CrossAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          _Avatar(d, 84 * d.s, ring: onPanel.withValues(alpha: 0.7)),
          SizedBox(height: 12 * d.s),
          _NameBlock(d, color: onPanel, nameSize: 23,
              align: wide ? CrossAxisAlignment.start : CrossAxisAlignment.center),
          SizedBox(height: 12 * d.s),
          _Actions(d, center: !wide, onPanel: onPanel),
        ],
      ),
    );
    final fields = Padding(
      padding: EdgeInsets.all(18 * d.s),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Fields(d),
          if (d.card.logoUrl != null) Align(alignment: Alignment.centerRight, child: _Logo(d, 28 * d.s)),
          if (d.card.design.showQr) Align(alignment: Alignment.centerRight, child: _Qr(d, 84 * d.s)),
        ],
      ),
    );
    if (wide) {
      // Coloured left panel spanning the full height (no IntrinsicHeight: the QR uses a LayoutBuilder).
      final panelWidth = width * 0.4;
      return Stack(
        children: [
          Positioned(left: 0, top: 0, bottom: 0, width: panelWidth, child: ColoredBox(color: panelColor)),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [SizedBox(width: panelWidth, child: panel), Expanded(child: fields)],
          ),
        ],
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [panel, if (d.showFields) fields]);
  }
}

class _HeroLayout extends StatelessWidget {
  const _HeroLayout(this.d);
  final _CardData d;

  @override
  Widget build(BuildContext context) {
    final h = 230 * d.s;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: h,
          child: Stack(
            fit: StackFit.expand,
            children: [
              _cover(d, h, overlay: true),
              Positioned(
                left: 20 * d.s,
                right: 20 * d.s,
                bottom: 16 * d.s,
                child: _NameBlock(d, color: Colors.white, nameSize: 27),
              ),
              if (d.card.logoUrl != null)
                Positioned(top: 14 * d.s, right: 14 * d.s, child: _Logo(d, 28 * d.s)),
            ],
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(20 * d.s, 14 * d.s, 20 * d.s, 18 * d.s),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Actions(d),
              if (d.showFields) ...[SizedBox(height: 8 * d.s), _Fields(d)],
              if (d.card.design.showQr) Align(alignment: Alignment.centerRight, child: _Qr(d, 84 * d.s)),
            ],
          ),
        ),
      ],
    );
  }
}

class _BannerLayout extends StatelessWidget {
  const _BannerLayout(this.d);
  final _CardData d;

  @override
  Widget build(BuildContext context) {
    final bannerH = 118 * d.s;
    final avatar = 96 * d.s;
    return Column(
      children: [
        SizedBox(
          height: bannerH + avatar / 2,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              _cover(d, bannerH),
              Positioned(
                left: 0,
                right: 0,
                top: bannerH - avatar / 2,
                child: Center(child: _Avatar(d, avatar, ring: d.style.background)),
              ),
              if (d.card.logoUrl != null)
                Positioned(top: 12 * d.s, right: 12 * d.s, child: _Logo(d, 26 * d.s)),
            ],
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(20 * d.s, 10 * d.s, 20 * d.s, 18 * d.s),
          child: Column(
            children: [
              _NameBlock(d, align: CrossAxisAlignment.center, nameSize: 24),
              SizedBox(height: 12 * d.s),
              _Actions(d, center: true),
              if (d.showFields) ...[SizedBox(height: 8 * d.s), Divider(color: d.style.subtle), _Fields(d)],
              if (d.card.design.showQr) _Qr(d, 90 * d.s),
            ],
          ),
        ),
      ],
    );
  }
}

/// Physical business-card ratio 1.75:1 with name, title, company, logo and QR.
class _CompactLayout extends StatelessWidget {
  const _CompactLayout(this.d, {required this.width});
  final _CardData d;
  final double width;

  @override
  Widget build(BuildContext context) {
    final h = width / 1.75;
    final k = (width / 340).clamp(0.6, 1.6);
    final pad = 16 * k;
    final qr = (h - 2 * pad) * 0.62;
    final st = d.style;
    final contact = [
      if (d.visible('phones') && d.f.phones.isNotEmpty) d.f.phones.first.value,
      if (d.visible('emails') && d.f.emails.isNotEmpty) d.f.emails.first.value,
      if (d.visible('websites') && d.f.websites.isNotEmpty) d.f.websites.first.value.replaceFirst(RegExp(r'^https?://'), ''),
    ];
    return SizedBox(
      height: h,
      child: Padding(
        padding: EdgeInsets.all(pad),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(d.f.fullName.isEmpty ? 'Your name' : d.f.fullName,
                          maxLines: 1, overflow: TextOverflow.ellipsis, style: st.name(20 * k)),
                      if (d.visible('job_title') && d.f.jobTitle != null)
                        Text(d.f.jobTitle!, maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: st.body(12 * k, color: st.primary, weight: FontWeight.w600)),
                      if (d.visible('company') && d.f.company != null)
                        Text(d.f.company!, maxLines: 1, overflow: TextOverflow.ellipsis, style: st.body(11.5 * k, color: st.muted)),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(height: 2, width: 28 * k, color: st.primary),
                      SizedBox(height: 4 * k),
                      for (final c in contact.take(3))
                        Text(c, maxLines: 1, overflow: TextOverflow.ellipsis, style: st.body(10.5 * k, color: st.muted)),
                    ],
                  ),
                ],
              ),
            ),
            SizedBox(width: 10 * k),
            Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (d.card.logoUrl != null) _Logo(d, (h - 2 * pad) * 0.26) else _Avatar(d, (h - 2 * pad) * 0.3),
                _Qr(d, qr),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
