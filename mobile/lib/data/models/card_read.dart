/// A card detection. Only the UID is read: it is an identifier, not proof of
/// identity (`security.level = "uid_only"`).
class CardRead {
  const CardRead({
    required this.uid,
    required this.technologies,
    required this.type,
    required this.detectedAt,
  });

  /// Uppercase hex, no separators.
  final String uid;

  /// Short Android tech names, e.g. `["NfcA", "MifareUltralight"]`.
  final List<String> technologies;

  /// One of [CardType] values.
  final String type;
  final DateTime detectedAt;

  int get uidLength => uid.length ~/ 2;
}

/// Card type identifiers (contract `card.type`).
class CardType {
  CardType._();
  static const mifareClassic = 'mifare_classic';
  static const mifareUltralight = 'mifare_ultralight';
  static const ntag = 'ntag';
  static const isoDep = 'iso_dep';
  static const felica = 'felica';
  static const iso15693 = 'iso15693';
  static const unknown = 'unknown';
}

/// Pure helpers for UIDs and technologies. No platform dependencies.
class CardUtils {
  CardUtils._();

  static final _hexOnly = RegExp(r'^[0-9A-F]*$');
  static final _separators = RegExp(r'[\s:\-]');

  /// Bytes → uppercase hex without separators.
  static String bytesToHex(List<int> bytes) => bytes
      .map((b) => (b & 0xff).toRadixString(16).padLeft(2, '0'))
      .join()
      .toUpperCase();

  /// Uppercases and strips `:`, `-` and whitespace. Returns null if the result
  /// is not valid per the server rule `^[0-9A-F]{4,64}$`.
  static String? normalizeUid(String input) {
    final s = input.replaceAll(_separators, '').toUpperCase();
    if (s.length < 4 || s.length > 64 || !_hexOnly.hasMatch(s)) return null;
    return s;
  }

  /// `04A1B2C3` → `04:A1:B2:C3` (display only).
  static String formatUid(String uid) {
    final s = uid.replaceAll(_separators, '').toUpperCase();
    final parts = <String>[];
    for (var i = 0; i < s.length; i += 2) {
      parts.add(s.substring(i, i + 2 > s.length ? s.length : i + 2));
    }
    return parts.join(':');
  }

  /// `android.nfc.tech.NfcA` → `NfcA`.
  static String shortTechName(String tech) {
    final i = tech.lastIndexOf('.');
    return i >= 0 ? tech.substring(i + 1) : tech;
  }

  /// SAK values of MIFARE Classic family (1K, 4K, Mini, Plus in SL1, emulations).
  static const _classicSaks = {0x08, 0x09, 0x10, 0x11, 0x18, 0x28, 0x38, 0x88, 0x98, 0xB8};

  /// Best-effort guess of the card family from what Android reports.
  ///
  /// [sak] is the NFC-A SAK byte if known. [ultralightProductType] is byte 2 of
  /// a GET_VERSION response for Type 2 tags (0x03 Ultralight, 0x04 NTAG).
  static String guessCardType({
    required List<String> technologies,
    int? sak,
    int? ultralightProductType,
  }) {
    final t = technologies.map(shortTechName).toSet();
    if (t.contains('MifareClassic')) return CardType.mifareClassic;
    if (t.contains('MifareUltralight') ||
        (t.contains('NfcA') && sak == 0x00 && !t.contains('IsoDep'))) {
      return ultralightProductType == 0x04 ? CardType.ntag : CardType.mifareUltralight;
    }
    if (t.contains('NfcA') && sak != null && _classicSaks.contains(sak) && !t.contains('IsoDep')) {
      return CardType.mifareClassic;
    }
    if (t.contains('IsoDep')) return CardType.isoDep;
    if (t.contains('NfcF')) return CardType.felica;
    if (t.contains('NfcV')) return CardType.iso15693;
    return CardType.unknown;
  }
}
