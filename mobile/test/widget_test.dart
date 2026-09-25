import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nfc_terminal/app.dart';
import 'package:nfc_terminal/core/secure_store.dart';
import 'package:nfc_terminal/services/app_state.dart';

import 'fakes.dart';

void main() {
  testWidgets('setup screen renders and validates the API key', (tester) async {
    final repo = InMemoryEventRepository();
    final app = AppState(
      credentials: CredentialStore(MemorySecureStore()),
      httpClient: MockClient((_) async => http.Response('', 500)),
      platform: FakePlatformInfo(),
      repository: repo,
    );
    await app.init();

    await tester.pumpWidget(NfcTerminalApp(appState: app, repository: repo, nfc: FakeNfcService()));
    await tester.pumpAndSettle();

    // Part 4 onboarding: choose the Terminal space.
    expect(find.byKey(const Key('choosePersonal')), findsOneWidget);
    await tester.tap(find.byKey(const Key('chooseTerminal')));
    await tester.pumpAndSettle();

    expect(find.text('NFC Terminal'), findsOneWidget);
    expect(find.byKey(const Key('serverUrl')), findsOneWidget);
    expect(find.byKey(const Key('apiKey')), findsOneWidget);
    expect(find.text('Register device'), findsOneWidget);
    expect(find.byKey(const Key('scanQrButton')), findsOneWidget);
    expect(find.text('UID only (not authenticated)'), findsOneWidget);
    // Device name is prefilled from the model.
    expect(find.text('Google Pixel 8'), findsOneWidget);
    // Emulator default URL is http -> warning shown.
    expect(find.textContaining('Not encrypted'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('apiKey')), 'nfcd_not_an_api_key');
    await tester.ensureVisible(find.byKey(const Key('registerButton')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('registerButton')));
    await tester.pumpAndSettle();
    expect(find.text('API keys start with "nfc_"'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    app.dispose(); // cancels the daily update-check timer
  });
}
