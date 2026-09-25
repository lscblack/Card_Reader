import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/core/pairing.dart';

const _code = 'nfcp_AbCdEfGhIjKlMnOpQrStUvWxYz012345';

String _link({String v = '1', String? server = 'https://api.example.com', String? code = _code, String? name}) {
  final q = <String, String>{
    'v': v,
    // ignore: use_null_aware_elements
    if (server != null) 'server': server,
    // ignore: use_null_aware_elements
    if (code != null) 'code': code,
    // ignore: use_null_aware_elements
    if (name != null) 'name': name,
  };
  return Uri(scheme: 'nfcterminal', host: 'pair', queryParameters: q).toString();
}

void main() {
  test('parses a valid payload (contract example shape)', () {
    final p = PairingPayload.parse(
      'nfcterminal://pair?v=1&server=http%3A%2F%2F192.168.1.74%3A8000&code=$_code&name=Front%20desk',
      allowLan: true,
    );
    expect(p.serverUrl, 'http://192.168.1.74:8000');
    expect(p.serverHost, '192.168.1.74:8000');
    expect(p.code, _code);
    expect(p.deviceName, 'Front desk');
    expect(p.isInsecure, isTrue);
    expect(p.toString(), isNot(contains(_code)));
  });

  test('name is optional; server is normalised', () {
    final p = PairingPayload.parse(_link(server: 'https://api.example.com/api/v1/'));
    expect(p.deviceName, isNull);
    expect(p.serverUrl, 'https://api.example.com');
    expect(p.serverHost, 'api.example.com');
    expect(p.isInsecure, isFalse);
  });

  void rejects(String raw, String why, {bool allowLan = false}) => expect(
    () => PairingPayload.parse(raw, allowLan: allowLan),
    throwsA(isA<PairingFormatException>()),
    reason: why,
  );

  test('rejects invalid payloads', () {
    rejects(_link(code: null), 'missing code');
    rejects(_link(code: 'nfc_notapairingcode_1234567890'), 'API key instead of pairing code');
    rejects(_link(code: 'nfcp_short'), 'too short');
    rejects(_link(server: null), 'missing server');
    rejects(_link(server: 'not a url'), 'bad server');
    rejects(_link(server: 'ftp://api.example.com'), 'bad scheme');
    rejects(_link(server: 'http://api.example.com'), 'http public host');
    rejects(_link(server: 'http://api.example.com'), 'http public host even with LAN allowed', allowLan: true);
    rejects(_link(server: 'http://192.168.1.74:8000'), 'LAN http outside debug', allowLan: false);
    rejects(_link(v: '2'), 'unknown version');
    rejects(_link(v: ''), 'missing version');
    rejects('https://example.com/pair?v=1&code=$_code', 'wrong scheme');
    rejects('nfcterminal://other?v=1&server=https%3A%2F%2Fa.com&code=$_code', 'wrong host');
    rejects('hello world', 'garbage');
  });

  test('plain http to local dev hosts is allowed', () {
    expect(PairingPayload.parse(_link(server: 'http://10.0.2.2:8000')).serverHost, '10.0.2.2:8000');
    expect(PairingPayload.parse(_link(server: 'http://192.168.1.74:8000'), allowLan: true).serverHost,
        '192.168.1.74:8000');
  });
}
