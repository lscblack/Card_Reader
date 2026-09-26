import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/error_catalog.dart';
import '../../core/links.dart';
import '../../data/models/personal.dart';
import '../../services/digital_card_scanner.dart';
import '../../services/hce_bridge.dart';
import '../../services/personal_state.dart';
import '../digital_card/any_card_view.dart';
import '../screens/qr_scan_screen.dart';
import '../theme.dart';
import 'activity_screen.dart';
import 'card_editor_screen.dart';
import 'exchange_flow.dart';
import 'invites_screen.dart';
import 'qr_share_screen.dart';
import 'share_ripple.dart';

enum _Mode { share, scan }

/// "My Card" space: the primary card, Share (HCE) vs Scan (reader) roles, switcher, QR, edit.
class MyCardScreen extends StatefulWidget {
  const MyCardScreen({super.key});

  @override
  State<MyCardScreen> createState() => _MyCardScreenState();
}

class _MyCardScreenState extends State<MyCardScreen> {
  _Mode _mode = _Mode.share;
  bool _scanning = false;
  String? _scanMessage;

  // Captured up front: dispose() must not look up providers (deactivated context).
  late final DigitalCardScanner _scanner = context.read<DigitalCardScanner>();
  late final HceBridge _hce = context.read<PersonalState>().hce;

  @override
  void initState() {
    super.initState();
    _scanner; // resolve while the context is active
    unawaited(_hce.setPreferred(true));
  }

  @override
  void dispose() {
    _cancelScan();
    unawaited(_hce.setPreferred(false));
    super.dispose();
  }

  void _cancelScan() {
    if (_scanning) unawaited(_scanner.cancel());
  }

  Future<void> _scan() async {
    final scanner = _scanner;
    setState(() {
      _scanning = true;
      _scanMessage = null;
    });
    try {
      final token = await scanner.scanToken();
      if (!mounted) return;
      setState(() => _scanning = false);
      await runExchange(context, token, via: 'nfc');
    } on ScanException catch (e) {
      if (!mounted) return;
      setState(() {
        _scanning = false;
        _scanMessage = e.error == MobError.programmingTimeout ? null : '${e.error.title}. ${e.error.fix} (${e.error.ref})';
      });
    }
  }

  Future<void> _scanQr() async {
    final r = await Navigator.of(context).push<Object>(MaterialPageRoute(
      builder: (_) => QrScanScreen(
        title: 'Scan card QR',
        hint: 'Point the camera at the other person\'s card QR code (My Card → QR).',
        parse: (raw) => CardQrPayload.parse(raw),
      ),
    ));
    if (r is CardQrPayload && mounted) await runExchange(context, r.token, via: 'qr');
  }

  void _setMode(_Mode m) {
    if (m == _mode) return;
    _cancelScan();
    setState(() {
      _mode = m;
      _scanning = false;
      _scanMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<PersonalState>();
    final card = p.primary;
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Card'),
        actions: [
          IconButton(
            tooltip: 'Business invites',
            icon: const Icon(Icons.mail_outline),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const InvitesScreen())),
          ),
          IconButton(
            tooltip: 'Activity',
            icon: const Icon(Icons.timeline),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const ActivityScreen())),
          ),
          if (card != null)
            IconButton(
              key: const Key('editCard'),
              tooltip: 'Edit card',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CardEditorScreen(card: card))),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: p.refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            _CardSwitcher(p: p),
            const SizedBox(height: 12),
            if (card == null)
              _NoCard(p: p)
            else ...[
              _RoleToggle(mode: _mode, onChanged: _setMode),
              const SizedBox(height: 14),
              if (_mode == _Mode.share) _SharePanel(p: p, card: card) else _ScanPanel(
                scanning: _scanning,
                message: _scanMessage,
                onScan: _scan,
                onCancel: () {
                  _cancelScan();
                  setState(() => _scanning = false);
                },
                onScanQr: _scanQr,
              ),
              const SizedBox(height: 16),
              AnyCardView(card: card, template: p.templateFor(card.templateId)),
              const SizedBox(height: 14),
              _Stats(card: card),
              const SizedBox(height: 10),
              Text(
                'A digital card is an identifier with a signed, short-lived token — not strong authentication.',
                style: t.bodySmall,
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _RoleToggle extends StatelessWidget {
  const _RoleToggle({required this.mode, required this.onChanged});
  final _Mode mode;
  final ValueChanged<_Mode> onChanged;

  @override
  Widget build(BuildContext context) => SegmentedButton<_Mode>(
    key: const Key('roleToggle'),
    style: SegmentedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
    segments: const [
      ButtonSegment(value: _Mode.share, label: Text('Share my card'), icon: Icon(Icons.ios_share)),
      ButtonSegment(value: _Mode.scan, label: Text('Scan a card'), icon: Icon(Icons.contactless_outlined)),
    ],
    selected: {mode},
    onSelectionChanged: (s) => onChanged(s.first),
  );
}

class _SharePanel extends StatelessWidget {
  const _SharePanel({required this.p, required this.card});
  final PersonalState p;
  final DigitalCard card;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final sharing = card.shareSettings.nfcSharingEnabled && card.isActive;
    final canHce = p.hceSupported;
    final String title;
    final String body;
    if (!card.isActive) {
      title = 'Card inactive';
      body = 'This card was deactivated (e.g. by your company). It can\'t be shared.';
    } else if (!canHce) {
      title = 'Share with QR';
      body = 'This phone can\'t act as an NFC card (${MobError.hceUnsupported.ref}). Show your QR code instead.';
    } else if (!sharing) {
      title = 'NFC sharing is off';
      body = 'Turn it on in Settings, or share your QR code.';
    } else {
      title = 'Ready to share';
      body = 'Hold your phone near another phone or reader. Phones without the app get your web card.';
    }
    return Container(
      key: const Key('sharePanel'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(20)),
      child: Column(
        children: [
          NfcRipple(color: scheme.primary, active: canHce && sharing, icon: Icons.ios_share, size: 132),
          const SizedBox(height: 6),
          Text(title, style: t.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(body, textAlign: TextAlign.center, style: t.bodySmall),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            key: const Key('showQr'),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => QrShareScreen(card: card))),
            icon: const Icon(Icons.qr_code_2),
            label: const Text('Show QR code'),
          ),
        ],
      ),
    );
  }
}

