import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/error_catalog.dart';
import '../../core/platform.dart';
import '../../data/api_client.dart';
import '../../data/event_repository.dart';
import '../../data/models/business.dart';
import '../../data/models/card_read.dart';
import '../../data/models/device_config.dart';
import '../../data/models/endpoint_reply.dart';
import '../../data/models/event_record.dart';
import '../../services/app_state.dart';
import '../../services/card_programmer.dart';
import '../../services/location_sharing.dart';
import '../../services/nfc_writer.dart';
import '../../services/reader_controller.dart';
import '../theme.dart';
import '../widgets/business_result.dart';
import '../widgets/common.dart';
import '../widgets/digital_card_result.dart';
import '../widgets/error_ref.dart';
import '../widgets/help_sheet.dart';
import '../widgets/register_chip.dart';
import '../widgets/update_banner.dart';
import 'program_card_screen.dart';
import 'register_cards_screen.dart';
import '../../services/card_registrar.dart';
import '../widgets/status_indicator.dart';

class ReaderScreen extends StatelessWidget {
  const ReaderScreen({super.key});

  void _openProgram(BuildContext context, AppState app, ReaderController reader) =>
      Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => ProgramCardScreen(
          api: app.api!,
          programmer: CardProgrammer(writer: context.read<NfcWriter>(), api: app.api!, reader: reader),
        ),
      ));

  /// "Register cards" / "Program a card": icons, or one menu on narrow screens (320 dp).
  List<Widget> _cardActions(BuildContext context, AppState app, ReaderController reader) {
    final canRegister = (app.config?.can(Capability.registerCards) ?? false) && app.api != null;
    final canProgram = (app.config?.can(Capability.programCards) ?? false) && app.api != null;
    if (!canRegister && !canProgram) return const [];
    if (canRegister && canProgram && MediaQuery.sizeOf(context).width < 400) {
      return [
        PopupMenuButton<String>(
          key: const Key('cardsMenu'),
          tooltip: 'Cards',
          icon: const Icon(Icons.add_card),
          onSelected: (v) => v == 'register' ? openRegisterCards(context, app, reader) : _openProgram(context, app, reader),
          itemBuilder: (_) => const [
            PopupMenuItem(
              key: Key('registerCardsAction'),
              value: 'register',
              child: ListTile(leading: Icon(Icons.add_card), title: Text('Register cards'), contentPadding: EdgeInsets.zero),
            ),
            PopupMenuItem(
              key: Key('programCardAction'),
              value: 'program',
              child: ListTile(leading: Icon(Icons.edit_note), title: Text('Program a card'), contentPadding: EdgeInsets.zero),
            ),
          ],
        ),
      ];
    }
    return [
      if (canRegister)
        IconButton(
          key: const Key('registerCardsAction'),
          tooltip: 'Register cards',
          icon: const Icon(Icons.add_card),
          onPressed: () => openRegisterCards(context, app, reader),
        ),
      if (canProgram)
        IconButton(
          key: const Key('programCardAction'),
          tooltip: 'Program a card',
          icon: const Icon(Icons.edit_note),
          onPressed: () => _openProgram(context, app, reader),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final reader = context.watch<ReaderController>();

    return Scaffold(
      appBar: AppBar(
        title: _Title(config: app.config),
        actions: [
          ..._cardActions(context, app, reader),
          IconButton(
            key: const Key('tapHelpAction'),
            tooltip: 'What happens when I tap a card?',
            icon: const Icon(Icons.help_outline),
            onPressed: () => showTapHelpSheet(context, app.config),
          ),
          _ServerDot(reachable: app.configSync?.serverReachable, online: app.online),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await app.configSync?.sync();
          await reader.refreshAvailability();
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            if (app.availableUpdate != null) UpdateBanner(release: app.availableUpdate!),
            _ConnectionCard(app: app),
            if (app.locationSharing != null) _LocationCard(sharing: app.locationSharing!),
            if (reader.linkNotice != null) _LinkNotice(text: reader.linkNotice!),
            const SizedBox(height: 24),
            Center(child: _indicator(context, reader, app.online)),
            const SizedBox(height: 20),
            _PrimaryAction(reader: reader),
            const SizedBox(height: 24),
            if (reader.lastCard != null)
              _LastCardCard(card: reader.lastCard!, event: reader.lastEvent, config: app.config, api: app.api),
            const SizedBox(height: 12),
            const _QueueSummary(),
          ],
        ),
      ),
    );
  }

  Widget _indicator(BuildContext context, ReaderController r, bool online) {
    final e = r.lastEvent;
    String codeLatency() => [
      if (e?.lastStatusCode != null) 'HTTP ${e!.lastStatusCode}',
      if (e?.latencyMs != null) '${e!.latencyMs} ms',
    ].join(' · ');

    return switch (r.phase) {
      ReaderPhase.checking => StatusIndicator(
        icon: Icons.nfc, color: StatusColors.neutral(context), title: 'Checking NFC…', busy: true),
      ReaderPhase.unsupported => StatusIndicator(
        icon: Icons.block, color: StatusColors.error(context),
        title: 'NFC not supported',
        subtitle: isIos
            ? 'This iPhone can\'t read NFC cards (iPhone 7 or newer needed). (${MobError.nfcUnsupported.ref})'
            : 'This phone has no NFC reader. Use an NFC-capable phone. (${MobError.nfcUnsupported.ref})'),
      ReaderPhase.nfcOff => StatusIndicator(
        icon: Icons.portable_wifi_off, color: StatusColors.warning(context),
        title: 'NFC off', subtitle: 'Turn on NFC in system settings to scan cards. (${MobError.nfcDisabled.ref})'),
      ReaderPhase.stopped when r.sessionBased => StatusIndicator(
        icon: Icons.contactless_outlined, color: StatusColors.neutral(context),
        title: 'Ready to scan',
        subtitle: 'Tap Scan cards, then hold each card near the top of the iPhone. '
            'The scan stays open for about a minute.'),
      ReaderPhase.stopped => StatusIndicator(
        icon: Icons.pause_circle_outline, color: StatusColors.neutral(context),
        title: 'Reader stopped', subtitle: 'Tap Start to scan cards.'),
      ReaderPhase.ready when !online => StatusIndicator(
        icon: Icons.cloud_off, color: StatusColors.warning(context), pulsing: true,
        title: 'Offline', subtitle: 'Cards are still read and queued until the network is back.'),
      ReaderPhase.ready => StatusIndicator(
        icon: Icons.contactless_outlined, color: StatusColors.active(context), pulsing: true,
        title: 'Ready to scan', subtitle: 'Hold a card $nfcSpot.'),
      ReaderPhase.reading => StatusIndicator(
        icon: Icons.nfc, color: StatusColors.active(context), busy: true, title: 'Reading…'),
      ReaderPhase.sending => StatusIndicator(
        icon: Icons.send, color: StatusColors.active(context), busy: true,
        title: 'Sending…', subtitle: e == null ? null : 'Mode: ${e.deliveryMode.name}'),
      ReaderPhase.delivered when e?.business != null => StatusIndicator(
        icon: e!.business!.isRecognized
            ? Icons.verified_outlined
            : (e.business!.isInactive ? Icons.block : Icons.help_outline),
        color: businessResultColor(context, e.business!),
        title: businessResultLabel(e.business!),
        subtitle: e.business!.message),
      // The endpoint answered with something to show: its words instead of only "Delivered".
      ReaderPhase.delivered when r.lastReply?.hasDisplay == true => StatusIndicator(
        icon: replyToneIcon(r.lastReply!.tone),
        color: replyToneColor(context, r.lastReply!.tone),
        title: r.lastReply!.title ?? (e?.status == EventStatus.logged ? 'Logged ✓' : 'Delivered ✓'),
        subtitle: r.lastReply!.message ?? codeLatency()),
      ReaderPhase.delivered => StatusIndicator(
        icon: Icons.check_circle_outline, color: StatusColors.success(context),
        title: e?.status == EventStatus.logged ? 'Logged ✓' : 'Delivered ✓', subtitle: codeLatency()),
      ReaderPhase.platformRetrying => StatusIndicator(
        icon: Icons.schedule, color: StatusColors.warning(context),
        title: 'Accepted · platform retrying',
        subtitle: 'The endpoint did not accept it yet (${e?.lastError ?? codeLatency()}). The platform retries.'),
      ReaderPhase.failed => StatusIndicator(
        icon: Icons.error_outline, color: StatusColors.error(context),
        title: 'Failed ✗',
        subtitle: [
          r.lastMessage ?? e?.lastError ?? 'Delivery failed',
          if (e?.status == EventStatus.queued) 'queued for retry',
        ].join(' – ')),
    };
  }
}

