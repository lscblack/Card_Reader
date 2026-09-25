import 'package:flutter/material.dart';

import 'app.dart';
import 'core/http_client.dart';
import 'core/secure_store.dart';
import 'data/event_repository.dart';
import 'services/app_state.dart';
import 'services/deep_links.dart';
import 'services/hce_bridge.dart';
import 'services/nfc_service.dart';
import 'services/personal_state.dart';
import 'services/platform_info.dart';
import 'services/tag_dispatch.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final repository = await SqfliteEventRepository.open();
  final appState = AppState(
    credentials: CredentialStore(FlutterSecureStore()),
    httpClient: createHttpClient(),
    platform: DefaultPlatformInfo(),
    repository: repository,
    tagDispatch: AndroidTagDispatch(),
  );
  // Show the loading screen immediately; init continues in the background.
  appState.init();

  final personal = PersonalState(
    store: appState.credentials.store,
    httpClient: appState.httpClient,
    platform: appState.platform,
    hce: AndroidHceBridge(),
  );
  personal.init();

  runApp(NfcTerminalApp(
    personal: personal,
    appState: appState,
    repository: repository,
    nfc: AndroidNfcService(),
    deepLinks: AndroidDeepLinks(),
  ));
}
