import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/services/domain_allowlist.dart';

void main() {
  test('domain matching table', () {
    const list = ['api.example.com', '*.example.org', '192.168.1.74'];
    final cases = <String, bool>{
      'api.example.com': true,
      'API.Example.COM': true,
      'api.example.com.': true,
      'example.com': false,
      'www.api.example.com': false,
      'evilapi.example.com': false,
      'api.example.com.evil.net': false,
      'shop.example.org': true,
      'a.b.example.org': true,
      'SHOP.EXAMPLE.ORG': true,
      'example.org': false, // wildcard does not match the apex
      'badexample.org': false,
      'example.org.evil.com': false,
      '192.168.1.74': true,
      '192.168.1.75': false,
      '': false,
    };
    cases.forEach((host, expected) {
      expect(isHostAllowed(host, list), expected, reason: host);
    });
  });

  test('empty list = no restriction; entries are case-insensitive', () {
    expect(isHostAllowed('anything.example.net', const []), isTrue);
    expect(isHostAllowed('api.example.com', const ['API.EXAMPLE.COM']), isTrue);
    expect(isHostAllowed('x.example.com', const ['*.EXAMPLE.com']), isTrue);
    expect(isHostAllowed('x.example.com', const ['*.']), isFalse);
  });
}
