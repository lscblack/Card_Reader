import 'dart:io';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:sqflite/sqflite.dart';

import 'app.dart';
import 'core/http_client.dart';
import 'core/secure_store.dart';
import 'data/event_repository.dart';
import 'services/app_state.dart';
import 'services/deep_links.dart';
import 'services/hce_bridge.dart';
import 'services/ios_links.dart';
import 'services/nfc_service.dart';
import 'services/personal_state.dart';
import 'services/platform_info.dart';
import 'services/tag_dispatch.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // iOS: no background tag dispatch, card emulation (HCE) or APK updates. Cards tapped with the app
  // closed arrive as universal links, and links (pairing, sign-in) through app_links.
  final ios = Platform.isIOS;
  if (ios) await FlutterSecureStore.clearAfterReinstall(await getDatabasesPath());
  final iosLinks = ios ? IosLinkRouter(AppLinks().uriLinkStream) : null;

  final repository = await SqfliteEventRepository.open();
  final appState = AppState(
    credentials: CredentialStore(FlutterSecureStore()),
    httpClient: createHttpClient(),
    platform: DefaultPlatformInfo(),
    repository: repository,
    tagDispatch: iosLinks?.tags ?? AndroidTagDispatch(),
    apkUpdates: !ios,
  );
  // Show the loading screen immediately; init continues in the background.
  appState.init();

  final personal = PersonalState(
    store: appState.credentials.store,
    httpClient: appState.httpClient,
    platform: appState.platform,
    hce: ios ? const NoHce() : AndroidHceBridge(),
  );
  personal.init();

  runApp(NfcTerminalApp(
    personal: personal,
    appState: appState,
    repository: repository,
    nfc: ios ? IosNfcService() : AndroidNfcService(),
    deepLinks: iosLinks?.deepLinks ?? AndroidDeepLinks(),
  ));
}
