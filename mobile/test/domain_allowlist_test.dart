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

  group('isActionUrlAllowed (links returned by an endpoint)', () {
    const list = ['app.example.com', '*.example.org'];
    final cases = <String, bool>{
      'https://app.example.com/assign?card=04A1&session=7': true,
      'https://APP.Example.com/x': true,
      'https://app.example.com:443/x': true,
      'https://shop.example.org/x': true,
      'https://a.b.example.org': true,
      'http://app.example.com/x': false, // not https
      'HTTP://app.example.com/x': false,
      'javascript:alert(1)': false,
      'intent://app.example.com/#Intent;scheme=https;end': false,
      'ftp://app.example.com/x': false,
      '//app.example.com/x': false, // no scheme
      'app.example.com/x': false,
      'https://example.org/x': false, // wildcard is subdomains only
      'https://evil.com/x': false,
      'https://app.example.com.evil.com/x': false, // lookalike suffix
      'https://evilapp.example.com/x': false,
      'https://xapp.example.com/x': false,
      'https://app-example.com/x': false,
      'https://app.example.com@evil.com/x': false, // userinfo trick
      'https://evil.com@app.example.com/x': false, // userinfo, even though the real host is allowed
      'https://app.example.com:pw@app.example.com/x': false,
      'https://app.example.com:8443/x': false, // unexpected port
      r'https://app.example.com\@evil.com/x': false, // backslash
      r'https://app.example.com\.evil.com/x': false,
      'https://app.example.com /x': false, // whitespace
      'https://app.example.com/x\n': true, // trailing whitespace is trimmed
      'https://app.example.com/x?next=https://evil.com': true, // query is not the host
      'https://': false,
      '': false,
    };
    test('url table', () {
      cases.forEach((url, expected) {
        expect(isActionUrlAllowed(url, list), expected, reason: url);
      });
    });

    test('an empty list never opens anything; null is refused', () {
      expect(isActionUrlAllowed('https://app.example.com/x', const []), isFalse);
      expect(isActionUrlAllowed(null, list), isFalse);
    });
  });
}
