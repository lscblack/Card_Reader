import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/personal_api.dart';

void main() {
  group('HttpPersonalApi.uploadImage', () {
    late File photo;
    setUpAll(() async {
      photo = File('${(await Directory.systemTemp.createTemp('nfc_upload')).path}/p.jpg')..writeAsBytesSync([1, 2, 3]);
    });

    HttpPersonalApi api(MockClientHandler h, {void Function(ApiException)? onUnauthorized}) => HttpPersonalApi(
      client: MockClient(h),
      baseUrl: 'https://api.example.com/',
      sessionToken: 'nfcs_x',
      onUnauthorized: onUnauthorized,
    );

    test('sends multipart to /api/v1/personal/cards/{id}/images?kind= with the session token', () async {
      late http.Request seen;
      final a = api((r) async {
        seen = r;
        return http.Response('{"id":"c1","share_id":"3b241101-e2bb-4255-8caf-4136c566a962"}', 200);
      });
      final card = await a.uploadImage('c1', 'photo', photo.path);
      expect(seen.url.toString(), 'https://api.example.com/api/v1/personal/cards/c1/images?kind=photo');
      expect(seen.headers['Authorization'], 'Bearer nfcs_x');
      expect(card!.id, 'c1');
    });

    test('401 (session revoked) signs the personal space out like every other call', () async {
      ApiException? seen;
      final a = api(
        (_) async => http.Response('{"error":{"code":"invalid_session_token","message":"Invalid session token","ref":"NFC-1019"}}', 401),
        onUnauthorized: (e) => seen = e,
      );
      await expectLater(a.uploadImage('c1', 'photo', photo.path), throwsA(isA<ApiException>()));
      expect(seen?.code, 'invalid_session_token');
    });

    test('connection errors become NetworkException (handled by the UI), not a raw ClientException', () async {
      final a = api((_) async => throw http.ClientException('Connection reset'));
      await expectLater(a.uploadImage('c1', 'photo', photo.path), throwsA(isA<NetworkException>()));
    });

    test('a 2xx body that is not JSON means "uploaded, refresh" instead of a FormatException', () async {
      final a = api((_) async => http.Response('OK', 201));
      expect(await a.uploadImage('c1', 'photo', photo.path), isNull);
    });
  });
}