/// Colour of an endpoint reply's tone; unknown tones are neutral.
Color replyToneColor(BuildContext c, ReplyTone tone) => switch (tone) {
  ReplyTone.success => StatusColors.success(c),
  ReplyTone.warning => StatusColors.warning(c),
  ReplyTone.error => StatusColors.error(c),
  ReplyTone.info => StatusColors.active(c),
  ReplyTone.neutral => StatusColors.neutral(c),
};

IconData replyToneIcon(ReplyTone tone) => switch (tone) {
  ReplyTone.success => Icons.check_circle_outline,
  ReplyTone.warning => Icons.warning_amber_rounded,
  ReplyTone.error => Icons.error_outline,
  ReplyTone.info => Icons.info_outline,
  ReplyTone.neutral => Icons.chat_bubble_outline,
};

/// Small notice under the connection card: the endpoint's link was not opened.
class _LinkNotice extends StatelessWidget {
  const _LinkNotice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    key: const Key('linkNotice'),
    padding: const EdgeInsets.only(top: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.link_off, size: 16, color: StatusColors.warning(context)),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
      ],
    ),
  );
}

/// Location sharing (opt-in per application): the persistent "sharing location" indicator while a session is
/// open, and the permission prompt when the setting is on but the phone has not allowed it.
class _LocationCard extends StatefulWidget {
  const _LocationCard({required this.sharing});

