import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/core/countries.dart';
import 'package:nfc_terminal/core/links.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/personal.dart';
import 'package:nfc_terminal/data/personal_api.dart';
import 'package:nfc_terminal/services/personal_state.dart';
import 'package:nfc_terminal/ui/personal/country_gate_screen.dart';
import 'package:nfc_terminal/ui/personal/personal_auth_screen.dart';
import 'package:nfc_terminal/ui/personal/personal_settings_screen.dart';
import 'package:provider/provider.dart';

import 'fakes.dart';
import 'personal_fakes.dart';

const _server = 'https://api.example.com';

const _replace = SignInChallenge(
  challengeId: 'ch-1',
  existingSession: ExistingSession(deviceName: 'Galaxy S21', lastSeenAt: '2026-09-27T10:00:00Z'),
);
const _otp = SignInChallenge(challengeId: 'ch-2', otpRequired: true, otpSentTo: 'ja••@example.com', devCode: '123456',
    existingSession: ExistingSession(deviceName: 'Galaxy S21'));

class _Harness {
  _Harness() {
    state = PersonalState(
      store: store,
      httpClient: MockClient((_) async => http.Response('', 404)),
      platform: FakePlatformInfo(),
      hce: FakeHce(),
      apiFactory: (base, token, onUnauthorized) {
        api.sessionToken = token;
        unauthorized = onUnauthorized;
        return api;
      },
    );
  }

  final store = MemorySecureStore();
  final api = FakePersonalApi();
  late final PersonalState state;
  void Function(ApiException)? unauthorized;
}

Widget _host(PersonalState p, Widget child) =>
    ChangeNotifierProvider.value(value: p, child: MaterialApp(home: child));

