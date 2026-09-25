import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/config.dart';
import '../../data/event_repository.dart';
import '../../data/models/card_read.dart';
import '../../data/models/event_record.dart';
import '../format.dart';
import '../widgets/common.dart';
import 'event_detail_screen.dart';

/// Local event history with a status filter.
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  EventStatus? _filter;
  List<EventRecord> _items = const [];
  bool _loading = true;
  StreamSubscription<void>? _sub;
  Timer? _debounce;

  EventRepository get _repo => context.read<EventRepository>();

  @override
  void initState() {
    super.initState();
    _sub = _repo.changes.listen((_) {
      _debounce?.cancel();
      _debounce = Timer(const Duration(milliseconds: 300), _load);
    });
    _load();
  }

  @override
  void dispose() {
    _sub?.cancel();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final items = await _repo.list(status: _filter, limit: AppConfig.historyCap);
    if (!mounted) return;
    setState(() {
      _items = items;
      _loading = false;
    });
  }

  Future<void> _clear() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Clear history?'),
        content: const Text(
          'Removes the local event history on this phone. Events still waiting for a retry are kept. '
          'Events already sent remain visible in the dashboard.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Clear')),
        ],
      ),
    );
    if (ok == true) await _repo.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('History'),
        actions: [
          IconButton(tooltip: 'Clear history', icon: const Icon(Icons.delete_sweep_outlined), onPressed: _clear),
        ],
      ),
      body: Column(
        children: [
          SizedBox(
            height: 56,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              children: [
                _chip(null, 'All'),
                for (final s in EventStatus.values) _chip(s, EventStatusChip.label(s)),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _items.isEmpty
                ? const _Empty()
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1, indent: 16),
                      itemBuilder: (context, i) => _EventTile(event: _items[i]),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _chip(EventStatus? s, String label) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: ChoiceChip(
      label: Text(label),
      selected: _filter == s,
      onSelected: (_) {
        setState(() => _filter = s);
        _load();
      },
    ),
  );
}

class _EventTile extends StatelessWidget {
  const _EventTile({required this.event});

  final EventRecord event;

  @override
  Widget build(BuildContext context) {
    final e = event;
    final business = e.business;
    final detail = [
      if (business?.message != null) business!.message!,
      '${e.attempts} attempt${e.attempts == 1 ? '' : 's'}',
      if (e.lastStatusCode != null) 'HTTP ${e.lastStatusCode}',
      if (!e.isSuccess && e.lastError != null) e.lastError!,
      if (!e.isSuccess && e.errorRef != null) e.errorRef!,
    ].join(' · ');
    return ListTile(
      title: Text(CardUtils.formatUid(e.cardId), style: const TextStyle(fontFamily: 'monospace')),
      subtitle: Text(
        '${formatLocalTime(e.detectedAt)} · ${e.deliveryMode.name}\n$detail',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      isThreeLine: true,
      trailing: EventStatusChip(e.status),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => EventDetailScreen(eventId: e.eventId)),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.history, size: 48, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 8),
          const Text('No events yet'),
        ],
      ),
    );
  }
}