  final LocationSharing sharing;

  @override
  State<_LocationCard> createState() => _LocationCardState();
}

class _LocationCardState extends State<_LocationCard> {
  @override
  void initState() {
    super.initState();
    widget.sharing.addListener(_changed);
    unawaited(widget.sharing.refreshAccess());
  }

  @override
  void didUpdateWidget(_LocationCard old) {
    super.didUpdateWidget(old);
    if (old.sharing != widget.sharing) {
      old.sharing.removeListener(_changed);
      widget.sharing.addListener(_changed);
      unawaited(widget.sharing.refreshAccess());
    }
  }

  @override
  void dispose() {
    widget.sharing.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.sharing;
    if (!s.enabled) return const SizedBox.shrink();
    final t = Theme.of(context).textTheme;
    if (s.active) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Card(
          key: const Key('locationSharingIndicator'),
          color: Theme.of(context).colorScheme.primaryContainer,
          child: ListTile(
            leading: Icon(Icons.my_location, color: Theme.of(context).colorScheme.onPrimaryContainer),
            title: const Text('Sharing your location'),
            subtitle: Text(s.deliveryTroubled
                ? 'Updates are not reaching the server. Check the connection.'
                : 'A session is open. Sharing stops when it ends.'),
            trailing: TextButton(onPressed: s.pauseByUser, child: const Text('Stop sharing')),
          ),
        ),
      );
    }
    if (s.needsPermission) {
      final blocked = s.access == LocationAccess.deniedForever;
      final off = s.access == LocationAccess.serviceOff;
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          key: const Key('locationPermission'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.location_off_outlined, size: 18, color: StatusColors.warning(context)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                off
                    ? 'This application shares your location, but location is switched off on this phone.'
                    : 'This application shares your location with each tap. Allow location access to do so.',
                style: t.bodySmall,
              ),
            ),
            TextButton(
              onPressed: blocked || off ? s.openSettings : s.requestAccess,
              child: Text(blocked || off ? 'Settings' : 'Allow'),
            ),
          ],
        ),
      );
    }
    if (s.sessionWaiting) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          children: [
            Icon(Icons.location_disabled, size: 18, color: StatusColors.neutral(context)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                s.problem ?? 'A session is open. You stopped sharing your location.',
                style: t.bodySmall,
              ),
            ),
            TextButton(onPressed: s.resume, child: Text(s.problem != null ? 'Try again' : 'Share again')),
          ],
        ),
      );
    }
    return const SizedBox.shrink();
  }
}

/// "Reader", or the business logo + name on business devices.
class _Title extends StatelessWidget {
  const _Title({required this.config});

  final DeviceConfig? config;