void main() {
  group('PersonalState sign-in steps', () {
    test('202 confirm → confirm → signed in like a normal sign-in', () async {
      final h = _Harness()..api.confirmChallenge = _replace;
      await h.state.init();
      expect(await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw'), isNull);
      expect(h.state.signedIn, isFalse);
      expect(h.state.challenge?.existingSession?.deviceName, 'Galaxy S21');
      expect(h.store.values.containsKey('personal_session_token'), isFalse);

      expect(await h.state.confirmSignIn(), isNull);
      expect(h.state.signedIn, isTrue);
      expect(h.state.challenge, isNull);
      expect(h.api.lastConfirmCode, isNull, reason: 'no code when none is required');
      expect(h.store.values['personal_session_token'], 'nfcs_testtoken');
      expect(h.store.values['personal_share_key'], contains('"key_id":7'));
    });

    test('wrong emailed code keeps the step with a message; the right one signs in', () async {
      final h = _Harness()..api.confirmChallenge = _otp;
      await h.state.init();
      await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw');
      final err = await h.state.confirmSignIn(code: '000000');
      expect(err!.message, 'That code is not right. Check the email and try again.');
      expect(h.state.challenge, isNotNull);
      expect(await h.state.confirmSignIn(code: '123456'), isNull);
      expect(h.state.signedIn, isTrue);
    });

    test('expired / too many attempts go back to the first step', () async {
      final h = _Harness()..api.confirmChallenge = _otp;
      await h.state.init();
      await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw');
      h.api.confirmError = const ApiException(statusCode: 429, code: 'too_many_attempts', message: 'x');
      final err = await h.state.confirmSignIn(code: '111111');
      expect(err!.message, 'Too many wrong codes. Please sign in again.');
      expect(h.state.challenge, isNull);
      expect(h.state.signedIn, isFalse);
    });

    test('QR login code can need the confirmation too', () async {
      final h = _Harness()..api.confirmChallenge = _replace;
      await h.state.init();
      await h.state.signInWithCode(
          LoginPayload.parse('nfcterminal://login?v=1&server=https%3A%2F%2Fapi.example.com&code=nfcl_AbCdEfGhIjKlMnOpQrStUv'));
      expect(h.state.challenge, isNotNull);
      expect(await h.state.confirmSignIn(), isNull);
      expect(h.state.signedIn, isTrue);
    });

    test('email-code sign-in: request → code → signed in (device fields sent)', () async {
      final h = _Harness();
      await h.state.init();
      expect(await h.state.requestEmailCode(server: _server, email: 'jane@example.com'), isNull);
      expect(h.api.lastEmailCodeEmail, 'jane@example.com');
      expect(h.state.emailCode?.sentTo, 'ja••@example.com');
      expect((await h.state.signInWithEmailCode('999999'))!.message, contains('not right'));
      expect(h.state.emailCode, isNotNull);
      expect(await h.state.signInWithEmailCode('123456'), isNull);
      expect(h.state.signedIn, isTrue);
      expect(h.api.lastDevice!.installationId, isNotEmpty);
      expect(h.state.emailCode, isNull);
    });

    test('email-code sign-in that replaces another phone asks for confirmation', () async {
      final h = _Harness()..api.confirmChallenge = _replace;
      await h.state.init();
      await h.state.requestEmailCode(server: _server, email: 'jane@example.com');
      expect(await h.state.signInWithEmailCode('123456'), isNull);
      expect(h.state.emailCode, isNull);
      expect(h.state.challenge?.challengeId, 'ch-1');
      expect(await h.state.confirmSignIn(), isNull);
      expect(h.state.signedIn, isTrue);
    });

    test('resend updates the dev code', () async {
      final h = _Harness()..api.confirmChallenge = _otp;
      await h.state.init();
      await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw');
      expect(await h.state.resendSignInCode(), isNull);
      expect(h.api.resends, 1);
      expect(h.state.challenge!.devCode, '654321');
    });

    test('session_replaced signs out locally with the "another phone" message', () async {
      final h = _Harness();
      await h.state.init();
      await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw');
      h.unauthorized!(const ApiException(statusCode: 401, code: 'session_replaced', message: 'x', ref: 'NFC-1023'));
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(h.state.signedIn, isFalse);
      expect(h.state.notice, 'You were signed out because your account signed in on another phone.');
      expect(h.api.revoked, isEmpty, reason: 'local sign-out only');
      expect(h.store.values.containsKey('personal_session_token'), isFalse);
    });

    test('country gate: needed when the account has no country; saving it clears the gate', () async {
      final h = _Harness()..api.user = const PersonalUser(id: 'u1', email: 'jane@example.com', fullName: 'Jane');
      await h.state.init();
      await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw');
      expect(h.state.needsCountry, isTrue);
      expect(await h.state.setCountry('KE'), isNull);
      expect(h.api.accountPatches.single, {'country': 'KE'});
      expect(h.state.needsCountry, isFalse);
      expect(h.store.values['personal_user'], contains('"country":"KE"'));
    });

    test('a cached user from before countries existed does not show the gate until the server says so', () async {
      final h = _Harness();
      h.store.values
        ..['personal_session_token'] = 'nfcs_x'
        ..['personal_server_url'] = _server
        ..['personal_user'] = '{"id":"u1","email":"jane@example.com","full_name":"Jane"}';
      await h.state.init();
      expect(h.state.needsCountry, isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 20)); // refresh() → GET /personal/account
      expect(h.state.user!.country, 'RW');
      expect(h.state.needsCountry, isFalse);
    });
  });

  group('HttpPersonalApi sign-in answers', () {
    const device = SessionDevice(deviceName: 'Pixel', model: 'Pixel 8', osVersion: '15', appVersion: '1', installationId: 'inst-12345678');

    test('201 → SignedIn, 202 → NeedsConfirmation', () async {
      var confirm = false;
      final a = HttpPersonalApi(
        baseUrl: _server,
        client: MockClient((r) async => confirm
            ? http.Response('{"status":"confirm","challenge_id":"c1","otp_required":true,"otp_sent_to":"ja••@example.com",'
                '"existing_session":{"kind":"mobile","device_name":"Galaxy","last_seen_at":null},"dev_code":"123456"}', 202,
                headers: {'content-type': 'application/json; charset=utf-8'})
            : http.Response('{"status":"ok","session_token":"nfcs_abc","session":{"id":"s1"},"user":{"id":"u1","email":"a@b.c",'
                '"country":"rw","avatar_url":"https://x/a.jpg"},"share_key":{"key_id":1,"secret":"AA"},"cards":[]}', 201)),
      );
      final ok = await a.signIn(email: 'a@b.c', password: 'pw', device: device);
      expect(ok, isA<SignedIn>());
      final u = (ok as SignedIn).grant.user;
      expect(u.country, 'RW');
      expect(u.avatarUrl, 'https://x/a.jpg');
      confirm = true;
      final r = await a.signIn(email: 'a@b.c', password: 'pw', device: device);
      final c = (r as NeedsConfirmation).challenge;
      expect(c.challengeId, 'c1');
      expect(c.otpRequired, isTrue);
      expect(c.otpSentTo, 'ja••@example.com');
      expect(c.existingSession!.deviceName, 'Galaxy');
      expect(c.devCode, '123456');
    });

    test('email-code sign-in sends the challenge id, the code and the device fields', () async {
      late Map body;
      final a = HttpPersonalApi(
        baseUrl: _server,
        client: MockClient((r) async {
          body = jsonDecode(r.body) as Map;
          return http.Response('{"status":"confirm","challenge_id":"c9","otp_required":false,"existing_session":null}', 202);
        }),
      );
      final r = await a.signInWithEmailCode(challengeId: 'ec-1', code: '123456', device: device);
      expect(r, isA<NeedsConfirmation>());
      expect(body['email_code_challenge_id'], 'ec-1');
      expect(body['email_code'], '123456');
      expect(body['installation_id'], 'inst-12345678');
    });

    test('401 session_replaced reaches onUnauthorized', () async {
      ApiException? seen;
      final a = HttpPersonalApi(
        baseUrl: _server,
        sessionToken: 'nfcs_x',
        onUnauthorized: (e) => seen = e,
        client: MockClient((_) async => http.Response(
            '{"error":{"code":"session_replaced","message":"You were signed out","ref":"NFC-1023"}}', 401)),
      );
      await expectLater(a.cards(), throwsA(isA<ApiException>()));
      expect(seen?.code, 'session_replaced');
    });
  });

  test('countries: same code list as the backend, flags and locale guess', () {
    expect(kCountryNames.length, 249);
    expect(countryFlag('RW'), '🇷🇼');
    expect(guessCountry('en_RW'), 'RW');
    expect(guessCountry('fr-CD'), 'CD');
    expect(guessCountry('en_US.UTF-8'), 'US');
    expect(guessCountry('zh_Hans_CN'), 'CN');
    expect(guessCountry('en'), isNull);
  });

  group('sign-in UI', () {
    testWidgets('password sign-in → code + "signs out Galaxy" step → wrong code message → right code signs in', (tester) async {
      final h = _Harness()..api.confirmChallenge = _otp;
      await h.state.init();
      await tester.pumpWidget(_host(h.state, const PersonalAuthScreen()));
      await tester.enterText(find.byKey(const Key('personalEmail')), 'jane@example.com');
      await tester.enterText(find.byKey(const Key('personalPassword')), 'pw');
      await tester.tap(find.byKey(const Key('personalSubmit')));
      await tester.pumpAndSettle();

      expect(find.text('We emailed a code to ja••@example.com'), findsOneWidget);
      expect(find.textContaining('Continuing will sign you out of Galaxy S21.'), findsOneWidget);
      expect(find.text('Dev code: 123456'), findsOneWidget);
      expect(find.text('Resend code in 30s'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('otpField')), '000000'); // auto-submits at 6 digits
      await tester.pumpAndSettle();
      expect(find.text('That code is not right. Check the email and try again.'), findsOneWidget);
      expect(h.state.signedIn, isFalse);

      await tester.enterText(find.byKey(const Key('otpField')), '123456');
      await tester.pumpAndSettle();
      expect(h.state.signedIn, isTrue);
      expect(h.api.lastConfirmCode, '123456');
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('confirmation without a code: warning + Continue', (tester) async {
      final h = _Harness()..api.confirmChallenge = _replace;
      await h.state.init();
      await tester.pumpWidget(_host(h.state, const PersonalAuthScreen()));
      await tester.enterText(find.byKey(const Key('personalEmail')), 'jane@example.com');
      await tester.enterText(find.byKey(const Key('personalPassword')), 'pw');
      await tester.tap(find.byKey(const Key('personalSubmit')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('otpField')), findsNothing);
      expect(find.byKey(const Key('replaceWarning')), findsOneWidget);
      await tester.tap(find.byKey(const Key('confirmSignIn')));
      await tester.pumpAndSettle();
      expect(h.state.signedIn, isTrue);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('expired step goes back to the first screen with a message', (tester) async {
      final h = _Harness()..api.confirmChallenge = _replace;
      await h.state.init();
      await tester.pumpWidget(_host(h.state, const PersonalAuthScreen()));
      await tester.enterText(find.byKey(const Key('personalEmail')), 'jane@example.com');
      await tester.enterText(find.byKey(const Key('personalPassword')), 'pw');
      await tester.tap(find.byKey(const Key('personalSubmit')));
      await tester.pumpAndSettle();
      h.api.confirmError = const ApiException(statusCode: 400, code: 'login_challenge_expired', message: 'x');
      await tester.tap(find.byKey(const Key('confirmSignIn')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('personalSubmit')), findsOneWidget);
      expect(find.text('This sign-in step expired. Please sign in again.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('"Email me a code" sign-in', (tester) async {
      final h = _Harness();
      await h.state.init();
      await tester.pumpWidget(_host(h.state, const PersonalAuthScreen()));
      await tester.tap(find.byKey(const Key('toggleEmailCode')));
      await tester.pump();
      expect(find.byKey(const Key('personalPassword')), findsNothing);
      await tester.enterText(find.byKey(const Key('personalEmail')), 'jane@example.com');
      await tester.tap(find.byKey(const Key('personalSubmit')));
      await tester.pumpAndSettle();
      expect(find.text('We emailed a code to ja••@example.com'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('otpField')), '123456');
      await tester.pumpAndSettle();
      expect(h.state.signedIn, isTrue);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('replaced session: the sign-in screen explains why', (tester) async {
      final h = _Harness();
      await h.state.init();
      await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw');
      h.unauthorized!(const ApiException(statusCode: 401, code: 'session_replaced', message: 'x'));
      await tester.pumpWidget(_host(h.state, const PersonalAuthScreen()));
      await tester.pumpAndSettle();
      expect(find.text('You were signed out because your account signed in on another phone.'), findsOneWidget);
    });

    testWidgets('country gate: locale guess preselected, search, save', (tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      final h = _Harness()..api.user = const PersonalUser(id: 'u1', email: 'jane@example.com', fullName: 'Jane');
      await h.state.init();
      await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw');
      expect(h.state.needsCountry, isTrue);
      await tester.pumpWidget(_host(h.state, const CountryGateScreen(localeName: 'en_KE')));
      await tester.pumpAndSettle();
      expect(find.text('Continue with Kenya'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('countrySearch')), 'rwa');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('country_RW')), findsOneWidget);
      expect(find.byKey(const Key('country_KE')), findsNothing);
      await tester.tap(find.byKey(const Key('country_RW')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('countrySave')));
      await tester.pumpAndSettle();
      expect(h.api.accountPatches.single, {'country': 'RW'});
      expect(h.state.needsCountry, isFalse);
    });

    testWidgets('settings: change country and add / remove the profile photo', (tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      final h = _Harness();
      await h.state.init();
      await h.state.signIn(server: _server, email: 'jane@example.com', password: 'pw');
      await tester.pumpWidget(_host(h.state, PersonalSettingsScreen(imagePicker: (_, _) async => '/tmp/avatar.jpg')));
      await tester.pump();
      expect(find.textContaining('Rwanda'), findsOneWidget);

      await tester.tap(find.byKey(const Key('changeAvatar')));
      await tester.pump();
      await tester.pump();
      expect(h.state.user!.avatarUrl, 'https://img.example/avatar.jpg');
      await tester.pump(const Duration(seconds: 5));
      await tester.tap(find.byKey(const Key('removeAvatar')));
      await tester.pump();
      await tester.pump();
      expect(h.state.user!.avatarUrl, isNull);
      await tester.pump(const Duration(seconds: 5));

      await tester.tap(find.byKey(const Key('accountCountry')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('countrySearch')), 'uganda');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('country_UG')));
      await tester.pumpAndSettle();
      expect(h.api.accountPatches.last, {'country': 'UG'});
      expect(find.textContaining('Uganda'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });
  });

}
