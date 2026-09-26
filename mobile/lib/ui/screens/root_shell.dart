import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../data/event_repository.dart';
import '../../services/app_state.dart';
import '../../services/background_reading.dart';
import '../../services/digital_card_scanner.dart';
import '../../services/nfc_service.dart';
import '../../services/nfc_writer.dart';
import '../../services/personal_state.dart';
import '../../services/reader_controller.dart';
import '../personal/contacts_screen.dart';
import '../personal/my_card_screen.dart';
import '../widgets/motion.dart';
import 'history_screen.dart';
import 'reader_screen.dart';
import 'settings_hub.dart';

enum ShellTab { myCard, contacts, reader, history, settings }

/// Bottom navigation adapting to the spaces that are set up (Part 4 §8):
/// My Card + Contacts (personal), Reader + History (terminal), Settings.
class RootShell extends StatefulWidget {
  const RootShell({super.key, required this.nfc, this.writer});

  final NfcService nfc;
  final NfcWriter? writer;

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> with WidgetsBindingObserver {
  ShellTab _tab = ShellTab.myCard;
  ReaderController? _reader;
  BackgroundReading? _background;
  late final NfcWriter _writer = widget.writer ?? AndroidNfcWriter();
  late final AppState _app = context.read<AppState>();
  late final PersonalState _personal = context.read<PersonalState>();
  late final DigitalCardScanner _scanner = context.read<DigitalCardScanner>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _app.addListener(_syncSpaces);
    _personal.addListener(_syncSpaces);
    _syncSpaces();
    _tab = _tabs.first;
    final notice = _app.pairedNotice;
    if (notice != null) {
      _app.pairedNotice = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$notice ✓')));
      });
    }
  }

  bool get _terminal => _app.phase == AppPhase.ready;
  bool get _personalOn => _personal.signedIn;

  List<ShellTab> get _tabs => [
    if (_personalOn) ...[ShellTab.myCard, ShellTab.contacts],
    if (_terminal) ...[ShellTab.reader, ShellTab.history],
    ShellTab.settings,
  ];

  /// Creates/disposes the terminal reader as the terminal space appears/disappears.
  void _syncSpaces() {
    if (_terminal && _reader == null) {
      final reader = ReaderController(
        nfc: widget.nfc,
        repository: context.read<EventRepository>(),
        platform: _app.platform,
        deliveryProvider: () => _app.delivery,
        configProvider: () => _app.config,
      );
      _reader = reader;
      reader.init();
      _background = BackgroundReading(
        dispatch: _app.tagDispatch,
        handleCard: reader.handleCard,
        isRegistered: () => _app.phase == AppPhase.ready,
        flushRetries: () => _app.retryQueue?.kick(),
      )..start();
    } else if (!_terminal && _reader != null) {
      final r = _reader!;
      _background?.dispose();
      _reader = null;
      _background = null;
      WidgetsBinding.instance.addPostFrameCallback((_) => r.dispose());
    }
    if (!_tabs.contains(_tab)) _tab = _tabs.first;
    _applyReaderSuspension();
    if (mounted) setState(() {});
  }

  /// With both spaces, terminal reader mode only runs on the Reader tab so the phone can
  /// act as a card (HCE) elsewhere. Terminal-only phones keep the old always-on behaviour.
  void _applyReaderSuspension() {
    final r = _reader;
    if (r == null) return;
    bool wantSuspended() => _personalOn && _tab != ShellTab.reader;
    if (wantSuspended()) {
      r.suspend();
    } else {
      // A personal "Scan a card" session may still own reader mode (My Card keeps its state in
      // the IndexedStack). Stop it first: its cleanup disables reader mode, which would otherwise
      // switch the terminal reader off right after it was enabled.
      unawaited(_scanner.cancel().then((_) {
        if (identical(_reader, r) && !wantSuspended()) r.unsuspend();
      }));
    }
  }

  void _select(ShellTab t) {
    setState(() => _tab = t);
    _applyReaderSuspension();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _reader?.onResumed();
      if (_personalOn) _personal.refresh();
    } else if (state == AppLifecycleState.paused) {
      _reader?.onPaused();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _app.removeListener(_syncSpaces);
    _personal.removeListener(_syncSpaces);
    _background?.dispose();
    _reader?.dispose();
    super.dispose();
  }

  static NavigationDestination _dest(ShellTab t) => switch (t) {
    ShellTab.myCard => const NavigationDestination(icon: Icon(Icons.badge_outlined), selectedIcon: Icon(Icons.badge), label: 'My Card'),
    ShellTab.contacts => const NavigationDestination(icon: Icon(Icons.people_outline), selectedIcon: Icon(Icons.people), label: 'Contacts'),
    ShellTab.reader => const NavigationDestination(icon: Icon(Icons.contactless_outlined), selectedIcon: Icon(Icons.contactless), label: 'Reader'),
    ShellTab.history => const NavigationDestination(icon: Icon(Icons.history), selectedIcon: Icon(Icons.history_toggle_off), label: 'History'),
    ShellTab.settings => const NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
  };

  Widget _page(ShellTab t) => switch (t) {
    ShellTab.myCard => const MyCardScreen(),
    ShellTab.contacts => const ContactsScreen(),
    ShellTab.reader => const ReaderScreen(),
    ShellTab.history => const HistoryScreen(),
    ShellTab.settings => const SettingsHub(),
  };

  @override
  Widget build(BuildContext context) {
    context.watch<AppState>();
    context.watch<PersonalState>();
    final tabs = _tabs;
    final index = tabs.indexOf(_tab).clamp(0, tabs.length - 1);
    Widget body = Scaffold(
      body: IndexedStack(index: index, children: [for (final t in tabs) KeyedSubtree(key: ValueKey(t), child: _page(t))]),
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant))),
        child: NavigationBar(
          key: const Key('rootNav'),
          selectedIndex: index,
          animationDuration: reduceMotion(context) ? Duration.zero : const Duration(milliseconds: 400),
          onDestinationSelected: (i) {
            HapticFeedback.selectionClick();
            _select(tabs[i]);
          },
          destinations: [for (final t in tabs) _dest(t)],
        ),
      ),
    );
    final reader = _reader;
    if (reader != null) {
      body = MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: reader),
          Provider<NfcWriter>.value(value: _writer),
        ],
        child: body,
      );
    }
    return body;
  }
}
