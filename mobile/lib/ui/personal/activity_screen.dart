import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../data/models/personal.dart';
import '../../services/personal_state.dart';
import '../widgets/error_ref.dart';
import 'exchange_flow.dart';
import '../widgets/motion.dart';

class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key});

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  List<ActivityItem>? _items;
  AppError? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await context.read<PersonalState>().api?.activity() ?? const <ActivityItem>[];
      if (mounted) setState(() => _items = items);
    } catch (e) {
      if (mounted) setState(() => _error = exchangeError(e));
    }
  }

  static IconData _icon(String type) => switch (type) {
    final t when t.contains('view') => Icons.visibility_outlined,
    final t when t.contains('exchange') => Icons.sync_alt,
    final t when t.contains('lead') => Icons.person_add_alt,
    final t when t.contains('terminal') || t.contains('read') => Icons.point_of_sale_outlined,
    final t when t.contains('tap') => Icons.contactless_outlined,
    _ => Icons.bolt_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: AppBar(title: const Text('Activity')),
      body: _error != null
          ? Padding(padding: const EdgeInsets.all(16), child: ErrorMessage(_error!))
          : items == null
          ? const Center(child: CircularProgressIndicator())
          : items.isEmpty
          ? const Center(child: Text('No activity yet'))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
                itemBuilder: (_, i) {
                  final a = items[i];
                  return StaggeredEntrance(index: i, child: ListTile(
                    leading: CircleAvatar(child: Icon(_icon(a.type))),
                    title: Text(a.title),
                    subtitle: Text([?a.detail, ?a.source, ?a.createdAt?.replaceFirst('T', ' ').split('.').first].join(' · ')),
                  ));
                },
              ),
            ),
    );
  }
}
