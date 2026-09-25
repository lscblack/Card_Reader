import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/update_check.dart';
import 'package:nfc_terminal/ui/widgets/help_sheet.dart';
import 'package:nfc_terminal/ui/widgets/update_banner.dart';

import 'fakes.dart';
import 'part2_test.dart' show businessConfig, part1Config;

http.Response _json(Object body, int status) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

void main() {
  group('update check', () {
    Map<String, dynamic> release(int build, {String url = '/api/v1/downloads/android/latest'}) => {
      'version_name': '1.$build.0', 'build_number': build, 'file_size': 1234, 'sha256': 'ab',
      'published_at': '2026-09-25T08:00:00Z', 'download_url': url, 'min_android': '7.0',
    };

    Future<AppRelease?> run(http.Response Function(http.Request) handler, {int installed = 5}) {
      final c = UpdateChecker(client: MockClient((r) async => handler(r)), installedBuild: installed);
      return c.check('http://192.168.1.74:8000/');
    }

    test('newer build → release with absolute download URL', () async {
      late Uri seen;
      final r = await run((req) {
        seen = req.url;
        expect(req.headers.containsKey('Authorization'), isFalse, reason: 'public endpoint');
        return _json(release(6), 200);
      });
      expect(seen.toString(), 'http://192.168.1.74:8000/api/v1/meta/app-release');
      expect(r!.versionName, '1.6.0');
      expect(r.downloadUrl, 'http://192.168.1.74:8000/api/v1/downloads/android/latest');
    });

    test('same or older build → no update', () async {
      expect(await run((_) => _json(release(5), 200)), isNull);
      expect(await run((_) => _json(release(4), 200)), isNull);
    });

    test('404 no_release, 500, garbage and network errors are silent', () async {
      expect(await run((_) => _json({'error': {'code': 'no_release', 'message': 'none', 'ref': 'NFC-8xxx'}}, 404)), isNull);
      expect(await run((_) => http.Response('oops', 500)), isNull);
      expect(await run((_) => http.Response('not json', 200)), isNull);
      expect(await run((_) => throw http.ClientException('down')), isNull);
      expect(await run((_) => _json(release(9, url: 'javascript:alert(1)'), 200)), isNull);
    });

    test('absolute https download URL kept; checks are daily', () async {
      var now = DateTime(2026, 9, 25, 8);
      final c = UpdateChecker(
        client: MockClient((_) async => _json(release(7, url: 'https://cdn.example.com/nfc.apk'), 200)),
        installedBuild: 1,
        clock: () => now,
      );
      expect(c.isDue, isTrue);
      expect((await c.check('https://api.example.com'))!.downloadUrl, 'https://cdn.example.com/nfc.apk');
      expect(c.isDue, isFalse);
      now = now.add(const Duration(hours: 25));
      expect(c.isDue, isTrue);
    });
  });

  group('Part 2 §E reconciliation', () {
    test('/device/events failure carries error_code + error_ref; success keeps Part 1 shape', () async {
      final repo = InMemoryEventRepository();
      final api = FakeDeviceApi()
        ..onSubmit = (s) async => EventSubmitResult.fromJson({
          'event_id': s.eventId, 'status': 'retrying', 'status_code': null, 'latency_ms': 10000,
          'error': null, 'error_code': 'delivery_timeout', 'error_ref': 'NFC-5001',
        });
      final svc = DeliveryService(api: api, httpClient: MockClient((_) async => http.Response('', 200)), repository: repo);
      final r = (await svc.deliver(testEvent(), testConfig()))!;
      expect(r.status, EventStatus.retrying);
      expect(r.errorRef, 'NFC-5001');
      expect(r.lastError, 'delivery_timeout');

      final ok = EventSubmitResult.fromJson({'event_id': 'e', 'status': 'delivered', 'status_code': 200, 'latency_ms': 5, 'error': null});
      expect(ok.errorCode, isNull);
      expect(ok.errorRef, isNull);
    });
  });

  testWidgets('help sheet explains developer vs business behaviour and the UID-only limit', (tester) async {
    for (final cfg in [DeviceConfig.fromJson(part1Config()), DeviceConfig.fromJson(businessConfig())]) {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: TapHelpSheet(key: ValueKey(cfg.accountType), config: cfg))));
      expect(find.text('What happens when I tap a card?'), findsOneWidget);
      expect(find.textContaining('Developer device'), findsOneWidget);
      expect(find.textContaining('Business device'), findsOneWidget);
      expect(find.textContaining(cfg.isBusiness ? 'Business device (this phone)' : 'Developer device (this phone)'),
          findsOneWidget);
      await tester.scrollUntilVisible(find.textContaining('UID only'), 200,
          scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('not authenticated'), findsWidgets);
    }
  });

  testWidgets('update banner: shows version, explains sideloading, dismissible', (tester) async {
    const release = AppRelease(versionName: '1.2.0', buildNumber: 7, downloadUrl: 'https://x/nfc.apk');
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: UpdateBanner(release: release))));
    expect(find.text('Update available (v1.2.0)'), findsOneWidget);
    await tester.tap(find.text('Get'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Install unknown apps'), findsOneWidget);
    await tester.tap(find.text('Later'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Dismiss'));
    await tester.pump();
    expect(find.byKey(const Key('updateBanner')), findsNothing);
  });
}
