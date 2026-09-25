import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/time_utils.dart';
import '../../data/event_repository.dart';
import '../../data/models/card_read.dart';
import '../../data/models/event_record.dart';
import '../../services/app_state.dart';
import '../format.dart';
import '../widgets/business_result.dart';
import '../widgets/common.dart';
import '../widgets/digital_card_result.dart';
import '../widgets/error_ref.dart';

class EventDetailScreen extends StatefulWidget {
  const EventDetailScreen({super.key, required this.eventId});

  final String eventId;

  @override
  State<EventDetailScreen> createState() => _EventDetailScreenState();
}

class _EventDetailScreenState extends State<EventDetailScreen> {
  EventRecord? _event;
  StreamSubscription<void>? _sub;

  @override
  void initState() {
    super.initState();
    final repo = context.read<EventRepository>();
    _sub = repo.changes.listen((_) => _load(repo));
    _load(repo);
  }

  Future<void> _load(EventRepository repo) async {
    final e = await repo.get(widget.eventId);
    if (mounted) setState(() => _event = e);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final e = _event;
    final retryQueue = context.watch<AppState>().retryQueue;
    return Scaffold(
      appBar: AppBar(title: const Text('Event')),
      body: e == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                SectionCard(
                  title: 'Card',
                  children: [
                    const UidOnlyNote(),
                    const SizedBox(height: 8),
                    InfoRow('Card ID', e.cardId, mono: true),
                    InfoRow('Formatted', CardUtils.formatUid(e.cardId), mono: true),
                    InfoRow('Type', e.cardType ?? 'unknown'),
                    InfoRow('Technologies', e.technologies.join(', ')),
                    InfoRow('Detected', '${formatLocalTime(e.detectedAt)}\n${isoUtc(e.detectedAt)}'),
                  ],
                ),
                if (e.digitalCardToken != null && e.business == null) ...[
                  const SizedBox(height: 12),
                  DigitalCardResult(summary: e.digitalCard, shareIdHex: e.cardId),
                ],
                if (e.business != null) ...[
                  const SizedBox(height: 12),
                  BusinessResultCard(result: e.business!),
                ],
                const SizedBox(height: 12),
                SectionCard(
                  title: 'Delivery',
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: EventStatusChip(e.status),
                    ),
                    InfoRow('Event ID', e.eventId, mono: true),
                    InfoRow('Mode', e.deliveryMode.name),
                    InfoRow('Attempts', '${e.attempts}'),
                    InfoRow('Status code', e.lastStatusCode?.toString() ?? '—'),
                    InfoRow('Latency', e.latencyMs == null ? '—' : '${e.latencyMs} ms'),
                    InfoRow('Error', e.lastError ?? '—'),
                    if (!e.isSuccess) ErrorRefLine(errorRef: e.errorRef, requestId: e.requestId),
                    if (e.nextAttemptAt != null && e.status == EventStatus.queued)
                      InfoRow('Next retry', formatLocalTime(e.nextAttemptAt!)),
                    if (e.pendingReport != null) const InfoRow('Report', 'Outcome not yet reported to the platform'),
                    InfoRow('Updated', formatLocalTime(e.updatedAt)),
                  ],
                ),
                const SizedBox(height: 16),
                if (retryQueue != null && (e.status == EventStatus.queued || e.status == EventStatus.failed))
                  FilledButton.icon(
                    onPressed: () => retryQueue.retryNow(e.eventId),
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry now'),
                  ),
                if (e.status == EventStatus.retrying)
                  const Text(
                    'The platform accepted this event and retries delivery to the endpoint itself. '
                    'Follow it in the dashboard.',
                  ),
              ],
            ),
    );
  }
}
