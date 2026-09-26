import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/tap_links.dart';
import '../../data/models/business.dart' show isOpenableActionUrl;
import '../../data/models/card_read.dart';
import '../../services/guest_tap.dart';
import '../personal/share_ripple.dart';
import '../theme.dart';

/// Opens a link outside the app (mockable).
typedef LinkOpener = Future<bool> Function(Uri uri);

Future<bool> openExternally(Uri uri) async {
  try {
    return await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}

/// App-wide guest-tap wiring (provided by `NfcTerminalApp`).
class GuestTapConfig {
  const GuestTapConfig({required this.reader, this.opener = openExternally, required this.knownServers});
  final GuestTapReader reader;
  final LinkOpener opener;

  /// Servers whose tap links open without asking (configured servers + build default).
  final Iterable<String?> Function() knownServers;
}

/// Keeps guest reading on while at least one [GuestTapScope] is mounted; taps go to the topmost
/// scope whose route is visible. Paused with the app.
class _GuestTapHub with WidgetsBindingObserver {
  _GuestTapHub(this.reader);
  final GuestTapReader reader;
  final _scopes = <_GuestTapScopeState>[];
  bool _running = false;

  /// Reading is actually on (drives the "Tap a card" ripple).
  final active = ValueNotifier<bool>(false);
  static final _hubs = Expando<_GuestTapHub>();

  static _GuestTapHub of(GuestTapReader r) => _hubs[r] ??= _GuestTapHub(r);

  void add(_GuestTapScopeState s) {
    _scopes.add(s);
    if (_scopes.length == 1) {
      WidgetsBinding.instance.addObserver(this);
      unawaited(_start());
    }
  }

  void remove(_GuestTapScopeState s) {
    _scopes.remove(s);
    if (_scopes.isEmpty) {
      WidgetsBinding.instance.removeObserver(this);
      unawaited(_stop());
    }
  }

  Future<void> _start() async {
    if (_running || _scopes.isEmpty) return;
    _running = true;
    final ok = await reader.start(_onTag);
    active.value = ok && _running;
  }

  Future<void> _stop() async {
    if (!_running) return;
    _running = false;
    active.value = false;
    await reader.stop();
  }

  void _onTag(GuestTag tag) {
    for (final s in _scopes.reversed) {
      if (s.visible) {
        unawaited(s.onTag(tag));
        return;
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) unawaited(_stop());
    if (state == AppLifecycleState.resumed) unawaited(_start());
  }
}

/// Marks a screen where tapping a nexTap card simply opens it (no sign-in, not a terminal).
class GuestTapScope extends StatefulWidget {
  const GuestTapScope({super.key, required this.child});
  final Widget child;

  @override
  State<GuestTapScope> createState() => _GuestTapScopeState();
}

class _GuestTapScopeState extends State<GuestTapScope> {
  GuestTapConfig? _config;
  _GuestTapHub? _hub;
  bool _sheetOpen = false;
  String? _lastUid;
  DateTime _lastAt = DateTime(0);

  bool get visible => mounted && (ModalRoute.of(context)?.isCurrent ?? true) && !_sheetOpen;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_hub != null) return;
    _config = Provider.of<GuestTapConfig?>(context, listen: false);
    final c = _config;
    if (c == null) return;
    _hub = _GuestTapHub.of(c.reader)..add(this);
  }

  @override
  void dispose() {
    _hub?.remove(this);
    super.dispose();
  }

  Future<void> onTag(GuestTag tag) async {
    final c = _config;
    if (c == null) return;
    final now = DateTime.now();
    if (tag.uid == _lastUid && now.difference(_lastAt) < const Duration(seconds: 2)) return;
    _lastUid = tag.uid;
    _lastAt = now;
    _sheetOpen = true;
    try {
      await showGuestTag(context, tag, knownServers: c.knownServers(), opener: c.opener);
    } finally {
      _sheetOpen = false;
      _lastAt = DateTime.now();
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Guest tap result sheet: opens nexTap links on known servers right away, asks for other hosts
/// and other links, and explains cards that aren't set up yet.
Future<void> showGuestTag(BuildContext context, GuestTag tag, {required Iterable<String?> knownServers, LinkOpener opener = openExternally}) {
  unawaited(HapticFeedback.mediumImpact());
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => GuestTagSheet(tag: tag, link: pickTapLink(tag.uris, knownServers), opener: opener),
  );
}

class GuestTagSheet extends StatefulWidget {
  const GuestTagSheet({super.key, required this.tag, required this.link, required this.opener});
  final GuestTag tag;
  final TapLink? link;
  final LinkOpener opener;

  @override
  State<GuestTagSheet> createState() => _GuestTagSheetState();
}

class _GuestTagSheetState extends State<GuestTagSheet> {
  bool _opening = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    final l = widget.link;
    if (l != null && l.autoOpen) WidgetsBinding.instance.addPostFrameCallback((_) => _open());
  }

  Future<void> _open() async {
    final l = widget.link;
    if (l == null || _opening) return;
    setState(() {
      _opening = true;
      _failed = false;
    });
    final ok = await widget.opener(l.uri);
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
    } else {
      setState(() {
        _opening = false;
        _failed = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final l = widget.link;
    final uid = 'Card ID ${CardUtils.formatUid(widget.tag.uid)}';
    final List<Widget> body;
    if (l == null) {
      body = [
        Icon(Icons.info_outline, size: 48, color: scheme.onSurfaceVariant),
        const SizedBox(height: 12),
        Text(
          widget.tag.hasNdef ? 'This card has no link to open' : 'This card isn\'t set up yet',
          key: const Key('guestNotSetUp'),
          style: t.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 6),
        Text('Ask the business to register it with nexTap.', textAlign: TextAlign.center, style: t.bodyMedium),
        const SizedBox(height: 8),
        SelectableText(uid, textAlign: TextAlign.center, style: t.bodySmall?.copyWith(fontFamily: 'monospace')),
      ];
    } else {
      final ours = l.kind != TapLinkKind.other;
      final canOpen = ours || isOpenableActionUrl(l.uri.toString());
      body = [
        if (l.autoOpen && !_failed)
          const SizedBox(height: 56, width: 56, child: CircularProgressIndicator())
        else
          Icon(ours ? Icons.contactless_outlined : Icons.link, size: 48, color: scheme.primary),
        const SizedBox(height: 12),
        Text(
          l.autoOpen && !_failed
              ? (l.kind == TapLinkKind.card ? 'Opening the digital card…' : 'Opening the card…')
              : (ours ? 'Open this card?' : 'This card contains a link'),
          key: const Key('guestTitle'),
          style: t.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 6),
        Text(l.host.isEmpty ? l.uri.toString() : l.host, key: const Key('guestHost'),
            textAlign: TextAlign.center, style: t.titleMedium?.copyWith(color: scheme.primary)),
        if (!l.autoOpen) ...[
          const SizedBox(height: 8),
          Text(
            ours
                ? 'This card points to $_hostLabel, not this phone\'s server. Only open it if you trust it.'
                : l.uri.toString(),
            key: const Key('guestWarning'),
            textAlign: TextAlign.center,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: t.bodySmall?.copyWith(color: ours ? StatusColors.warning(context) : null),
          ),
        ],
        if (_failed) ...[
          const SizedBox(height: 8),
          Text('Couldn\'t open the link on this phone.', style: TextStyle(color: StatusColors.error(context))),
        ],
        if (!l.autoOpen || _failed) ...[
          const SizedBox(height: 16),
          if (canOpen)
            FilledButton.icon(
              key: const Key('guestOpen'),
              onPressed: _opening ? null : _open,
              icon: const Icon(Icons.open_in_new),
              label: const Text('Open'),
            ),
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close')),
        ],
      ];
    }
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final w in body) w is Icon || w is SizedBox ? Center(child: w) : w,
        ]),
      ),
    );
  }

  String get _hostLabel => widget.link?.host ?? '';
}

/// Welcome/setup hint: "Tap a card" (guest reading is on).
class TapACardPanel extends StatelessWidget {
  const TapACardPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final config = Provider.of<GuestTapConfig?>(context, listen: false);
    if (config == null) return const SizedBox.shrink();
    final active = _GuestTapHub.of(config.reader).active;
    return ValueListenableBuilder<bool>(valueListenable: active, builder: (context, on, _) => _panel(context, on));
  }

  Widget _panel(BuildContext context, bool on) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Card(
      key: const Key('tapACard'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          NfcRipple(color: scheme.primary, icon: Icons.contactless_outlined, size: 64, active: on),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Tap a card', style: t.titleMedium),
              const SizedBox(height: 2),
              Text(
                on
                    ? 'Hold a nexTap card or tag to the phone to open it — no sign-in needed.'
                    : 'Turn on NFC to open nexTap cards by tapping them — no sign-in needed.',
                style: t.bodySmall,
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}
