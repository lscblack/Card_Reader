import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/pairing.dart';
import 'data/event_repository.dart';
import 'services/app_state.dart';
import 'services/deep_links.dart';
import 'services/nfc_service.dart';
import 'ui/screens/home_shell.dart';
import 'ui/screens/pair_confirm_screen.dart';
import 'ui/screens/setup_screen.dart';
import 'ui/theme.dart';

class NfcTerminalApp extends StatefulWidget {
  const NfcTerminalApp({
    super.key,
    required this.appState,
    required this.repository,
    required this.nfc,
    this.deepLinks = const NoDeepLinks(),
  });

  final AppState appState;
  final EventRepository repository;
  final NfcService nfc;
  final DeepLinkSource deepLinks;

  @override
  State<NfcTerminalApp> createState() => _NfcTerminalAppState();
}

class _NfcTerminalAppState extends State<NfcTerminalApp> with WidgetsBindingObserver {
  final _navigator = GlobalKey<NavigatorState>();
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  StreamSubscription<String>? _linkSub;
  String? _pendingLink;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.appState.addListener(_tryPendingLink);
    _linkSub = widget.deepLinks.links.listen(_onLink);
    widget.deepLinks.initialLink().then((l) {
      if (l != null) _onLink(l);
    });
  }

  void _onLink(String link) {
    _pendingLink = link;
    _tryPendingLink();
  }

  /// Opens the pairing confirmation for a `nfcterminal://pair` link once the
  /// app has finished loading.
  void _tryPendingLink() {
    final link = _pendingLink;
    final nav = _navigator.currentState;
    if (link == null || nav == null || widget.appState.phase == AppPhase.loading) return;
    _pendingLink = null;
    if (widget.appState.phase == AppPhase.ready) {
      _messenger.currentState?.showSnackBar(const SnackBar(
        content: Text('This phone is already registered. Unregister it in Settings before pairing again.'),
      ));
      return;
    }
    try {
      final pairing = PairingPayload.parse(link);
      nav.popUntil((r) => r.isFirst);
      nav.push(MaterialPageRoute<void>(builder: (_) => PairConfirmScreen(pairing: pairing)));
    } on PairingFormatException catch (e) {
      _messenger.currentState?.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      widget.appState.onResumed();
    } else if (state == AppLifecycleState.paused) {
      widget.appState.onPaused();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.appState.removeListener(_tryPendingLink);
    _linkSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: widget.appState),
        Provider<EventRepository>.value(value: widget.repository),
      ],
      child: MaterialApp(
        title: 'NFC Terminal',
        navigatorKey: _navigator,
        scaffoldMessengerKey: _messenger,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        home: Consumer<AppState>(
          builder: (context, app, _) => switch (app.phase) {
            AppPhase.loading => const Scaffold(body: Center(child: CircularProgressIndicator())),
            AppPhase.setup => const SetupScreen(),
            AppPhase.ready => HomeShell(nfc: widget.nfc),
          },
        ),
      ),
    );
  }
}
