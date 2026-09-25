import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/ui/digital_card/card_style.dart';
import 'package:nfc_terminal/ui/digital_card/card_view.dart';

import 'personal_fixtures.dart';

Future<void> _pump(WidgetTester tester, Widget card, double width) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: Center(child: SizedBox(width: width, child: card)),
      ),
    ),
  ));
  await tester.pump();
}

void main() {
  const styles = ['solid', 'gradient', 'glass', 'pattern'];
  const fonts = ['sans', 'serif', 'mono', 'display'];

  for (final layout in CardTemplate.layouts) {
    for (final width in [260.0, 360.0, 720.0]) {
      testWidgets('layout $layout renders without overflow at ${width.toInt()}px', (tester) async {
        tester.view.physicalSize = const Size(1000, 2400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        for (var i = 0; i < styles.length; i++) {
          final card = sampleCard(style: styles[i], font: fonts[i]);
          await _pump(tester, DigitalCardView(key: ValueKey('$layout$i'), card: card, layout: layout), width);
          expect(tester.takeException(), isNull, reason: '$layout/${styles[i]}/${fonts[i]}');
          expect(find.byKey(ValueKey('card_$layout')), findsOneWidget);
        }
        // Minimal card (only a name) also renders.
        final bare = DigitalCard.fromJson({'id': 'x', 'share_id': 's', 'fields': {'full_name': 'Al'}});
        await _pump(tester, DigitalCardView(key: const ValueKey('bare'), card: bare, layout: layout), width);
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('hidden fields are not rendered; compact keeps 1.75:1', (tester) async {
    final card = sampleCard().copyWith(visibility: {...FieldVisibility.defaults, 'phones': 'hidden'});
    await _pump(tester, DigitalCardView(card: card, layout: 'centered'), 360);
    expect(find.text('+250 788 123 456'), findsNothing);
    expect(find.textContaining('nexventures.net'), findsWidgets);

    await _pump(tester, DigitalCardView(card: sampleCard(), layout: 'compact'), 350);
    final size = tester.getSize(find.byKey(const ValueKey('card_compact')));
    expect(size.width / size.height, closeTo(1.75, 0.02));
  });

  test('colour helpers', () {
    expect(hexColor('#B91C1C'), const Color(0xFFB91C1C));
    expect(hexColor('fff'), const Color(0xFFFFFFFF));
    expect(hexColor('nope', const Color(0xFF000001)), const Color(0xFF000001));
    expect(colorHex(const Color(0xFFB91C1C)), '#B91C1C');
    expect(onColor(const Color(0xFFFFFFFF)), isNot(Colors.white));
    expect(onColor(const Color(0xFF111111)), Colors.white);
  });
}