  @override
  Widget build(BuildContext context) {
    final b = config?.isBusiness == true ? config!.business : null;
    if (b == null) return const Text('Reader');
    final logo = b.logoUrl;
    return Row(
      key: const Key('businessBranding'),
      children: [
        CircleAvatar(
          radius: 16,
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          foregroundImage: logo == null ? null : NetworkImage(logo),
          onForegroundImageError: logo == null ? null : (_, _) {},
          child: Text(
            b.name.isEmpty ? '?' : b.name.characters.first.toUpperCase(),
            style: TextStyle(color: Theme.of(context).colorScheme.onPrimaryContainer),
          ),
        ),
        const SizedBox(width: 10),
        Flexible(child: Text(b.name, overflow: TextOverflow.ellipsis)),
      ],
    );
  }
}

class _PrimaryAction extends StatelessWidget {
  const _PrimaryAction({required this.reader});

  final ReaderController reader;

  @override
  Widget build(BuildContext context) {
    const size = Size(220, 52);
    return Center(
      child: switch (reader.phase) {
        ReaderPhase.unsupported || ReaderPhase.checking => const SizedBox.shrink(),
        ReaderPhase.nfcOff => FilledButton.icon(
          onPressed: reader.openNfcSettings,
          icon: const Icon(Icons.settings),
          label: const Text('Open NFC settings'),
          style: FilledButton.styleFrom(minimumSize: size),
        ),
        _ when reader.active => OutlinedButton.icon(
          onPressed: reader.stop,
          icon: const Icon(Icons.stop),
          label: const Text('Stop reader'),
          style: OutlinedButton.styleFrom(minimumSize: size),
        ),
        _ when reader.sessionBased => FilledButton.icon(
          key: const Key('scanCards'),
          onPressed: reader.start,
          icon: const Icon(Icons.contactless_outlined),
          label: const Text('Scan cards'),
          style: FilledButton.styleFrom(minimumSize: size),
        ),
        _ => FilledButton.icon(
          onPressed: reader.start,
          icon: const Icon(Icons.play_arrow),
          label: const Text('Start reader'),
          style: FilledButton.styleFrom(minimumSize: size),
        ),
      },
    );
  }
}

class _ServerDot extends StatelessWidget {
  const _ServerDot({required this.reachable, required this.online});

  final bool? reachable;
  final bool online;

  @override
  Widget build(BuildContext context) {
    final (color, label) = !online
        ? (StatusColors.warning(context), 'Offline')
        : switch (reachable) {
            true => (StatusColors.success(context), 'Connected'),
            false => (StatusColors.error(context), 'Unreachable'),
            null => (StatusColors.neutral(context), 'Connecting'),
          };
    return Padding(
      padding: const EdgeInsets.only(right: 16),
      child: Row(
        children: [
          Icon(Icons.circle, size: 10, color: color),
          const SizedBox(width: 6),
          Text(label, style: Theme.of(context).textTheme.labelLarge),
        ],
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({required this.app});

  final AppState app;

  @override
  Widget build(BuildContext context) {
    final cfg = app.config;
    final sync = app.configSync;
    if (cfg == null) {
      return SectionCard(
        title: 'Connection',
        children: [
          Text(sync?.lastError == null ? 'Loading configuration…' : 'Configuration unavailable: ${sync!.lastError}'),
        ],
      );
    }
    return SectionCard(
      title: 'Connection',
      children: [
        InfoRow('Application', cfg.applicationName),
        InfoRow('Delivery', cfg.deliveryMode == DeliveryMode.relay ? 'Relay (via platform)' : 'Direct (signed by phone)'),
        InfoRow(
          'Endpoint',
          cfg.deliveryMode == DeliveryMode.relay
              ? 'Managed by the platform'
              : '${cfg.endpointHost ?? 'not configured'}${cfg.endpointEnabled ? '' : ' (disabled)'}',
        ),
        if (sync?.applicationDisabled ?? false)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              'Application paused in the dashboard. Events are queued and retried.',
              style: TextStyle(color: StatusColors.warning(context)),
            ),
          ),
        if (sync?.serverReachable == false && sync?.lastError != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              'Server: ${sync!.lastError}',
              style: TextStyle(color: StatusColors.error(context)),
            ),
          ),
      ],
    );
  }
}

class _LastCardCard extends StatelessWidget {
  const _LastCardCard({required this.card, required this.event, this.config, this.api});

  final CardRead card;
  final EventRecord? event;
  final DeviceConfig? config;
  final DeviceApi? api;

