import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/core/digital_card_token.dart';
import 'package:nfc_terminal/core/links.dart';

String _hex(List<int> b) => b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

void main() {
  // Vectors computed independently with Python (hmac/hashlib/uuid/struct), shared with the
  // Kotlin JVM test android/app/src/test/.../ApduHandlerTest.kt:
  //   head = b'\x01' + uuid.bytes + struct.pack('>I', key_id) + struct.pack('>I', issued_at)
  //   token = head + hmac.new(secret, head, sha256).digest()[:16]
  group('official vectors (PART4_CONTRACT.md §3, backend/app/services/card_tokens.py)', () {
    const vectors = [
      ('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8', '00112233-4455-6677-8899-aabbccddeeff', 1, 1790000000,
          'AQARIjNEVWZ3iJmqu8zd7v8AAAABarE7gDqfF63howUbVssouoR5VwM'),
      ('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo', '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', 305419896, 1800000123,
          'AX8cLT5LWkxtjp8KGyw9Tl8SNFZ4a0nSe8Fk1b4SfbhyWc78tVbqa8M'),
      ('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU', 'c0ffee00-0000-4000-8000-000000000001', 4294967295, 0,
          'AcD_7gAAAEAAgAAAAAAAAAH_____AAAAAOkYlkbhvHUFoqWI5pKkMEE'),
    ];
    for (final (i, v) in vectors.indexed) {
      test('vector ${i + 1}', () {
        final t = DigitalCardToken.generate(
          shareId: v.$2, keyId: v.$3, issuedAt: v.$4, secret: DigitalCardToken.decodeSecret(v.$1));
        expect(DigitalCardToken.encode(t), v.$5);
        expect(DigitalCardToken.encode(DigitalCardToken.decode(v.$5)!), v.$5);
      });
    }

    test('vector 1 cross-check: signed bytes and 48-byte HCE response', () {
      final t = DigitalCardToken.decode('AQARIjNEVWZ3iJmqu8zd7v8AAAABarE7gDqfF63howUbVssouoR5VwM')!;
      expect(_hex(t.sublist(0, 25)), '0100112233445566778899aabbccddeeff000000016ab13b80');
      final hce = [...ascii.encode('NFCDC'), ...t, 0x90, 0x00];
      expect(hce.length, 48);
      expect(DigitalCardToken.parseSelectResponse(hce), 'AQARIjNEVWZ3iJmqu8zd7v8AAAABarE7gDqfF63howUbVssouoR5VwM');
    });
  });

  group('extra vectors (computed independently with Python)', () {
    test('vector 1', () {
      final t = DigitalCardToken.generate(
        shareId: '3b241101-e2bb-4255-8caf-4136c566a962',
        keyId: 7,
        issuedAt: 1790000000,
        secret: DigitalCardToken.decodeSecret('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'),
      );
      expect(t.length, 41);
      expect(_hex(t), '013b241101e2bb42558caf4136c566a962000000076ab13b80cf748bc914257d695f4953c2a439c205');
      final text = DigitalCardToken.encode(t);
      expect(text, 'ATskEQHiu0JVjK9BNsVmqWIAAAAHarE7gM90i8kUJX1pX0lTwqQ5wgU');
      expect(text.length, 55);
    });

    test('vector 2 (max key id, 0xFF secret)', () {
      final t = DigitalCardToken.generate(
        shareId: '00000000-0000-4000-8000-000000000001',
        keyId: 4294967295,
        issuedAt: 1758789021,
        secret: List.filled(32, 0xFF),
      );
      expect(_hex(t), '0100000000000040008000000000000001ffffffff68d4fd9d3ce996b7bc9c0f1da3ed154c6dd3c1f6');
      expect(DigitalCardToken.encode(t), 'AQAAAAAAAEAAgAAAAAAAAAH_____aNT9nTzplre8nA8do-0VTG3TwfY');
      expect(DigitalCardToken.decodeSecret('__________________________________________8'), List.filled(32, 0xFF));
    });

    test('decode / share id / issued_at', () {
      const text = 'ATskEQHiu0JVjK9BNsVmqWIAAAAHarE7gM90i8kUJX1pX0lTwqQ5wgU';
      expect(DigitalCardToken.shareIdHex(text), '3B241101E2BB42558CAF4136C566A962');
      expect(DigitalCardToken.issuedAt(text), 1790000000);
      expect(DigitalCardToken.decode('short'), isNull);
      expect(DigitalCardToken.decode(base64Url.encode(List.filled(41, 2)).replaceAll('=', '')), isNull, reason: 'bad version');
      expect(() => DigitalCardToken.generate(shareId: 'nope', keyId: 1, issuedAt: 1, secret: [1]), throwsFormatException);
      expect(() => DigitalCardToken.generate(shareId: '00000000-0000-4000-8000-000000000001', keyId: -1, issuedAt: 1, secret: [1]),
          throwsRangeError);
    });
  });

  group('SELECT response parsing (reader side)', () {
    final token = DigitalCardToken.generate(
      shareId: '3b241101-e2bb-4255-8caf-4136c566a962', keyId: 7, issuedAt: 1790000000, secret: List.generate(32, (i) => i));

    test('NFCDC + token + 9000 → token', () {
      final r = [...ascii.encode('NFCDC'), ...token, 0x90, 0x00];
      expect(DigitalCardToken.parseSelectResponse(r), 'ATskEQHiu0JVjK9BNsVmqWIAAAAHarE7gM90i8kUJX1pX0lTwqQ5wgU');
    });

    test('anything else → null (UID flow)', () {
      expect(DigitalCardToken.parseSelectResponse([0x6A, 0x82]), isNull);
      expect(DigitalCardToken.parseSelectResponse([...ascii.encode('NFCDX'), ...token, 0x90, 0x00]), isNull);
      expect(DigitalCardToken.parseSelectResponse([...ascii.encode('NFCDC'), ...token, 0x6A, 0x82]), isNull);
      expect(DigitalCardToken.parseSelectResponse([...ascii.encode('NFCDC'), ...token.sublist(1), 0x90, 0x00]), isNull);
      expect(DigitalCardToken.parseSelectResponse(const []), isNull);
    });

    test('SELECT APDU bytes', () {
      expect(_hex(DigitalCardToken.selectApdu).toUpperCase(), '00A4040007F04E464344430100');
    });
  });

  group('links', () {
    test('login QR', () {
      final p = LoginPayload.parse(
        'nfcterminal://login?v=1&server=https%3A%2F%2Fapi.example.com&code=nfcl_AbCdEfGhIjKlMnOpQrStUv');
      expect(p.serverUrl, 'https://api.example.com');
      expect(p.code, startsWith('nfcl_'));
      expect(p.toString(), isNot(contains('AbCdEf')));
      for (final bad in [
        'nfcterminal://login?v=2&server=https%3A%2F%2Fa.com&code=nfcl_AbCdEfGhIjKlMnOpQrStUv',
        'nfcterminal://login?v=1&server=https%3A%2F%2Fa.com&code=nfcp_AbCdEfGhIjKlMnOpQrStUv',
        'nfcterminal://login?v=1&server=http%3A%2F%2Fevil.com&code=nfcl_AbCdEfGhIjKlMnOpQrStUv',
        'nfcterminal://pair?v=1&server=https%3A%2F%2Fa.com&code=nfcl_AbCdEfGhIjKlMnOpQrStUv',
      ]) {
        expect(() => LoginPayload.parse(bad), throwsA(isA<LinkFormatException>()), reason: bad);
      }
    });

    test('card exchange QR', () {
      const t = 'ATskEQHiu0JVjK9BNsVmqWIAAAAHarE7gM90i8kUJX1pX0lTwqQ5wgU';
      expect(CardQrPayload.parse('nfcterminal://card?v=1&t=$t').token, t);
      expect(() => CardQrPayload.parse('nfcterminal://card?v=1&t=abc'), throwsA(isA<LinkFormatException>()));
      expect(() => CardQrPayload.parse('https://x/card?v=1&t=$t'), throwsA(isA<LinkFormatException>()));
    });
  });
}
