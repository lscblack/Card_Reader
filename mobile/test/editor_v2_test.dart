import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/data/models/design_presets.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/services/personal_state.dart';
import 'package:nfc_terminal/ui/card_v2/card_v2_view.dart';
import 'package:nfc_terminal/ui/card_v2/palette_extract.dart';
import 'package:nfc_terminal/ui/personal/card_editor_screen.dart';
import 'package:nfc_terminal/ui/personal/editor_design_v2.dart';
import 'package:provider/provider.dart';

import 'fakes.dart';
import 'personal_fakes.dart';
import 'personal_fixtures.dart';

Future<String> _asset(String path) async => File(path).readAsString();

PersonalState _state(MemorySecureStore store, FakePersonalApi api) => PersonalState(
  store: store,
  httpClient: MockClient((_) async => http.Response('', 404)),
  platform: FakePlatformInfo(),
  hce: FakeHce(),
  assetLoader: _asset,
  apiFactory: (_, token, _) => api..sessionToken = token,
);

void main() {
  group('design helpers', () {
    test('dominant colours + suggested palette from pixels', () {
      final px = BytesBuilder();
      void fill(int n, List<int> rgba) {
        for (var i = 0; i < n; i++) {
          px.add(rgba);
        }
      }
      fill(600, [200, 20, 30, 255]); // red (most)
      fill(300, [20, 30, 60, 255]); // navy
      fill(200, [250, 250, 250, 255]); // white
      fill(500, [0, 200, 0, 0]); // transparent: ignored
      final colors = dominantColors(px.toBytes(), step: 1);
      expect(colors.length, 3);
      expect(colors.first.r, closeTo(200 / 255, 0.02));
      final p = suggestPalette(colors)!;
      expect(p.primary, '#C8141E');
      expect(p.secondary, '#141E3C');
      expect(p.background, '#FFFFFF');
      expect(suggestPalette(const []), isNull);
    });

    test('contrast warnings and surprise me', () {
      final bad = v2Card('diagonal_crimson').design.copyWith(text: '#EEEEEE', accent: '#FAFAFA');
      expect(contrastWarnings(bad), hasLength(2));
      expect(contrastWarnings(v2Card('diagonal_crimson').design), isEmpty);
      final palettes = DesignPresets.fallback.palettes;
      final s = surprise(v2Card('diagonal_crimson').design, palettes, math.Random(1));
      expect(palettes.map((p) => p.primary), contains(s.primary));
      expect(CardDesign.photoShapes, contains(s.photoShape));
    });
  });

  group('PersonalState design data', () {
    test('bundled v2 templates + presets load; server templates are cached and completed', () async {
      final store = MemorySecureStore();
      final api = FakePersonalApi();
      final p = _state(store, api);
      await p.init();
      await p.designDataReady;
      expect(p.templateFor('badge_hex').isV2, isTrue);
      expect(p.templates.where((t) => t.isV2).length, 16);
      expect(p.presets.palettes.length, greaterThanOrEqualTo(16));

      api.serverTemplates = [CardTemplate.fromJson({'id': 'classic', 'name': 'Classic', 'layout': 'left'})];
      api.presets = const DesignPresets(palettes: [
        CardPalettePreset(id: 's', name: 'Server', primary: '#000000', secondary: '#111111', background: '#FFFFFF',
            text: '#000000', accent: '#222222'),
      ]);
      await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
      await p.refresh();
      expect(p.templates.first.id, 'classic');
      expect(p.templates.where((t) => t.isV2).length, 16, reason: 'bundled v2 until the server serves them');
      expect(p.presets.palettes.single.id, 's');
      expect(store.values['personal_templates_cache'], contains('classic'));

      // Offline restart (signed out: public design data survives sign-out): the cache is used.
      await p.signOut(remote: false);
      final p2 = _state(store, FakePersonalApi());
      await p2.init();
      await p2.designDataReady;
      expect(p2.templates.first.id, 'classic');
      expect(p2.presets.palettes.single.id, 's');
    });
  });

  group('editor (v2)', () {
    late FakePersonalApi api;
    late PersonalState p;

    Future<void> open(WidgetTester tester, DigitalCard card) async {
      tester.view.physicalSize = const Size(1080, 3600);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      api = FakePersonalApi()
        ..serverCards = [card]
        ..presets = DesignPresets.fromJson(jsonDecode(File('assets/design_presets.json').readAsStringSync()));
      p = _state(MemorySecureStore(), api);
      await tester.runAsync(() async {
        await p.init();
        await p.designDataReady;
        await p.signIn(server: 'https://api.example.com', email: 'a@b.c', password: 'pw');
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pumpWidget(ChangeNotifierProvider.value(
        value: p,
        child: MaterialApp(home: CardEditorScreen(card: p.primary!, imagePicker: (_, _) async => null)),
      ));
      await tester.pumpAndSettle();
    }

    void tab(WidgetTester tester, int i) =>
        DefaultTabController.of(tester.element(find.byKey(const Key('editorPreview')))).animateTo(i);

    testWidgets('arrange: tap menu hides a block, drag from the tray into a zone, undo/redo, save sends it',
        (tester) async {
      await open(tester, v2Card('diagonal_crimson'));
      expect(find.descendant(of: find.byKey(const Key('editorPreview')), matching: find.byType(CardV2View)), findsOneWidget);
      tab(tester, 4);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('arrangePanel')), findsOneWidget);

      // Tap → menu → hide the photo (hero becomes empty).
      await tester.tap(find.descendant(of: find.byKey(const Key('zone_hero')), matching: find.text('Photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('hideBlock')));
      await tester.pumpAndSettle();
      expect(find.descendant(of: find.byKey(const Key('hiddenTray')), matching: find.text('Photo')), findsOneWidget);

      Future<void> drag(Finder from, Finder to) async {
        final g = await tester.startGesture(tester.getCenter(from), kind: PointerDeviceKind.touch);
        await tester.pump(kLongPressTimeout + const Duration(milliseconds: 100));
        await g.moveTo(tester.getCenter(to) + const Offset(0, -10));
        await tester.pump();
        await g.moveTo(tester.getCenter(to));
        await tester.pump();
        await g.up();
        await tester.pumpAndSettle();
      }

      // Long-press drag "Address" from the tray into the info zone.
      await drag(find.descendant(of: find.byKey(const Key('hiddenTray')), matching: find.text('Address')),
          find.byKey(const Key('zone_info')));
      expect(find.descendant(of: find.byKey(const Key('zone_info')), matching: find.text('Address')), findsOneWidget);

      // A rejected drop (contacts can't go into hero) changes nothing.
      await drag(find.text('Phone & email'), find.byKey(const Key('zone_hero')));
      expect(find.descendant(of: find.byKey(const Key('zone_hero')), matching: find.text('Phone & email')), findsNothing);

      // Undo the drag, redo it.
      await tester.tap(find.byKey(const Key('undo')));
      await tester.pumpAndSettle();
      expect(find.descendant(of: find.byKey(const Key('zone_info')), matching: find.text('Address')), findsNothing);
      await tester.tap(find.byKey(const Key('redo')));
      await tester.pumpAndSettle();
      expect(find.descendant(of: find.byKey(const Key('zone_info')), matching: find.text('Address')), findsOneWidget);

      await tester.tap(find.byKey(const Key('saveCard')));
      await tester.pumpAndSettle();
      final patch = api.patches.last;
      final front = (patch['arrangement'] as Map)['front'] as Map;
      expect(front['info'], contains('address'));
      expect(front['hero'], isEmpty);
      expect(patch['sides_enabled'], ['front', 'back']);
      expect(p.primary!.arrangement['front']!['info'], contains('address'), reason: 'server copy updated');
    });

    testWidgets('autosave: changes are saved a few seconds after the last edit', (tester) async {
      await open(tester, v2Card('diagonal_crimson'));
      tab(tester, 1);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('shape_hexagon')));
      await tester.pump();
      expect(find.descendant(of: find.byKey(const Key('saveStatus')), matching: find.text('Unsaved')), findsOneWidget);
      expect(api.patches, isEmpty);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(api.patches, hasLength(1));
      expect((api.patches.single['design'] as Map)['photo_shape'], 'hexagon');
      expect(find.descendant(of: find.byKey(const Key('saveStatus')), matching: find.text('Saved')), findsOneWidget);
    });

    testWidgets('template gallery: categories, switch to an ID badge; badge fields editable', (tester) async {
      await open(tester, v2Card('diagonal_crimson'));
      expect(find.byKey(const Key('template_gold_wave')), findsOneWidget, reason: 'business category first');
      await tester.tap(find.byKey(const Key('cat_badge')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('template_badge_header')));
      await tester.pumpAndSettle();

      tab(tester, 3);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const Key('field_barcode_value')), 200,
          scrollable: find.descendant(of: find.byKey(const ValueKey('fields_0')), matching: find.byType(Scrollable)).first);
      await tester.enterText(find.descendant(of: find.byKey(const Key('field_barcode_value')), matching: find.byType(EditableText)), 'ÉÉ');
      await tester.pump();
      expect(find.text('Letters, digits and basic symbols only (no accents)'), findsOneWidget);
      await tester.enterText(find.descendant(of: find.byKey(const Key('field_barcode_value')), matching: find.byType(EditableText)), 'EMP-7');
      await tester.pump();

      await tester.tap(find.byKey(const Key('saveCard')));
      await tester.pumpAndSettle();
      final patch = api.patches.last;
      expect(patch['template_id'], 'badge_header');
      expect((patch['fields'] as Map)['barcode_value'], 'EMP-7');
      expect(patch['sides_enabled'], ['front', 'back']);
    });

    testWidgets('design panel: palette applies all five colours', (tester) async {
      await open(tester, v2Card('diagonal_crimson'));
      tab(tester, 1);
      await tester.pumpAndSettle();
      final pal = p.presets.palettes.firstWhere((x) => x.id == 'teal');
      await tester.scrollUntilVisible(find.byKey(const Key('palette_teal')), 150,
          scrollable: find.descendant(of: find.byKey(const Key('palettes')), matching: find.byType(Scrollable)));
      await tester.tap(find.byKey(const Key('palette_teal')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('saveCard')));
      await tester.pumpAndSettle();
      final d = api.patches.last['design'] as Map;
      expect([d['primary'], d['secondary'], d['accent']], [pal.primary, pal.secondary, pal.accent]);
    });
  });
}
