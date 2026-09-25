import 'package:flutter/material.dart';

import '../../data/models/event_record.dart';
import '../theme.dart';

/// Label/value line used on info cards.
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.mono = false, this.trailing});

  final String label;
  final String value;
  final bool mono;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: mono ? t.bodyMedium?.copyWith(fontFamily: 'monospace') : t.bodyMedium,
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Section card with an optional title.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, required this.children});

  final String? title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title != null) ...[
              Text(title!, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 4),
            ],
            ...children,
          ],
        ),
      ),
    );
  }
}

/// "UID only (not authenticated)" reminder.
class UidOnlyNote extends StatelessWidget {
  const UidOnlyNote({super.key, this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final color = StatusColors.warning(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.shield_outlined, size: 16, color: color),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            compact ? 'UID only (not authenticated)' : 'Card detected · UID only (not authenticated)',
            style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color),
          ),
        ),
      ],
    );
  }
}

/// Coloured chip for an [EventStatus].
class EventStatusChip extends StatelessWidget {
  const EventStatusChip(this.status, {super.key});

  final EventStatus status;

  static String label(EventStatus s) => switch (s) {
    EventStatus.pending => 'Sending',
    EventStatus.delivered => 'Delivered',
    EventStatus.queued => 'Queued for retry',
    EventStatus.retrying => 'Platform retrying',
    EventStatus.failed => 'Failed',
    EventStatus.logged => 'Logged',
  };

  static Color color(BuildContext c, EventStatus s) => switch (s) {
    EventStatus.delivered || EventStatus.logged => StatusColors.success(c),
    EventStatus.queued || EventStatus.retrying => StatusColors.warning(c),
    EventStatus.failed => StatusColors.error(c),
    EventStatus.pending => StatusColors.neutral(c),
  };

  @override
  Widget build(BuildContext context) {
    final c = color(context, status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label(status), style: Theme.of(context).textTheme.labelSmall?.copyWith(color: c)),
    );
  }
}
