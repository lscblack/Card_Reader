import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/event_repository.dart';
import '../../services/app_state.dart';
import '../../services/background_reading.dart';
import '../../services/nfc_service.dart';
import '../../services/nfc_writer.dart';
import '../../services/reader_controller.dart';
import 'history_screen.dart';
import 'reader_screen.dart';
import 'settings_screen.dart';

/// Registered-state shell: Reader / History / Settings.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.nfc, this.writer});

  final NfcService nfc;

  /// NDEF writer for card programming (defaults to the Android implementation).
  final NfcWriter? writer;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _index = 0;
  late final ReaderController _reader;
  late final BackgroundReading _background;
  late final NfcWriter _writer = widget.writer ?? AndroidNfcWriter();

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    _reader = ReaderController(
      nfc: widget.nfc,
      repository: context.read<EventRepository>(),
      platform: app.platform,
      deliveryProvider: () => app.delivery,
      configProvider: () => app.config,
    )..init();
    // Tags from Android tag dispatch (app opened by a card tap) go through the
    // same pipeline and debouncer as reader mode.
    _background = BackgroundReading(
      dispatch: app.tagDispatch,
      handleCard: _reader.handleCard,
      isRegistered: () => app.phase == AppPhase.ready,
      flushRetries: () => app.retryQueue?.kick(),
    )..start();
    WidgetsBinding.instance.addObserver(this);
    final notice = app.pairedNotice;
    if (notice != null) {
      app.pairedNotice = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$notice ✓')));
        }
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _reader.onResumed();
    } else if (state == AppLifecycleState.paused) {
      _reader.onPaused();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _background.dispose();
    _reader.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _reader),
        Provider<NfcWriter>.value(value: _writer),
      ],
      child: Scaffold(
        body: IndexedStack(
          index: _index,
          children: const [ReaderScreen(), HistoryScreen(), SettingsScreen()],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.contactless_outlined), label: 'Reader'),
            NavigationDestination(icon: Icon(Icons.history), label: 'History'),
            NavigationDestination(icon: Icon(Icons.settings_outlined), label: 'Settings'),
          ],
        ),
      ),
    );
  }
}
