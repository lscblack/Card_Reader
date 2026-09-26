import 'package:nfc_terminal/data/models/design_presets.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/data/personal_api.dart';
import 'package:nfc_terminal/services/digital_card_scanner.dart';
import 'package:nfc_terminal/services/hce_bridge.dart';

import 'personal_fixtures.dart';

class FakeHce implements HceBridge {
  bool supported = true;
  bool enabled = false;
  Map<String, Object?>? cache;
  final calls = <String>[];

  @override
  Future<bool> isSupported() async => supported;
  @override
  Future<void> setCache({required String shareId, required int keyId, required String secret, String? publicUrl,
      required bool webPageEnabled, required bool nfcSharingEnabled}) async {
    calls.add('setCache');
    cache = {'share_id': shareId, 'key_id': keyId, 'secret': secret, 'public_url': publicUrl,
      'web_page_enabled': webPageEnabled, 'nfc_sharing_enabled': nfcSharingEnabled};
  }
  @override
  Future<void> clearCache() async {
    calls.add('clear');
    cache = null;
  }
  @override
  Future<void> setEnabled(bool e) async {
    calls.add('enabled:$e');
    enabled = e;
  }
  @override
  Future<bool> isEnabled() async => enabled;
  @override
  Future<void> setPreferred(bool preferred) async => calls.add('preferred:$preferred');
}

class FakePersonalApi implements PersonalApi {
  FakePersonalApi({this.baseUrl = 'https://api.example.com', this.sessionToken});

  @override
  final String baseUrl;
  @override
  String? sessionToken;

  List<DigitalCard> serverCards = [DigitalCard.fromJson(cardJson())];
  final patches = <Map<String, Object?>>[];
  final exchanges = <String>[];
  Object? signInError;
  Object? exchangeError;
  Object? cardsError;
  bool mutual = true;
  String? lastLoginCode;
  SessionDevice? lastDevice;
  final revoked = <String>[];

  SessionGrant _grant() => SessionGrant(
    token: 'nfcs_testtoken',
    session: const PersonalSession(id: 'sess-1', deviceName: 'Pixel 8'),
    user: const PersonalUser(id: 'u1', email: 'jane@example.com', fullName: 'Jane'),
    shareKey: const ShareKey(keyId: 7, secret: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'),
    cards: serverCards,
  );

  @override
  Future<SessionGrant> signIn({required String email, required String password, required SessionDevice device}) async {
    if (signInError != null) throw signInError!;
    lastDevice = device;
    return _grant();
  }

  @override
  Future<SessionGrant> signInWithCode({required String loginCode, required SessionDevice device}) async {
    if (signInError != null) throw signInError!;
    lastLoginCode = loginCode;
    return _grant();
  }

  @override
  Future<void> registerAccount({required String fullName, required String email, required String password, String? phone}) async {}
  @override
  Future<List<PersonalSession>> sessions() async => const [PersonalSession(id: 'sess-1'), PersonalSession(id: 'sess-2', deviceName: 'Laptop')];
  @override
  Future<void> revokeSession(String id) async => revoked.add(id);
  @override
  Future<void> heartbeat() async {}
  @override
  Future<List<DigitalCard>> cards() async {
    if (cardsError != null) throw cardsError!;
    return serverCards;
  }
  @override
  Future<DigitalCard> createCard({String label = 'New card', String? templateId}) async =>
      DigitalCard.fromJson(cardJson(id: 'new', primary: false));
  @override
  Future<DigitalCard> updateCard(String id, Map<String, Object?> patch) async {
    patches.add(patch);
    final base = serverCards.firstWhere((c) => c.id == id).raw;
    final merged = {...base, ...patch};
    if (patch['fields'] is Map) merged['fields'] = {...(base['fields'] as Map), ...(patch['fields'] as Map)};
    final c = DigitalCard.fromJson(merged);
    serverCards = [for (final x in serverCards) x.id == id ? c : x];
    return c;
  }
  @override
  Future<void> deleteCard(String id) async => serverCards = serverCards.where((c) => c.id != id).toList();
  @override
  Future<DigitalCard> setPrimary(String id) async =>
      DigitalCard.fromJson({...serverCards.firstWhere((c) => c.id == id).raw, 'is_primary': true});
  @override
  Future<DigitalCard> rotateShareId(String id) async =>
      DigitalCard.fromJson({...serverCards.firstWhere((c) => c.id == id).raw, 'share_id': '00000000-0000-4000-8000-000000000009'});
  @override
  Future<DigitalCard> duplicateCard(String id) async => DigitalCard.fromJson(cardJson(id: 'dup', primary: false));
  @override
  Future<DigitalCard?> uploadImage(String id, String kind, String filePath) async =>
      DigitalCard.fromJson({...serverCards.firstWhere((c) => c.id == id).raw, '${kind}_url': 'https://img.example/$kind.jpg'});
  @override
  Future<void> deleteImage(String id, String kind) async {}
  @override
  Future<List<CardTemplate>> templates() async => serverTemplates ?? CardTemplate.builtIn;
  List<CardTemplate>? serverTemplates;
  DesignPresets presets = DesignPresets.fallback;
  @override
  Future<DesignPresets> designPresets() async => presets;
  @override
  Future<String> exchangeQr(String cardId) async => 'nfcterminal://card?v=1&t=x';
  String? lastVia;

  @override
  Future<ExchangeResult> exchange(String token, {String? via}) async {
    exchanges.add(token);
    lastVia = via;
    if (exchangeError != null) throw exchangeError!;
    return ExchangeResult(
      contact: Contact.fromJson({
        'id': 'ct1', 'source': 'nfc_exchange', 'card': {...cardJson(name: 'Paul Otieno'), 'template_id': 'split'},
        'tags': ['event'], 'favorite': false, 'live': true,
      }),
      mutual: mutual,
      alreadyConnected: false,
    );
  }
  @override
  Future<List<Contact>> contacts({String? query, String? tag, bool? favorite}) async => [
    Contact.fromJson({'id': 'ct1', 'source': 'nfc_exchange', 'card': cardJson(name: 'Paul Otieno'), 'tags': ['event'], 'favorite': true}),
    Contact.fromJson({'id': 'ct2', 'source': 'web_lead', 'card': {'fields': {'full_name': 'Lead Person'}}}),
  ].where((c) => query == null || query.isEmpty || c.name.toLowerCase().contains(query.toLowerCase())).toList();
  @override
  Future<Contact> updateContact(String id, Map<String, Object?> patch) async =>
      Contact.fromJson({'id': id, 'source': 'manual', 'card': cardJson(), ...patch});
  @override
  Future<void> deleteContact(String id) async {}
  @override
  Future<String> contactVcard(String id) async => 'BEGIN:VCARD\nEND:VCARD';
  @override
  Future<List<ActivityItem>> activity() async => [ActivityItem.fromJson({'type': 'exchange', 'title': 'You exchanged cards with Paul'})];
  @override
  Future<List<BusinessInvite>> businessInvites() async => [BusinessInvite.fromJson({'id': 'i1', 'business_name': 'Acme Café'})];
  @override
  Future<void> respondToInvite(String id, {required bool accept}) async {}
}

class FakeScanner implements DigitalCardScanner {
  FakeScanner(this.result);
  Future<String> Function() result;
  @override
  Future<String> scanToken({Duration timeout = const Duration(seconds: 60)}) => result();
  @override
  Future<void> cancel() async {}
}
