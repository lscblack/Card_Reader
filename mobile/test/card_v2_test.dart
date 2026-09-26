import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/data/models/template_v2.dart';
import 'package:nfc_terminal/ui/card_v2/card_math.dart';
import 'package:nfc_terminal/ui/card_v2/card_v2_view.dart';

import 'personal_fixtures.dart';

final bundled = {
  for (final j in jsonDecode(File('assets/card_templates_v2.json').readAsStringSync()) as List)
    (j as Map)['id'] as String: CardTemplate.fromJson(j),
};
TemplateV2 tpl(String id) => bundled[id]!.v2!;

Widget _host(Widget child, {double width = 700, bool reduceMotion = false}) => MediaQuery(
  data: MediaQueryData(disableAnimations: reduceMotion),
  child: Directionality(
    textDirection: TextDirection.ltr,
    child: Center(child: RepaintBoundary(child: SizedBox(width: width, child: child))),
  ),
);

void main() {
  group('math', () {
    test('SVG path: absolute lines/arcs/curves parse; bad data → empty path', () {
      expect(parseSvgPath('M0 0 H1750 V380 L0 620 Z').getBounds(), const Rect.fromLTRB(0, 0, 1750, 620));
      final arc = parseSvgPath('M0 0 H1000 V560 A600 260 0 0 1 0 560 Z').getBounds();
      expect(arc.bottom, greaterThan(650), reason: 'the arc bulges below y=560');
      expect(parseSvgPath('M0 0 C400 520 800 820 1200 680 Q 10 10 20 20 T 30 30 S 1 1 2 2 Z').getBounds().isEmpty, isFalse);
      expect(parseSvgPath('M0 0 L oops').getBounds(), Rect.zero);
    });

    test('WCAG contrast and the text-colour rule', () {
      expect(contrastRatio(Colors.white, Colors.black), closeTo(21, 0.01));
      const text = Color(0xFF111827);
      expect(textColorOn(Colors.white, text), text);
      expect(textColorOn(const Color(0xFFB91C1C), text), Colors.white);
      // Light-on-light design text: falls back to the best of text/white/near-black.
      expect(textColorOn(const Color(0xFFF5F5F4), const Color(0xFFF5F5F4)), const Color(0xFF111111));
    });

    test('zone fit: ×0.92 steps while overflowing, stopping once ≤ 0.5 (web Zone)', () {
      expect(zoneFitScale(100, 200), 1);
      expect(zoneFitScale(110, 100), closeTo(0.92 * 0.92, 1e-9));
      expect(zoneFitScale(10000, 100), closeTo(math.pow(0.92, 9), 1e-9));
    });

    test('barcode values: printable ASCII, ≤ 48', () {
      expect(barcodeValueError('NX-0042'), isNull);
      expect(barcodeValueError('é'), isNotNull);
      expect(barcodeValueError('x' * 49), isNotNull);
    });
  });

  group('templates', () {
    test('16 bundled originals, valid canvases and default arrangements', () {
      expect(bundled.length, 16);
      for (final c in bundled.values) {
        final t = c.v2!;
        expect(c.isV2, isTrue);
        expect(TemplateV2.categories, contains(t.category));
        expect(t.aspectRatio, t.portrait ? closeTo(1000 / 1586, 1e-9) : 1.75);
        expect(t.validate(t.defaultArrangement), isEmpty, reason: t.id);
        for (final s in t.sides) {
          for (final l in t.side(s).layers) {
            expect(parseSvgPath(l.path).getBounds().isEmpty, isFalse, reason: '${t.id} ${l.path}');
          }
          for (final z in t.side(s).zones) {
            expect(z.x + z.w <= t.unitWidth && z.y + z.h <= t.unitHeight, isTrue, reason: '${t.id}.${z.id} inside card');
          }
        }
      }
      expect({for (final c in bundled.values) c.category}, {'business', 'badge', 'minimal'});
    });

    test('non-v2 JSON is not a v2 template', () {
      expect(CardTemplate.fromJson({'id': 'modern', 'layout': 'centered'}).isV2, isFalse);
      expect(TemplateV2.fromJson({'id': 'x', 'engine': 'v2', 'canvas': {}}), isNull, reason: 'needs a front');
    });
  });

  group('arrangement', () {
    final t = tpl('diagonal_crimson');

    test('validate reports the backend rules', () {
      expect(t.validate({'front': {'nope': ['name']}}), isNotEmpty);
      expect(t.validate({'front': {'hero': ['contacts']}}), isNotEmpty, reason: 'zone does not accept');
      expect(t.validate({'front': {'info': ['company']}, 'back': {'brand': ['company']}}), contains('company is placed twice'));
      expect(t.validate({'front': {'hero': ['photo', 'qr']}}), isNotEmpty, reason: 'max 1');
    });

    test('resolve cleans an invalid arrangement (web resolveArrangement)', () {
      final r = t.resolve({'front': {'info': ['name', 'name', 'qr', 'contacts'], 'hero': ['photo', 'logo']}});
      expect(r['front']!['info'], ['name', 'contacts']);
      expect(r['front']!['hero'], ['photo']);
      expect(r['back']!['brand'], isEmpty, reason: 'own arrangement wins; no per-side default');
      expect(t.resolve(null), t.resolve(const {}));
      expect(t.resolve(null)['back']!['code'], ['qr']);
    });

    test('move / hide / canPlace', () {
      var a = t.resolve(null);
      expect(t.canPlace(a, 'front', 'hero', 'qr'), isFalse, reason: 'hero is full');
      a = t.move(a, 'address', 'front', 'info', 0);
      expect(a['front']!['info']!.first, 'address');
      expect(t.move(a, 'tagline', 'front', 'info'), same(a), reason: 'info is full (max 4)');
      a = TemplateV2.hide(a, 'website');
      a = t.move(a, 'tagline', 'front', 'info');
      expect(a['front']!['info']!.last, 'tagline');
      expect(a['back']!['brand'], isNot(contains('tagline')), reason: 'moved from the back');
      expect(t.hiddenBlocks(a), contains('website'));
      a = t.move(a, 'address', 'front', 'info', 4);
      expect(a['front']!['info']!.last, 'address');
      expect(t.validate(a), isEmpty);
    });

    test('switching template maps blocks onto the new zones', () {
      final badge = tpl('badge_header');
      final mapped = badge.mapFrom(t.resolve(null));
      expect(badge.validate(mapped), isEmpty);
      expect(mapped['front']!['hero'], ['photo']);
      expect(mapped.values.expand((z) => z.values).expand((l) => l), contains('name'));
      final card = v2Card('diagonal_crimson').withTemplate(bundled['badge_header']!);
      expect(card.designVersion, 2);
      expect(card.sidesEnabled, ['front', 'back']);
      expect(card.design.photoShape, 'rounded');
      final v1 = card.withTemplate(CardTemplate.builtIn.first);
      expect(v1.designVersion, 1);
      expect(v1.design.photoShape, isNull);
    });

    test('variants replace a side\'s layers (gold_wave "calm")', () {
      final g = tpl('gold_wave');
      expect(g.variants.map((v) => v.id), contains('calm'));
      expect(g.layersFor('front', 'calm'), isNot(same(g.side('front').layers)));
      expect(g.layersFor('front', 'nope'), same(g.side('front').layers));
      expect(g.layersFor('front', null), same(g.side('front').layers));
    });
  });

  group('DigitalCard v2 fields', () {
    test('parse + v2 PATCH carries design, arrangement, sides and badge fields', () {
      final c = v2Card('diagonal_crimson');
      expect(c.isV2, isTrue);
      expect(c.sidesEnabled, ['front', 'back']);
      expect(c.fields.idNumber, 'NX-0042');
      expect(c.visibility['id_number'], 'contacts');
      final p = c.copyWith(arrangement: tpl('diagonal_crimson').resolve(null)).toPatch();
      expect((p['design'] as Map)['photo_shape'], 'circle');
      expect(p['sides_enabled'], ['front', 'back']);
      expect(p['arrangement'], isA<Map>());
      expect((p['fields'] as Map)['barcode_value'], 'NX0042');
      expect((p['visibility'] as Map).containsKey('valid_until'), isTrue);
    });

    test('v1 PATCH stays free of Part 5 keys (servers without Part 5 reject them)', () {
      final p = sampleCard().toPatch();
      expect((p['design'] as Map).keys, isNot(contains('photo_shape')));
      expect((p['fields'] as Map).keys, isNot(contains('id_number')));
      expect((p['visibility'] as Map).keys, isNot(contains('id_number')));
      expect(p.containsKey('arrangement') || p.containsKey('sides_enabled'), isFalse);
    });

    test('expiry is date-only', () {
      final c = v2Card('badge_header', validUntil: '2026-09-25');
      expect(c.fields.isExpired(DateTime(2026, 9, 25, 23)), isFalse);
      expect(c.fields.isExpired(DateTime(2026, 9, 26)), isTrue);
    });

    test('visibility per viewer', () {
      expect(FieldVisibility.visibleTo('contacts', 'public'), isFalse);
      expect(FieldVisibility.visibleTo('contacts', 'contact'), isTrue);
      expect(FieldVisibility.visibleTo('hidden', 'owner'), isFalse);
      expect(FieldVisibility.visibleTo('hidden', 'all'), isTrue);
    });
  });

  group('renderer', () {
    testWidgets('blocks honour visibility: the public view hides contacts-only fields', (tester) async {
      final t = tpl('diagonal_crimson');
      final card = v2Card('diagonal_crimson');
      await tester.pumpWidget(_host(CardV2View(card: card, template: t, viewer: 'contact', thumbnail: true)));
      expect(find.text('+250 788 123 456'), findsOneWidget);
      await tester.pumpWidget(_host(CardV2View(card: card, template: t, viewer: 'public', thumbnail: true)));
      expect(find.text('+250 788 123 456'), findsNothing);
      expect(find.text('Jane Mukamana'), findsOneWidget);
    });

    testWidgets('tap flips to the back; reduced motion swaps without animating', (tester) async {
      final t = tpl('diagonal_crimson');
      String? side;
      await tester.pumpWidget(_host(CardV2View(card: v2Card('diagonal_crimson'), template: t, onSideChanged: (s) => side = s)));
      expect(find.byKey(const ValueKey('zone_front_info')), findsOneWidget);
      await tester.tap(find.byKey(const Key('cardFlip')));
      await tester.pump(const Duration(milliseconds: 150));
      expect(find.byKey(const ValueKey('zone_front_info')), findsOneWidget, reason: 'still turning');
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('zone_back_brand')), findsOneWidget);
      expect(side, 'back');

      await tester.pumpWidget(_host(
        CardV2View(key: const Key('rm'), card: v2Card('diagonal_crimson'), template: t),
        reduceMotion: true,
      ));
      await tester.tap(find.byKey(const Key('cardFlip')));
      await tester.pump();
      expect(find.byKey(const ValueKey('zone_back_brand')), findsOneWidget);
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('single-sided cards do not flip; expired badges show the ribbon', (tester) async {
      final card = v2Card('badge_header', validUntil: '2020-01-01', back: false);
      await tester.pumpWidget(_host(CardV2View(card: card, template: tpl('badge_header'), today: DateTime(2026, 9, 26)), width: 400));
      expect(find.text('Jan 1, 2020'), findsOneWidget);
      expect(find.byKey(const Key('cardFlip')), findsNothing);
      expect(find.byKey(const Key('expiredRibbon')), findsOneWidget);
      expect(find.byKey(const Key('barcode')), findsOneWidget);
    });

    testWidgets('overlong content is scaled and clipped inside its zone (no overflow errors)', (tester) async {
      final j = cardJson(template: 'minimal_line', name: 'X' * 200);
      j['design_version'] = 2;
      (j['fields'] as Map)['phones'] = [for (var i = 0; i < 9; i++) {'label': 'm', 'value': '+250 788 000 00$i'}];
      await tester.pumpWidget(_host(CardV2View(card: DigitalCard.fromJson(j), template: tpl('minimal_line'), thumbnail: true)));
      expect(tester.takeException(), isNull);
    });
  });

  group('goldens', () {
    final cases = <(String, String, double)>[
      ('diagonal_crimson', 'front', 700),
      ('diagonal_crimson', 'back', 700),
      ('gold_wave', 'back', 700),
      ('minimal_line', 'front', 700),
      ('teal_geometric', 'front', 700),
      ('badge_wave', 'front', 400),
      ('badge_header', 'front', 400),
      ('badge_hex', 'front', 400),
    ];
    for (final (id, side, width) in cases) {
      testWidgets('$id $side', (tester) async {
        final t = tpl(id);
        tester.view.physicalSize = Size(width + 20, width / t.aspectRatio + 20);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final card = v2Card(id, validUntil: id == 'badge_header' ? '2026-01-01' : '2099-12-31',
            design: t.defaultDesign.cast<String, Object?>());
        await tester.pumpWidget(_host(
          CardV2View(card: card, template: t, side: side, thumbnail: true, today: DateTime(2026, 9, 26)),
          width: width,
        ));
        await expectLater(find.byType(RepaintBoundary).first, matchesGoldenFile('goldens/${id}_$side.png'));
      });
    }
  });
}