class _ScanPanel extends StatelessWidget {
  const _ScanPanel({required this.scanning, required this.message, required this.onScan, required this.onCancel, required this.onScanQr});
  final bool scanning;
  final String? message;
  final VoidCallback onScan, onCancel, onScanQr;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Container(
      key: const Key('scanPanel'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(20)),
      child: Column(
        children: [
          NfcRipple(color: scheme.tertiary, active: scanning, icon: Icons.contactless_outlined, size: 132),
          const SizedBox(height: 6),
          Text(scanning ? 'Scanning…' : 'Receive someone\'s card', style: t.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(
            scanning
                ? 'Hold the other phone (showing "Share my card") against the back of yours. '
                      'Your own card isn\'t shared while scanning.'
                : 'Cards are exchanged both ways when the other person allows it.',
            textAlign: TextAlign.center,
            style: t.bodySmall,
          ),
          if (message != null) ...[
            const SizedBox(height: 8),
            Text(message!, textAlign: TextAlign.center, style: TextStyle(color: StatusColors.error(context))),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            alignment: WrapAlignment.center,
            children: [
              if (scanning)
                OutlinedButton(onPressed: onCancel, child: const Text('Cancel'))
              else
                FilledButton.icon(key: const Key('startScan'), onPressed: onScan, icon: const Icon(Icons.nfc), label: const Text('Scan')),
              TextButton.icon(onPressed: onScanQr, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan QR')),
            ],
          ),
        ],
      ),
    );
  }
}

class _CardSwitcher extends StatelessWidget {
  const _CardSwitcher({required this.p});
  final PersonalState p;

  @override
  Widget build(BuildContext context) {
    if (p.cards.length < 2) return const SizedBox.shrink();
    return SizedBox(
      height: 44,
      child: ListView(
        key: const Key('cardSwitcher'),
        scrollDirection: Axis.horizontal,
        children: [
          for (final c in p.cards)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                avatar: c.isPrimary ? const Icon(Icons.star, size: 16) : null,
                label: Text(c.label.isEmpty ? c.fields.fullName : c.label),
                selected: c.isPrimary,
                onSelected: c.isPrimary
                    ? null
                    : (_) async {
                        final messenger = ScaffoldMessenger.of(context);
                        final err = await p.setPrimary(c.id);
                        messenger.showSnackBar(SnackBar(
                          content: Text(err == null ? '"${c.label}" is now the card your phone shares' : err.toString()),
                        ));
                      },
              ),
            ),
        ],
      ),
    );
  }
}

class _Stats extends StatelessWidget {
  const _Stats({required this.card});
  final DigitalCard card;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    Widget stat(String label, String key) => Expanded(
      child: Column(children: [
        Text('${card.stats[key] ?? 0}', style: t.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
        Text(label, style: t.labelSmall),
      ]),
    );
    return Row(children: [stat('Views', 'views'), stat('NFC taps', 'nfc_taps'), stat('Exchanges', 'exchanges'), stat('Leads', 'leads')]);
  }
}

class _NoCard extends StatelessWidget {
  const _NoCard({required this.p});
  final PersonalState p;

  @override
  Widget build(BuildContext context) => Column(children: [
    const SizedBox(height: 40),
    const Icon(Icons.badge_outlined, size: 56),
    const SizedBox(height: 12),
    const Text('No card yet'),
    const SizedBox(height: 12),
    FilledButton(onPressed: () => p.createCard('My card'), child: const Text('Create my card')),
  ]);
}
