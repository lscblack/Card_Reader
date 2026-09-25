import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/delivery_service.dart';
import 'package:nfc_terminal/services/retry_queue.dart';
import 'package:nfc_terminal/services/signing.dart';

import 'fakes.dart';

void main() {
  group('RetryPolicy', () {
    const p = RetryPolicy();

    test('backoff 5s, 30s, 2m, 10m then stays at 10m', () {
      expect(p.delayFor(1), const Duration(seconds: 5));
      expect(p.delayFor(2), const Duration(seconds: 30));
      expect(p.delayFor(3), const Duration(minutes: 2));
      expect(p.delayFor(4), const Duration(minutes: 10));
      expect(p.delayFor(9), const Duration(minutes: 10));
    });

    test('Retry-After is honoured when longer, capped', () {
      expect(p.delayFor(1, retryAfter: const Duration(seconds: 20)), const Duration(seconds: 20));
      expect(p.delayFor(3, retryAfter: const Duration(seconds: 20)), const Duration(minutes: 2));
      expect(p.delayFor(1, retryAfter: const Duration(hours: 2)), const Duration(minutes: 30));
    });

    test('max_retries caps automatic attempts (first try + max_retries)', () {
      expect(p.canRetry(1, 3), isTrue);
      expect(p.canRetry(3, 3), isTrue);
      expect(p.canRetry(4, 3), isFalse);
      expect(p.canRetry(1, 0), isFalse);
    });

    test('retryable statuses: 408, 429, 5xx only', () {
      for (final s in [408, 429, 500, 502, 503, 504]) {
        expect(RetryPolicy.isRetryableStatus(s), isTrue, reason: '$s');
      }
      for (final s in [400, 401, 403, 404, 409, 410, 422]) {
        expect(RetryPolicy.isRetryableStatus(s), isFalse, reason: '$s');
      }
    });
  });

  group('DeliveryService relay', () {
    late InMemoryEventRepository repo;
    late FakeDeviceApi api;
    final now = DateTime.utc(2026, 9, 25, 8, 31);

    DeliveryService svc() => DeliveryService(
      api: api,
      httpClient: MockClient((_) async => fail('relay must not call the endpoint')),
      repository: repo,
      clock: () => now,
    );

    setUp(() {
      repo = InMemoryEventRepository();
      api = FakeDeviceApi();
    });

    test('delivered', () async {
      final r = await svc().deliver(testEvent(), testConfig());
      expect(r!.status, EventStatus.delivered);
      expect(r.lastStatusCode, 200);
      expect(r.attempts, 1);
      expect(api.submissions.single.directDelivery, isNull);
      expect(repo.rows.values.single.status, EventStatus.delivered);
    });

    test('platform "retrying" is server-owned: not queued locally', () async {
      api.onSubmit = (s) async =>
          EventSubmitResult(eventId: s.eventId, status: 'retrying', statusCode: 503, error: 'HTTP 503');
      final r = await svc().deliver(testEvent(), testConfig());
      expect(r!.status, EventStatus.retrying);
      expect(r.nextAttemptAt, isNull);
      expect(await repo.dueForRetry(now.add(const Duration(days: 1))), isEmpty);
    });

    test('network error -> queued with 5s backoff', () async {
      api.onSubmit = (_) async => throw const NetworkException('down');
      final r = await svc().deliver(testEvent(), testConfig());
      expect(r!.status, EventStatus.queued);
      expect(r.nextAttemptAt, now.add(const Duration(seconds: 5)));
    });

    test('503 retried, 422 not, 429 honours Retry-After', () async {
      api.onSubmit = (_) async => throw const ApiException(statusCode: 503, code: 'x', message: 'x');
      expect((await svc().deliver(testEvent(id: 'a'), testConfig()))!.status, EventStatus.queued);

      api.onSubmit = (_) async => throw const ApiException(statusCode: 422, code: 'validation_error', message: 'bad');
      final bad = await svc().deliver(testEvent(id: 'b'), testConfig());
      expect(bad!.status, EventStatus.failed);
      expect(bad.lastStatusCode, 422);

      api.onSubmit = (_) async => throw const ApiException(
        statusCode: 429, code: 'rate_limited', message: 'slow', retryAfter: Duration(seconds: 42));
      final rl = await svc().deliver(testEvent(id: 'c'), testConfig());
      expect(rl!.nextAttemptAt, now.add(const Duration(seconds: 42)));
    });

    test('409 event_id_conflict is final; 403 application_disabled is retried later', () async {
      api.onSubmit = (_) async => throw const ApiException(statusCode: 409, code: 'event_id_conflict', message: 'x');
      expect((await svc().deliver(testEvent(id: 'a'), testConfig()))!.status, EventStatus.failed);
      api.onSubmit = (_) async => throw const ApiException(statusCode: 403, code: 'application_disabled', message: 'x');
      expect((await svc().deliver(testEvent(id: 'b'), testConfig()))!.status, EventStatus.queued);
    });

    test('gives up after max_retries', () async {
      api.onSubmit = (_) async => throw const NetworkException('down');
      final r = await svc().deliver(testEvent(attempts: 3), testConfig(maxRetries: 3));
      expect(r!.status, EventStatus.failed);
      expect(r.lastError, startsWith('Retries exhausted'));
    });

    test('same event is not sent twice concurrently', () async {
      final gate = Completer<EventSubmitResult>();
      api.onSubmit = (_) => gate.future;
      final s = svc();
      final first = s.deliver(testEvent(), testConfig());
      expect(await s.deliver(testEvent(), testConfig()), isNull);
      gate.complete(const EventSubmitResult(eventId: 'x', status: 'delivered'));
      expect((await first)!.status, EventStatus.delivered);
    });
  });

  group('DeliveryService direct', () {
    late InMemoryEventRepository repo;
    late FakeDeviceApi api;
    final now = DateTime.utc(2026, 9, 25, 8, 31);
    final secret = 'c' * 64;

    DeliveryService svc(MockClient client) => DeliveryService(
      api: api, httpClient: client, repository: repo, clock: () => now);

    setUp(() {
      repo = InMemoryEventRepository();
      api = FakeDeviceApi();
    });

    test('signs, sends to endpoint and reports outcome to the platform', () async {
      late http.Request seen;
      final client = MockClient((req) async {
        seen = req;
        return http.Response('ok', 200);
      });
      final r = await svc(client).deliver(testEvent(), testConfig(mode: DeliveryMode.direct, secret: secret));
      expect(r!.status, EventStatus.delivered);
      expect(r.pendingReport, isNull);
      expect(seen.followRedirects, isFalse);
      expect(seen.headers['User-Agent'], 'NFCPlatform-Terminal/1.0');
      expect(
        seen.headers['X-NFC-Signature'],
        Signer.sign(secret: secret, timestamp: seen.headers['X-NFC-Timestamp']!, nonce: seen.headers['X-NFC-Nonce']!, bodyBytes: seen.bodyBytes),
      );
      expect((jsonDecode(seen.body) as Map)['delivery_mode'], 'direct');
      final report = api.submissions.single.directDelivery!;
      expect(report.success, isTrue);
      expect(report.statusCode, 200);
      expect(report.attempt, 1);
    });

    test('fresh nonce per attempt, same event id', () async {
      final nonces = <String>{};
      final ids = <String>{};
      final client = MockClient((req) async {
        nonces.add(req.headers['X-NFC-Nonce']!);
        ids.add(req.headers['X-NFC-Event-Id']!);
        return http.Response('', 500);
      });
      final s = svc(client);
      final cfg = testConfig(mode: DeliveryMode.direct, secret: secret);
      final r1 = await s.deliver(testEvent(), cfg);
      final r2 = await s.deliver(r1!, cfg);
      expect(nonces.length, 2);
      expect(ids.length, 1);
      expect(r2!.attempts, 2);
      expect(r2.status, EventStatus.queued);
      expect(api.submissions.map((e) => e.directDelivery!.attempt), [1, 2]);
    });

    test('4xx is final; redirects are not followed', () async {
      final r = await svc(MockClient((_) async => http.Response('', 400)))
          .deliver(testEvent(id: 'a'), testConfig(mode: DeliveryMode.direct, secret: secret));
      expect(r!.status, EventStatus.failed);

      final red = await svc(MockClient((_) async => http.Response('', 302, headers: {'location': 'https://evil'})))
          .deliver(testEvent(id: 'b'), testConfig(mode: DeliveryMode.direct, secret: secret));
      expect(red!.status, EventStatus.failed);
      expect(red.lastError, contains('redirect_not_followed'));
    });

    test('platform unreachable while reporting keeps the report pending', () async {
      api.onSubmit = (_) async => throw const NetworkException('down');
      final r = await svc(MockClient((_) async => http.Response('', 204)))
          .deliver(testEvent(), testConfig(mode: DeliveryMode.direct, secret: secret));
      expect(r!.status, EventStatus.delivered);
      expect(r.pendingReport, isNotNull);

      api.onSubmit = null; // platform back
      final s = svc(MockClient((_) async => fail('must not re-send to endpoint')));
      await s.flushReports();
      expect(repo.rows.values.single.pendingReport, isNull);
    });

    test('host not in allowed_domains: endpoint never contacted, failed, reported, not retried', () async {
      final r = await svc(MockClient((_) async => fail('must not contact a non-allowlisted endpoint')))
          .deliver(testEvent(), testConfig(
            mode: DeliveryMode.direct, secret: secret, allowedDomains: const ['*.example.org', 'other.com']));
      expect(r!.status, EventStatus.failed);
      expect(r.nextAttemptAt, isNull);
      expect(r.lastError, 'domain_not_allowed');
      final report = api.submissions.single.directDelivery!;
      expect(report.success, isFalse);
      expect(report.error, 'domain_not_allowed');
      expect(report.statusCode, isNull);
    });

    test('allowlisted host is delivered normally', () async {
      final r = await svc(MockClient((_) async => http.Response('', 200)))
          .deliver(testEvent(), testConfig(
            mode: DeliveryMode.direct, secret: secret, allowedDomains: const ['EXAMPLE.com']));
      expect(r!.status, EventStatus.delivered);
    });

    test('missing endpoint -> failed and reported', () async {
      final r = await svc(MockClient((_) async => fail('no call')))
          .deliver(testEvent(), testConfig(mode: DeliveryMode.direct, secret: secret, endpointUrl: null));
      expect(r!.status, EventStatus.failed);
      expect(api.submissions.single.directDelivery!.error, 'endpoint_not_configured');
    });
  });

  group('offline + RetryQueue', () {
    test('offline: queued without spending an attempt, sent by the queue when back online', () async {
      final repo = InMemoryEventRepository();
      final api = FakeDeviceApi();
      var online = false;
      var now = DateTime.utc(2026, 9, 25, 8, 31);
      final delivery = DeliveryService(
        api: api,
        httpClient: MockClient((_) async => http.Response('', 500)),
        repository: repo,
        clock: () => now,
        isOnline: () => online,
      );
      final r = await delivery.deliver(testEvent(), testConfig());
      expect(r!.status, EventStatus.queued);
      expect(r.attempts, 0);
      expect(api.submissions, isEmpty);

      online = true;
      now = now.add(const Duration(minutes: 1));
      final queue = RetryQueue(
        repository: repo, delivery: delivery, configProvider: () => testConfig(), clock: () => now);
      queue.start();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      queue.stop();
      expect(api.submissions, hasLength(1));
      expect(repo.rows.values.single.status, EventStatus.delivered);
      expect(repo.rows.values.single.attempts, 1);
    });

    test('retryNow revives a failed event for one more attempt', () async {
      final repo = InMemoryEventRepository();
      final api = FakeDeviceApi();
      final now = DateTime.utc(2026, 9, 25, 8, 31);
      final delivery = DeliveryService(
        api: api, httpClient: MockClient((_) async => http.Response('', 500)), repository: repo, clock: () => now);
      await repo.upsert(testEvent(attempts: 4).copyWith(status: EventStatus.failed, lastError: () => 'x'));
      final queue = RetryQueue(
        repository: repo, delivery: delivery, configProvider: () => testConfig(), clock: () => now)
        ..start();
      await queue.retryNow('7f1c2d3e-0000-4000-8000-000000000001');
      queue.stop();
      expect(repo.rows.values.single.status, EventStatus.delivered);
      expect(repo.rows.values.single.attempts, 5);
    });
  });
}
