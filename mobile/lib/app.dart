import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/links.dart';
import 'core/pairing.dart';
import 'data/event_repository.dart';
import 'services/app_state.dart';
import 'services/deep_links.dart';
import 'services/digital_card_scanner.dart';
import 'services/nfc_service.dart';
import 'services/personal_state.dart';
import 'ui/personal/exchange_flow.dart';
import 'ui/personal/personal_auth_screen.dart';
import 'ui/personal/welcome_screen.dart';
import 'ui/screens/pair_confirm_screen.dart';
import 'ui/screens/root_shell.dart';
import 'ui/theme.dart';

class NfcTerminalApp extends StatefulWidget {
  const NfcTerminalApp({
    super.key,
    required this.appState,
    required this.repository,
    required this.nfc,
    this.deepLinks = const NoDeepLinks(),
    this.personal,
    this.scanner,
  });

  final AppState appState;
  final EventRepository repository;
  final NfcService nfc;
  final DeepLinkSource deepLinks;

  /// Personal space; a signed-out instance is created when omitted.
  final PersonalState? personal;
  final DigitalCardScanner? scanner;

  @override
  State<NfcTerminalApp> createState() => _NfcTerminalAppState();
}

class _NfcTerminalAppState extends State<NfcTerminalApp> with WidgetsBindingObserver {
  final _navigator = GlobalKey<NavigatorState>();
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  StreamSubscription<String>? _linkSub;
  String? _pendingLink;
  late final PersonalState _personal;
  late final DigitalCardScanner _scanner = widget.scanner ?? AndroidDigitalCardScanner();

  @override
  void initState() {
    super.initState();
    _personal = widget.personal ??
        (PersonalState(
          store: widget.appState.credentials.store,
          httpClient: widget.appState.httpClient,
          platform: widget.appState.platform,
        )..init());
    WidgetsBinding.instance.addObserver(this);
    widget.appState.addListener(_tryPendingLink);
    _personal.addListener(_tryPendingLink);
    _linkSub = widget.deepLinks.links.listen(_onLink);
    widget.deepLinks.initialLink().then((l) {
      if (l != null) _onLink(l);
    });
  }

  void _onLink(String link) {
    _pendingLink = link;
    _tryPendingLink();
  }

  void _snack(String text) => _messenger.currentState?.showSnackBar(SnackBar(content: Text(text)));

  /// Routes `nfcterminal://pair|login|card` links once the app has loaded.
  void _tryPendingLink() {
    final link = _pendingLink;
    final nav = _navigator.currentState;
    if (link == null || nav == null || widget.appState.phase == AppPhase.loading || _personal.loading) return;
    _pendingLink = null;
    final host = Uri.tryParse(link)?.host.toLowerCase();
    switch (host) {
      case 'login':
        if (_personal.signedIn) return _snack('You are already signed in to My Card on this phone.');
        try {
          final p = LoginPayload.parse(link);
          nav.popUntil((r) => r.isFirst);
          nav.push(MaterialPageRoute<void>(builder: (_) => PersonalAuthScreen(loginLink: p)));
        } on LinkFormatException catch (e) {
          _snack(e.message);
        }
      case 'card':
        if (!_personal.signedIn) return _snack('Sign in to My Card to exchange cards.');
        try {
          final c = CardQrPayload.parse(link);
          unawaited(_confirmCardLink(nav.context, c.token));
        } on LinkFormatException catch (e) {
          _snack(e.message);
        }
      default:
        if (widget.appState.phase == AppPhase.ready) {
          return _snack('This phone is already registered. Unregister it in Settings before pairing again.');
        }
        try {
          final pairing = PairingPayload.parse(link);
          nav.popUntil((r) => r.isFirst);
          nav.push(MaterialPageRoute<void>(builder: (_) => PairConfirmScreen(pairing: pairing)));
        } on PairingFormatException catch (e) {
          _snack(e.message);
        }
    }
  }

  /// Any web page or app can fire `nfcterminal://card?…`. An exchange shares this person's card
  /// with the token's owner (mutual exchange), so a link never exchanges without a tap here.
  Future<void> _confirmCardLink(BuildContext ctx, String token) async {
    final ok = await showDialog<bool>(
      context: ctx,
      builder: (c) => AlertDialog(
        key: const Key('cardLinkConfirm'),
        title: const Text('Exchange cards?'),
        content: const Text(
          'A link wants to exchange digital cards with you. If you continue, you receive their card '
          'and they receive yours (as allowed by your sharing settings).\n\n'
          'Only continue if you scanned this person\'s code yourself.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(
            key: const Key('cardLinkExchange'),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Exchange'),
          ),
        ],
      ),
    );
    if (ok == true && ctx.mounted) await runExchange(ctx, token, via: 'qr');
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
    _personal.removeListener(_tryPendingLink);
    _linkSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: widget.appState),
        ChangeNotifierProvider.value(value: _personal),
        Provider<EventRepository>.value(value: widget.repository),
        Provider<DigitalCardScanner>.value(value: _scanner),
      ],
      child: MaterialApp(
        title: 'nexTap',
        navigatorKey: _navigator,
        scaffoldMessengerKey: _messenger,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        home: Consumer2<AppState, PersonalState>(
          builder: (context, app, personal, _) {
            if (app.phase == AppPhase.loading || personal.loading) {
              return const Scaffold(body: Center(child: CircularProgressIndicator()));
            }
            if (app.phase != AppPhase.ready && !personal.signedIn) return const WelcomeScreen();
            return RootShell(nfc: widget.nfc);
          },
        ),
      ),
    );
  }
}
