import 'dart:convert';

import 'package:flutter/material.dart';

import '../../core/app_error.dart';
import '../../core/error_catalog.dart';
import '../../data/api_client.dart';
import '../../data/event_repository.dart';
import '../../data/models/api_models.dart';
import '../../data/models/card_read.dart';

/// Maps a personal / developer card-registration failure to a user message.
AppError registerChipError(Object e) => switch (e) {
  ApiException(code: 'card_uid_exists') => AppError.api(e, 'You already registered this card.'),
  ApiException(code: 'card_uid_taken') =>
    AppError.api(e, 'This card is already registered to another account. Each card can only be set up once — use a new card.'),
  ApiException(code: 'no_digital_card') => AppError.api(e, 'Create your digital card first, then register this card.'),
  ApiException() => AppError.api(e),
  NetworkException() => AppError.network(e, 'Server unreachable: '),
  _ => AppError.mob(MobError.invalidServerResponse),
};

/// Asks for an optional name for a card being registered. null = cancelled; '' = no name.
Future<String?> askCardName(BuildContext context, {required String uid, required String title, String hint = 'e.g. Blue card'}) {
  final ctrl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Card ID ${CardUtils.formatUid(uid)}', style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
        const SizedBox(height: 12),
        TextField(
          key: const Key('cardNameField'),
          controller: ctrl,
          autofocus: true,
          maxLength: 120,
          decoration: InputDecoration(labelText: 'Name (optional)', hintText: hint),
          onSubmitted: (v) => Navigator.of(c).pop(v.trim()),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.of(c).pop(), child: const Text('Cancel')),
        FilledButton(
          key: const Key('confirmRegisterCard'),
          onPressed: () => Navigator.of(c).pop(ctrl.text.trim()),
          child: const Text('Register'),
        ),
      ],
    ),
  ).whenComplete(ctrl.dispose);
}

/// Developer devices: the tapped card's status in the application's card list, with "Register this card".
class AppCardPanel extends StatefulWidget {
  const AppCardPanel({super.key, required this.result, required this.uid, required this.eventId, required this.api,
      required this.repository});

  final AppCardResult result;
  final String uid;
  final String eventId;
  final DeviceApi api;

  /// The stored tap is updated after registering, which refreshes this panel.
  final EventRepository repository;

  @override
  State<AppCardPanel> createState() => _AppCardPanelState();
}

class _AppCardPanelState extends State<AppCardPanel> {
  bool _busy = false;
  String? _error;

  Future<void> _register() async {
    final name = await askCardName(context, uid: widget.uid, title: 'Register this card', hint: 'e.g. Alice badge');
    if (name == null || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final repository = widget.repository;
    try {
      await widget.api.registerAppCard(uid: widget.uid, label: name.isEmpty ? null : name);
      // Remember it on the stored tap so the panel shows "Registered" (and survives a restart).
      final record = await repository.get(widget.eventId);
      final label = name.isEmpty ? 'Card ${widget.uid.substring(widget.uid.length - 4)}' : name;
      if (record != null) {
        await repository.upsert(record.copyWith(
            appCardJson: () => jsonEncode({'registered': true, 'label': label})));
      }
    } catch (e) {
      if (mounted) setState(() => _error = registerChipError(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.result;
    final t = Theme.of(context).textTheme;
    if (r.registered) {
      return Row(children: [
        Icon(Icons.verified_outlined, size: 18, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Expanded(child: Text('Registered as ${r.label ?? 'a card'}', key: const Key('appCardRegistered'), style: t.bodyMedium)),
      ]);
    }
    if (!r.canRegister) {
      return Text('This card is registered to another account.', key: const Key('appCardTaken'), style: t.bodySmall);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Not registered to this application yet.', style: t.bodySmall),
      const SizedBox(height: 6),
      FilledButton.tonalIcon(
        key: const Key('registerAppCardButton'),
        onPressed: _busy ? null : _register,
        icon: _busy
            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
            : const Icon(Icons.add_card_outlined),
        label: const Text('Register this card'),
      ),
      if (_error != null) ...[
        const SizedBox(height: 6),
        Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ],
    ]);
  }
}
