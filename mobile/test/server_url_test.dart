import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/core/http_client.dart';
import 'package:nfc_terminal/core/time_utils.dart';

void main() {
  test('normalize strips slashes and /api/v1', () {
    expect(ServerUrl.normalize(' https://api.example.com/ '), 'https://api.example.com');
    expect(ServerUrl.normalize('https://api.example.com/api/v1/'), 'https://api.example.com');
  });

  test('validate', () {
    expect(ServerUrl.validate('https://api.example.com'), isNull);
    expect(ServerUrl.validate('http://10.0.2.2:8000'), isNull);
    expect(ServerUrl.validate('http://localhost:8000'), isNull);
    expect(ServerUrl.validate(''), isNotNull);
    expect(ServerUrl.validate('api.example.com'), isNotNull);
    expect(ServerUrl.validate('ftp://x.com'), isNotNull);
    expect(ServerUrl.validate('http://api.example.com'), isNotNull);
    expect(ServerUrl.validate('http://192.168.1.74:8000'), isNull);
    expect(ServerUrl.validate('http://172.20.0.5:8000'), isNull);
    expect(ServerUrl.validate('http://8.8.8.8:8000'), isNotNull);
    expect(ServerUrl.validate('http://192.168.1.74:8000', allowLan: false), isNotNull);
    expect(ServerUrl.validate('https://u:p@api.example.com'), isNotNull);
    expect(ServerUrl.isInsecure('http://10.0.2.2:8000'), isTrue);
    expect(ServerUrl.isInsecure('https://api.example.com'), isFalse);
  });

  test('isoUtc formats with Z and second precision', () {
    expect(isoUtc(DateTime.utc(2026, 9, 25, 8, 30, 21, 999)), '2026-09-25T08:30:21Z');
    expect(unixSeconds(DateTime.utc(1970, 1, 1, 0, 0, 42)), 42);
  });
}
