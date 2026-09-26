import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/core/tap_links.dart';
import 'package:nfc_terminal/services/guest_tap.dart';
import 'package:nfc_terminal/services/ussd_dialer.dart';
import 'package:nfc_terminal/ui/widgets/guest_tap.dart';

/// The sheet shows a looping spinner while it works: pump frames instead of settling.
Future<void> frames(WidgetTester tester, [int n = 8]) async {
  for (var i = 0; i < n; i++) {
    await tester.pump(const Duration(milliseconds: 150));
  }
}

void main() {
  test('USSD codes are recognized in tel: action URLs (# escaped or not), normal numbers are not', () {
    expect(ussdCodeFromUrl('tel:*182*8*1*123%23'), '*182*8*1*123#');
    expect(ussdCodeFromUrl('tel:*500#'), '*500#');
    expect(ussdCodeFromUrl('tel:+250788000111'), isNull);
    expect(ussdCodeFromUrl('https://example.com/*182#'), isNull);
    expect(ussdCodeFromUrl(null), isNull);
  });

  test('fetchTapUssd posts to /api/v1/public/t/{code}/ussd (keeping a path prefix) and reads the options', () async {
    Uri? hit;
    final client = MockClient((r) async {
      hit = r.url;
      expect(r.method, 'POST');
      return http.Response(
          jsonEncode({
            'action_type': 'ussd',
            'options': [
              {'label': 'Pay with MoMo', 'code': '*182*8*1*123#'},
              {'label': 'Bad', 'code': 'not a code'},
            ],
          }),
          200);
    });
    final opts = await fetchTapUssd(Uri.parse('https://api.example.com/root/t/Ab3_x-9Z'), client: client);
    expect(hit.toString(), 'https://api.example.com/root/api/v1/public/t/Ab3_x-9Z/ussd');
    expect(opts!.map((o) => o.code), ['*182*8*1*123#'], reason: 'invalid codes are dropped');

    final none = MockClient((_) async => http.Response('{"error":{}}', 404));
    expect(await fetchTapUssd(Uri.parse('https://api.example.com/t/Ab3_x-9Z'), client: none), isNull);
    expect(await fetchTapUssd(Uri.parse('https://api.example.com/p/jane'), client: client), isNull);
  });

  group('guest tap of a USSD card', () {
    const tag = GuestTag(uid: '04A1B2C3D4E5F6', uris: ['https://api.nextap.example/t/Ab3_x-9Z'], hasNdef: true);
    final link = classifyTapLink(tag.uris.first, const ['https://api.nextap.example'])!;

    Future<(List<Uri>, List<String>)> run(WidgetTester tester, List<UssdOption>? options, {String? choose}) async {
      final opened = <Uri>[];
      final dialed = <String>[];
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: GuestTagSheet(
            tag: tag,
            link: link,
            opener: (u) async {
              opened.add(u);
              return true;
            },
            ussdLookup: (_) async => options,
            dialer: (c) async {
              dialed.add(c);
              return true;
            },
          ),
        ),
      ));
      await frames(tester);
      if (choose != null) {
        await tester.tap(find.byKey(Key('ussdOption_$choose')));
        await frames(tester);
      }
      return (opened, dialed);
    }

    testWidgets('one code: dialed right away, the browser is not opened', (tester) async {
      final (opened, dialed) = await run(tester, const [UssdOption('Pay', '*182*8*1*123#')]);
      expect(dialed, ['*182*8*1*123#']);
      expect(opened, isEmpty);
    });

    testWidgets('several codes: the customer chooses which one to dial', (tester) async {
      final (opened, dialed) = await run(
        tester,
        const [UssdOption('Pay with MoMo', '*182*8*1*123#'), UssdOption('Airtel Money', '*500#')],
        choose: '*500#',
      );
      expect(dialed, ['*500#']);
      expect(opened, isEmpty);
    });

    testWidgets('not a USSD card: the link opens as before', (tester) async {
      final (opened, dialed) = await run(tester, null);
      expect(dialed, isEmpty);
      expect(opened, [link.uri]);
    });
  });
}
