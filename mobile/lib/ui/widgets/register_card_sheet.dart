import 'package:flutter/material.dart';

import '../../core/app_error.dart';
import '../../data/api_client.dart';
import '../../data/models/card_read.dart';
import '../../services/card_programmer.dart';
import 'error_ref.dart';

/// Values chosen in the registration sheet.
class RegisterChoice {
  const RegisterChoice({required this.name, required this.kind, required this.assignToBusiness, this.note});
  final String name, kind;
  final bool assignToBusiness;
  final String? note;
}

/// Submits a [RegisterChoice]; returns an error to show, or null when done.
typedef RegisterSubmit = Future<AppError?> Function(RegisterChoice choice);

/// "Register this card" (C3 `POST /device/business/cards`) for a single card. Returns true on success.
Future<bool> showRegisterCardSheet(BuildContext context, {required DeviceApi api, required String uid, String? businessName}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (c) => RegisterCardSheet(
      uid: uid,
      businessName: businessName,
      onSubmit: (r) async {
        try {
          await api.registerBusinessCard(
            uid: uid,
            name: r.name,
            kind: r.kind,
            assignToBusiness: businessName == null ? null : r.assignToBusiness,
            note: r.note,
          );
          if (c.mounted) Navigator.of(c).pop(true);
          return null;
        } catch (e) {
          return registerCardError(e);
        }
      },
    ),
  );
  return ok ?? false;
}

/// Registration form: name (prefilled), kind, owner (company / unassigned), optional note.
class RegisterCardSheet extends StatefulWidget {
  const RegisterCardSheet({
    super.key,
    required this.uid,
    required this.onSubmit,
    this.initialName = '',
    this.kind = 'card',
    this.assignToBusiness = true,
    this.businessName,
    this.nameFor,
    this.writeHint,
  });

  final String uid;
  final RegisterSubmit onSubmit;
  final String initialName;
  final String kind;
  final bool assignToBusiness;

  /// Null hides the owner choice (unknown business).
  final String? businessName;

  /// Suggested name per kind (switching kind updates an untouched suggestion).
  final String Function(String kind)? nameFor;

  /// E.g. "The tap link is written right after." (register mode with writing on).
  final String? writeHint;

  @override
  State<RegisterCardSheet> createState() => _RegisterCardSheetState();
}

class _RegisterCardSheetState extends State<RegisterCardSheet> {
  late final _name = TextEditingController(text: widget.initialName);
  final _note = TextEditingController();
  late String _kind = widget.kind;
  late bool _company = widget.assignToBusiness;
  bool _busy = false;
  AppError? _error;

  @override
  void dispose() {
    _name.dispose();
    _note.dispose();
    super.dispose();
  }

  void _setKind(String k) {
    final suggest = widget.nameFor;
    setState(() {
      if (suggest != null && _name.text == suggest(_kind)) _name.text = suggest(k);
      _kind = k;
    });
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final err = await widget.onSubmit(RegisterChoice(
      name: _name.text,
      kind: _kind,
      assignToBusiness: _company,
      note: _note.text.trim().isEmpty ? null : _note.text.trim(),
    ));
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = err;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final business = widget.businessName;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Register this card', style: t.titleLarge),
          const SizedBox(height: 4),
          Text('UID ${CardUtils.formatUid(widget.uid)}', style: const TextStyle(fontFamily: 'monospace')),
          const SizedBox(height: 16),
          TextField(
            key: const Key('registerCardName'),
            controller: _name,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Name', hintText: 'e.g. Table 4, John\'s badge'),
          ),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            key: const Key('registerKind'),
            segments: const [
              ButtonSegment(value: 'card', label: Text('Card'), icon: Icon(Icons.badge_outlined)),
              ButtonSegment(value: 'tag', label: Text('Tag'), icon: Icon(Icons.sell_outlined)),
            ],
            selected: {_kind},
            onSelectionChanged: (s) => _setKind(s.first),
          ),
          const SizedBox(height: 4),
          Text(
            _kind == 'card' ? 'Held by a person (employee or customer).' : 'Placed on a thing: table, product, door…',
            style: t.bodySmall,
          ),
          if (business != null) ...[
            const SizedBox(height: 14),
            Text('Owner', style: t.titleSmall),
            RadioGroup<bool>(
              groupValue: _company,
              onChanged: (v) => setState(() => _company = v ?? true),
              child: Column(children: [
                RadioListTile<bool>(
                  key: const Key('ownerCompany'),
                  contentPadding: EdgeInsets.zero,
                  value: true,
                  title: Text('Company ($business)'),
                  subtitle: const Text('The card belongs to the business itself'),
                ),
                RadioListTile<bool>(
                  key: const Key('ownerUnassigned'),
                  contentPadding: EdgeInsets.zero,
                  value: false,
                  title: const Text('Unassigned'),
                  subtitle: const Text('Assign it to a person later on the web'),
                ),
              ]),
            ),
          ],
          const SizedBox(height: 8),
          TextField(
            key: const Key('registerCardNote'),
            controller: _note,
            maxLength: 200,
            decoration: const InputDecoration(labelText: 'Note (optional)'),
          ),
          if (widget.writeHint != null) Text(widget.writeHint!, style: t.bodySmall),
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
