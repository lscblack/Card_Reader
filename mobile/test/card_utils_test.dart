import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_terminal/data/models/card_read.dart';

void main() {
  group('UID normalisation / formatting', () {
    test('bytesToHex is uppercase without separators', () {
      expect(CardUtils.bytesToHex([0x04, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5]), '04A1B2C3D4E5');
      expect(CardUtils.bytesToHex([0x00, 0x0f, 0xff]), '000FFF');
    });

    test('normalizeUid uppercases and strips separators', () {
      expect(CardUtils.normalizeUid('04:a1:b2:c3'), '04A1B2C3');
      expect(CardUtils.normalizeUid(' 04 a1-b2 c3 '), '04A1B2C3');
    });

    test('normalizeUid rejects invalid values (server rule ^[0-9A-F]{4,64}\$)', () {
      expect(CardUtils.normalizeUid(''), isNull);
      expect(CardUtils.normalizeUid('04A'), isNull);
      expect(CardUtils.normalizeUid('04ZZ'), isNull);
      expect(CardUtils.normalizeUid('A' * 65), isNull);
      expect(CardUtils.normalizeUid('A' * 64), 'A' * 64);
    });

    test('formatUid adds colons for display', () {
      expect(CardUtils.formatUid('04A1B2C3D4E5'), '04:A1:B2:C3:D4:E5');
      expect(CardUtils.formatUid('04a1b'), '04:A1:B');
      expect(CardUtils.formatUid(''), '');
    });

    test('shortTechName strips the Android package', () {
      expect(CardUtils.shortTechName('android.nfc.tech.NfcA'), 'NfcA');
      expect(CardUtils.shortTechName('IsoDep'), 'IsoDep');
    });

    test('uidLength counts bytes', () {
      final c = CardRead(uid: '04A1B2C3D4E5', technologies: const [], type: 'unknown', detectedAt: DateTime.now());
      expect(c.uidLength, 6);
    });
  });

  group('guessCardType', () {
    String g(List<String> t, {int? sak, int? pt}) =>
        CardUtils.guessCardType(technologies: t, sak: sak, ultralightProductType: pt);

    test('explicit Android techs', () {
      expect(g(['android.nfc.tech.NfcA', 'android.nfc.tech.MifareClassic'], sak: 0x08), CardType.mifareClassic);
      expect(g(['NfcA', 'MifareUltralight'], sak: 0x00), CardType.mifareUltralight);
      expect(g(['NfcA', 'MifareUltralight'], sak: 0x00, pt: 0x04), CardType.ntag);
      expect(g(['NfcA', 'IsoDep'], sak: 0x20), CardType.isoDep);
      expect(g(['NfcB', 'IsoDep']), CardType.isoDep);
      expect(g(['NfcF']), CardType.felica);
      expect(g(['NfcV']), CardType.iso15693);
    });

    test('SAK fallback on phones without NXP MIFARE support', () {
      expect(g(['NfcA'], sak: 0x08), CardType.mifareClassic);
      expect(g(['NfcA'], sak: 0x18), CardType.mifareClassic);
      expect(g(['NfcA'], sak: 0x00), CardType.mifareUltralight);
      expect(g(['NfcA'], sak: 0x00, pt: 0x04), CardType.ntag);
    });

    test('unknown when nothing matches', () {
      expect(g(['NfcA'], sak: 0x40), CardType.unknown);
      expect(g(['NfcBarcode']), CardType.unknown);
      expect(g([]), CardType.unknown);
    });
  });
}