  @override
  Widget build(BuildContext context) {
    final e = event;
    return SectionCard(
      title: 'Last card',
      children: [
        const UidOnlyNote(),
        const SizedBox(height: 8),
        Text(
          CardUtils.formatUid(card.uid),
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontFamily: 'monospace', letterSpacing: 1),
        ),
        const SizedBox(height: 8),
        InfoRow('Card ID', card.uid, mono: true),
        InfoRow('Type', card.type),
        InfoRow('Technologies', card.technologies.join(', ')),
        if (card.isDigitalCard && e?.business == null) ...[
          const SizedBox(height: 8),
          DigitalCardResult(summary: e?.digitalCard, shareIdHex: card.uid),
        ],
        if (e?.business != null) ...[
          const SizedBox(height: 8),
          BusinessResultCard(
            result: e!.business!,
            autoRun: context.read<AppState>().autoRunActions && (config?.isBusiness ?? false),
            onRegister: (config?.can(Capability.registerCards) ?? false) && api != null
                ? () => openRegisterCards(context, context.read<AppState>(), context.read<ReaderController>(),
                    initialUid: card.uid)
                : null,
          ),
        ],
        // Developer phones: save the card to the application's card list.
        if (e != null && e.business == null && e.appCard != null && api != null && !(config?.isBusiness ?? false)) ...[
          const SizedBox(height: 8),
          AppCardPanel(key: ValueKey('appCard-${e.eventId}'), result: e.appCard!, uid: card.uid, eventId: e.eventId, api: api!,
              repository: context.read<ReaderController>().repository),
        ],
        if (e != null) ...[
          const Divider(height: 20),
          Row(
            children: [
              EventStatusChip(e.status),
              const Spacer(),
              if (e.status == EventStatus.queued || e.status == EventStatus.failed)
                TextButton.icon(
                  onPressed: () => context.read<AppState>().retryQueue?.retryNow(e.eventId),
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Retry now'),
                ),
            ],
          ),
          InfoRow('Attempts', '${e.attempts}'),
          if (e.lastStatusCode != null) InfoRow('Status code', '${e.lastStatusCode}'),
          if (e.latencyMs != null) InfoRow('Latency', '${e.latencyMs} ms'),
          if (e.lastError != null && !e.isSuccess) InfoRow('Error', e.lastError!),
          if (!e.isSuccess) ErrorRefLine(errorRef: e.errorRef, requestId: e.requestId),
        ],
      ],
    );
  }
}

/// "N queued for retry · Retry all" line, kept live from the repository.
class _QueueSummary extends StatefulWidget {
  const _QueueSummary();

  @override
  State<_QueueSummary> createState() => _QueueSummaryState();
}

class _QueueSummaryState extends State<_QueueSummary> {
  StreamSubscription<void>? _sub;
  int _queued = 0;

  @override
  void initState() {
    super.initState();
    final repo = context.read<EventRepository>();
    _sub = repo.changes.listen((_) => _load(repo));
    _load(repo);
  }

  Future<void> _load(EventRepository repo) async {
    final counts = await repo.countByStatus();
    if (mounted) setState(() => _queued = counts[EventStatus.queued] ?? 0);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_queued == 0) return const SizedBox.shrink();
    return Card(
      child: ListTile(
        leading: Icon(Icons.schedule_send, color: StatusColors.warning(context)),
        title: Text('$_queued event${_queued == 1 ? '' : 's'} queued for retry'),
        trailing: TextButton(
          onPressed: () => context.read<AppState>().retryQueue?.retryAllNow(),
          child: const Text('Retry now'),
        ),
      ),
    );
  }
}

/// Opens "Register cards" (pauses event delivery until it closes).
Future<void> openRegisterCards(BuildContext context, AppState app, ReaderController reader, {String? initialUid}) {
  final api = app.api!;
  final canProgram = app.config?.can(Capability.programCards) ?? false;
  final registrar = CardRegistrar(
    api: api,
    nfc: reader.nfc,
    reader: reader,
    businessName: app.config?.business?.name,
    programmer: canProgram ? CardProgrammer(writer: context.read<NfcWriter>(), api: api, reader: reader) : null,
  );
  return Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (_) => RegisterCardsScreen(registrar: registrar, initialUid: initialUid),
  ));
}
