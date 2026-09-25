import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/app_error.dart';
import '../../data/api_client.dart';
import '../../data/models/business.dart';
import '../../services/card_programmer.dart';
import '../theme.dart';
import '../widgets/error_ref.dart';

/// Pick a business card and write its tap URL to a physical card (C3).
class ProgramCardScreen extends StatefulWidget {
  const ProgramCardScreen({super.key, required this.api, required this.programmer});

  final DeviceApi api;
  final CardProgrammer programmer;

  @override
  State<ProgramCardScreen> createState() => _ProgramCardScreenState();
}

class _ProgramCardScreenState extends State<ProgramCardScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  bool _unprogrammedOnly = true;
  bool _loading = true;
  AppError? _error;
  List<BusinessCardItem> _items = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await widget.api.listBusinessCards(
        query: _search.text,
        programmed: _unprogrammedOnly ? false : null,
      );
      if (mounted) setState(() => _items = items);
    } catch (e) {
      if (mounted) setState(() => _error = registerCardError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _program(BusinessCardItem card) async {
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => ProgramWriteScreen(card: card, programmer: widget.programmer)),
    );
    if (ok == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Program a card')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: TextField(
              key: const Key('programSearch'),
              controller: _search,
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search cards and tags'),
              onChanged: (_) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 350), _load);
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                FilterChip(
                  key: const Key('unprogrammedOnly'),
                  label: const Text('Not programmed yet'),
                  selected: _unprogrammedOnly,
                  onSelected: (v) {
                    setState(() => _unprogrammedOnly = v);
                    _load();
                  },
                ),
              ],
            ),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: ErrorMessage(_error!)),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _items.isEmpty
                ? const Center(child: Text('No cards found. Create cards in the dashboard first.'))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1, indent: 16),
                      itemBuilder: (_, i) {
                        final c = _items[i];
                        return ListTile(
                          key: Key('programItem_${c.id}'),
                          leading: Icon(c.kind == 'tag' ? Icons.sell_outlined : Icons.badge_outlined),
                          title: Text(c.name),
                          subtitle: Text([
                            ?c.assigneeName,
                            ?c.uidMasked,
                            if (c.programmed) 'programmed',
                          ].join(' · ')),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => _program(c),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// "Hold the card to the phone" → write → report.
class ProgramWriteScreen extends StatefulWidget {
  const ProgramWriteScreen({super.key, required this.card, required this.programmer});

  final BusinessCardItem card;
  final CardProgrammer programmer;

  @override
  State<ProgramWriteScreen> createState() => _ProgramWriteScreenState();
}

class _ProgramWriteScreenState extends State<ProgramWriteScreen> {
  ProgramOutcome? _outcome;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    if (_busy) widget.programmer.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _busy = true;
      _outcome = null;
    });
    final r = await widget.programmer.program(widget.card);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _outcome = r;
    });
  }

  @override
  Widget build(BuildContext context) {
    final o = _outcome;
    final t = Theme.of(context).textTheme;
    return PopScope(
      canPop: true,
      child: Scaffold(
        appBar: AppBar(title: Text(widget.card.name)),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (o == null) ...[
                Icon(Icons.contactless_outlined, size: 96, color: StatusColors.active(context)),
                const SizedBox(height: 16),
                Text('Hold the card to the phone', style: t.headlineSmall, textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text(
                  'The link for "${widget.card.name}" will be written to the card. Keep it still until done. '
                  'Reads are paused meanwhile.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                const Center(child: CircularProgressIndicator()),
                const SizedBox(height: 24),
                OutlinedButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
              ] else if (o.ok) ...[
                Icon(Icons.check_circle_outline, size: 96, color: StatusColors.success(context)),
                const SizedBox(height: 16),
                Text('Card programmed ✓', key: const Key('programSuccess'), style: t.headlineSmall, textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text('UID ${o.uid}', textAlign: TextAlign.center, style: const TextStyle(fontFamily: 'monospace')),
                const SizedBox(height: 24),
                FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Done')),
              ] else ...[
                Icon(Icons.error_outline, size: 96, color: StatusColors.error(context)),
                const SizedBox(height: 16),
                Text('Programming failed', style: t.headlineSmall, textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Center(child: ErrorMessage(o.error!, key: const Key('programError'))),
                const SizedBox(height: 24),
                FilledButton(onPressed: _busy ? null : _start, child: const Text('Try again')),
                TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Close')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
