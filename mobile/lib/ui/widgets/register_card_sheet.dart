import 'package:flutter/material.dart';

import '../../core/app_error.dart';
import '../../data/api_client.dart';
import '../../data/models/card_read.dart';
import '../../services/card_programmer.dart';
import 'error_ref.dart';

/// "Register this card" (C3 `POST /device/business/cards`). Returns true on success.
Future<bool> showRegisterCardSheet(BuildContext context, {required DeviceApi api, required String uid}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => RegisterCardSheet(api: api, uid: uid),
  );
  return ok ?? false;
}

class RegisterCardSheet extends StatefulWidget {
  const RegisterCardSheet({super.key, required this.api, required this.uid});

  final DeviceApi api;
  final String uid;

  @override
  State<RegisterCardSheet> createState() => _RegisterCardSheetState();
}

class _RegisterCardSheetState extends State<RegisterCardSheet> {
  final _name = TextEditingController();
  String _kind = 'card';
  bool _busy = false;
  AppError? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.registerBusinessCard(uid: widget.uid, name: _name.text, kind: _kind);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = registerCardError(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Register this card', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text('UID ${CardUtils.formatUid(widget.uid)}', style: const TextStyle(fontFamily: 'monospace')),
          const SizedBox(height: 16),
          TextField(
            key: const Key('registerCardName'),
            controller: _name,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Name (optional)', hintText: 'e.g. Table 4, John\'s badge'),
          ),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'card', label: Text('Card'), icon: Icon(Icons.badge_outlined)),
              ButtonSegment(value: 'tag', label: Text('Tag'), icon: Icon(Icons.sell_outlined)),
            ],
            selected: {_kind},
            onSelectionChanged: (s) => setState(() => _kind = s.first),
          ),
          const SizedBox(height: 4),
          Text(
            _kind == 'card' ? 'Held by a person (employee or customer).' : 'Placed on a thing: table, product, door…',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (_error != null) ...[const SizedBox(height: 12), ErrorMessage(_error!, key: const Key('registerCardError'))],
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('registerCardSubmit'),
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? 'Registering…' : 'Register'),
          ),
        ],
      ),
    );
  }
}
