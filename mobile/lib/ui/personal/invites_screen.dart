import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../data/models/personal.dart';
import '../../services/personal_state.dart';
import '../widgets/error_ref.dart';
import 'exchange_flow.dart';

/// Business-issued employee digital cards (Part 4 §6).
class InvitesScreen extends StatefulWidget {
  const InvitesScreen({super.key});

  @override
  State<InvitesScreen> createState() => _InvitesScreenState();
}

class _InvitesScreenState extends State<InvitesScreen> {
  List<BusinessInvite>? _items;
  AppError? _error;
  final _busy = <String>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await context.read<PersonalState>().api?.businessInvites() ?? const <BusinessInvite>[];
      if (mounted) setState(() => _items = items);
    } catch (e) {
      if (mounted) setState(() => _error = exchangeError(e));
    }
  }

  Future<void> _respond(BusinessInvite i, bool accept) async {
    final p = context.read<PersonalState>();
    setState(() => _busy.add(i.id));
    try {
      await p.api?.respondToInvite(i.id, accept: accept);
      if (accept) await p.refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(accept ? 'Card from ${i.businessName} added to your cards ✓' : 'Invitation declined'),
        ));
      }
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = exchangeError(e));
    } finally {
      if (mounted) setState(() => _busy.remove(i.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items?.where((i) => i.status == 'pending').toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Business invites')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) ErrorMessage(_error!),
          if (items == null)
            const Center(child: CircularProgressIndicator())
          else if (items.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('No invitations. When your company issues you a digital card, it appears here.', textAlign: TextAlign.center),
            )
          else
            for (final i in items)
              Card(
                key: Key('invite_${i.id}'),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(i.businessName, style: Theme.of(context).textTheme.titleMedium),
                      Text('Invites you to use a company digital card${i.employeeName == null ? '' : ' as ${i.employeeName}'}. '
                          'Some fields and the design are managed by the company.'),
                      const SizedBox(height: 10),
                      Wrap(spacing: 8, runSpacing: 4, children: [
                        FilledButton(
                          key: Key('accept_${i.id}'),
                          onPressed: _busy.contains(i.id) ? null : () => _respond(i, true),
                          child: const Text('Accept'),
                        ),
                        TextButton(onPressed: _busy.contains(i.id) ? null : () => _respond(i, false), child: const Text('Decline')),
                      ]),
                    ],
                  ),
                ),
              ),
        ],
      ),
    );
  }
}
