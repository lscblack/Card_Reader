import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/tap_links.dart';
import '../../data/models/business.dart' show isOpenableActionUrl;
import '../../data/models/card_read.dart';
import '../../services/card_resolver.dart';
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
  const GuestTapConfig({required this.reader, this.opener = openExternally, required this.knownServers, this.resolver});
  final GuestTapReader reader;
  final LinkOpener opener;

  /// Finds a registered card's tap link by chip ID when the chip itself carries no link.
  final CardResolver? resolver;

  /// Servers whose tap links open without asking (configured servers + build default).
  final Iterable<String?> Function() knownServers;
}

/// Screens that own NFC for a specific purpose (Register cards, Program card, personal Scan,
/// pairing/QR, sharing by HCE) claim it: guest reading pauses while any claim is held.
class NfcClaims {
  NfcClaims._();
  static final count = ValueNotifier<int>(0);
}

/// Holds an [NfcClaims] claim while mounted and [active].
class NfcClaim extends StatefulWidget {
  const NfcClaim({super.key, this.active = true, required this.child});
  final bool active;
  final Widget child;

  @override
  State<NfcClaim> createState() => _NfcClaimState();
}

class _NfcClaimState extends State<NfcClaim> {
  bool _held = false;

  void _sync() {
    if (widget.active == _held) return;
    _held = widget.active;
    // Not during build: listeners (the hub) may start/stop reader mode.
    final delta = _held ? 1 : -1;
    scheduleMicrotask(() => NfcClaims.count.value += delta);
  }

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant NfcClaim old) {
    super.didUpdateWidget(old);
    _sync();
  }

  @override
  void dispose() {
    if (_held) scheduleMicrotask(() => NfcClaims.count.value -= 1);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Keeps guest reading on while an enabled [GuestTapScope] is mounted, no screen claims NFC and the
/// app is in the foreground. Taps go to the most recently mounted enabled scope (the sheet opens
/// over whatever screen is showing).
class _GuestTapHub with WidgetsBindingObserver {
  _GuestTapHub(this.reader);
  final GuestTapReader reader;
  final _scopes = <_GuestTapScopeState>[];
  bool _running = false;
  bool _foreground = true;
  Future<void> _chain = Future.value();

  /// Reading is actually on (drives the "Tap a card" ripple).
  final active = ValueNotifier<bool>(false);
  static final _hubs = Expando<_GuestTapHub>();

  static _GuestTapHub of(GuestTapReader r) => _hubs[r] ??= _GuestTapHub(r);

  bool get _wanted => _foreground && NfcClaims.count.value == 0 && _scopes.any((s) => s.enabled);

  void add(_GuestTapScopeState s) {
    _scopes.add(s);
    if (_scopes.length == 1) {
      WidgetsBinding.instance.addObserver(this);
      NfcClaims.count.addListener(sync);
    }
    sync();
  }

  void remove(_GuestTapScopeState s) {
    _scopes.remove(s);
    if (_scopes.isEmpty) {
      WidgetsBinding.instance.removeObserver(this);
      NfcClaims.count.removeListener(sync);
    }
    sync();
  }

  /// Starts/stops reading to match [_wanted] (serialised).
  void sync() {
    _chain = _chain.then((_) async {
      if (_wanted && !_running) {
        _running = true;
        final ok = await reader.start(_onTag);
        active.value = ok && _running;
      } else if (!_wanted && _running) {
        _running = false;
        active.value = false;
        await reader.stop();
      }
    });
  }

  void _onTag(GuestTag tag) {
    for (final s in _scopes.reversed) {
      if (s.enabled && s.mounted) {
        if (s.accepts) unawaited(s.onTag(tag));
        return;
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) _foreground = false;
    if (state == AppLifecycleState.resumed) _foreground = true;
    sync();
  }
}

/// Marks screens where tapping a card simply runs it (no sign-in, not a terminal): welcome, setup
/// and — with [enabled] — every tab of the app that the terminal reader doesn't own.
class GuestTapScope extends StatefulWidget {
  const GuestTapScope({super.key, this.enabled = true, required this.child});
  final bool enabled;
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

  bool get enabled => widget.enabled;
  bool get accepts => widget.enabled && !_sheetOpen && mounted;

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
  void didUpdateWidget(covariant GuestTapScope old) {
    super.didUpdateWidget(old);
    if (old.enabled != widget.enabled) _hub?.sync();
  }

  @override
  void dispose() {
    _hub?.remove(this);
    super.dispose();
  }

  Future<void> onTag(GuestTag tag) async {
    final c = _config;
    if (c == null || _sheetOpen) return;
    final now = DateTime.now();
    if (tag.uid == _lastUid && now.difference(_lastAt) < const Duration(seconds: 2)) return;
    _lastUid = tag.uid;
    _lastAt = now;
    _sheetOpen = true;
    try {
      await showGuestTag(context, tag, knownServers: c.knownServers(), opener: c.opener, resolver: c.resolver);
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
Future<void> showGuestTag(BuildContext context, GuestTag tag,
    {required Iterable<String?> knownServers, LinkOpener opener = openExternally, CardResolver? resolver}) {
  unawaited(HapticFeedback.mediumImpact());
  final link = pickTapLink(tag.uris, knownServers);
  // No link on the chip: the card may still be registered (linked but not programmed) — ask the server.
  Future<TapLink?> Function()? lookup;
  if (link == null && resolver != null) {
    lookup = () async {
      final url = await resolver(tag.uid);
      return url == null ? null : pickTapLink([url], knownServers);
    };
  }
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => GuestTagSheet(tag: tag, link: link, opener: opener, lookup: lookup),
  );
}

class GuestTagSheet extends StatefulWidget {
  const GuestTagSheet({super.key, required this.tag, required this.link, required this.opener, this.lookup});
  final GuestTag tag;
  final TapLink? link;
  final LinkOpener opener;

  /// Resolves the card by chip ID when [link] is null (registered card without a written tap link).
  final Future<TapLink?> Function()? lookup;

  @override
  State<GuestTagSheet> createState() => _GuestTagSheetState();
}

class _GuestTagSheetState extends State<GuestTagSheet> {
  bool _opening = false;
  bool _failed = false;
  late TapLink? _link = widget.link;
  late bool _looking = widget.link == null && widget.lookup != null;

  @override
  void initState() {
    super.initState();
    final l = _link;
    if (l != null && l.autoOpen) WidgetsBinding.instance.addPostFrameCallback((_) => _open());
    if (_looking) unawaited(_lookup());
  }

  Future<void> _lookup() async {
    TapLink? found;
    try {
      found = await widget.lookup!();
    } catch (_) {
      found = null;
    }
    if (!mounted) return;
    setState(() {
      _link = found;
      _looking = false;
    });
    if (found != null && found.autoOpen) await _open();
  }

  Future<void> _open() async {
    final l = _link;
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
    final l = _link;
    final uid = 'Card ID ${CardUtils.formatUid(widget.tag.uid)}';
    final List<Widget> body;
    if (_looking) {
      body = [
        const SizedBox(height: 56, width: 56, child: CircularProgressIndicator()),
        const SizedBox(height: 12),
        Text('Looking up this card…', key: const Key('guestLookup'), style: t.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        SelectableText(uid, textAlign: TextAlign.center, style: t.bodySmall?.copyWith(fontFamily: 'monospace')),
      ];
    } else if (l == null) {
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

  String get _hostLabel => _link?.host ?? '';
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
