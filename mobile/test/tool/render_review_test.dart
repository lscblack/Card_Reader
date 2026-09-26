// Review-only renders with Roboto (not run in CI: needs REVIEW_OUT). Writes PNGs of every
// bundled v2 template (front/back) so a human can eyeball the designs.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/ui/card_v2/card_v2_view.dart';

import '../personal_fixtures.dart';

void main() {
  final out = Platform.environment['REVIEW_OUT'];
  testWidgets('render review', (tester) async {
    if (out == null) return;
    final fonts = '${Platform.environment['HOME']}/snap/flutter/common/flutter/bin/cache/artifacts/material_fonts';
    await tester.runAsync(() async {
      final roboto = FontLoader('Roboto');
      for (final f in ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf', 'Roboto-Black.ttf', 'Roboto-Italic.ttf']) {
        roboto.addFont(File('$fonts/$f').readAsBytes().then((b) => ByteData.view(b.buffer)));
      }
      await roboto.load();
      final icons = FontLoader('MaterialIcons')..addFont(File('$fonts/MaterialIcons-Regular.otf').readAsBytes().then((b) => ByteData.view(b.buffer)));
      await icons.load();
    });
    final list = [for (final j in jsonDecode(File('assets/card_templates_v2.json').readAsStringSync()) as List) CardTemplate.fromJson(j)];
    for (final t in list) {
      final v2 = t.v2!;
      for (final side in v2.sides) {
        final key = GlobalKey();
        final w = v2.portrait ? 500.0 : 875.0;
        tester.view.physicalSize = Size(w + 40, w / v2.aspectRatio + 40);
        tester.view.devicePixelRatio = 1;
        final card = v2Card(t.id, design: v2.defaultDesign.cast<String, Object?>());
        await tester.pumpWidget(MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData(fontFamily: 'Roboto'),
          home: Scaffold(backgroundColor: const Color(0xFF888888), body: Center(child: RepaintBoundary(key: key,
            child: SizedBox(width: w, child: DefaultTextStyle(style: const TextStyle(fontFamily: 'Roboto'),
              child: CardV2View(card: card, template: v2, side: side, thumbnail: true)))))),
        ));
        await tester.pump();
        await tester.runAsync(() async {
          final ro = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          final img = await ro.toImage();
          final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
          File('$out/${t.id}_$side.png').writeAsBytesSync(bytes!.buffer.asUint8List());
        });
      }
    }
    tester.view.reset();
  });
}
