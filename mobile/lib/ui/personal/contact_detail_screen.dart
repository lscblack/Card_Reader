import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../data/models/personal.dart';
import '../../services/personal_state.dart';
import '../digital_card/card_view.dart';

/// Hands a vCard to the Contacts app / share sheet (Kotlin FileProvider).
class VcardIntents {
  static const _ch = MethodChannel('net.nexventures.nfc_terminal/contacts');

  static Future<bool> save(String vcard, String name) async =>
      await _ch.invokeMethod<bool>('saveVcard', {'vcard': vcard, 'name': name}).catchError((_) => false) ?? false;

  static Future<bool> share(String vcard, String name) async =>
      await _ch.invokeMethod<bool>('shareVcard', {'vcard': vcard, 'name': name}).catchError((_) => false) ?? false;
}

/// Builds a vCard 3.0 locally (fallback when the server vCard isn't reachable).
String buildVcard(DigitalCard c) {
  String esc(String v) =>
      v.replaceAll(r'\', r'\\').replaceAll(',', r'\,').replaceAll(';', r'\;').replaceAll('\n', r'\n');
  final f = c.fields;
  final parts = f.fullName.trim().split(RegExp(r'\s+'));
  final b = StringBuffer()
    ..writeln('BEGIN:VCARD')
    ..writeln('VERSION:3.0')
    ..writeln('FN:${esc(f.fullName)}')
    ..writeln('N:${esc(parts.length > 1 ? parts.last : f.fullName)};${esc(parts.length > 1 ? parts.sublist(0, parts.length - 1).join(' ') : '')};;;');
  if (f.company != null) b.writeln('ORG:${esc(f.company!)}');
  if (f.jobTitle != null) b.writeln('TITLE:${esc(f.jobTitle!)}');
  for (final p in f.phones) {
    b.writeln('TEL;TYPE=${esc(p.label.isEmpty ? 'CELL' : p.label.toUpperCase())}:${esc(p.value)}');
  }
  for (final e in f.emails) {
    b.writeln('EMAIL;TYPE=INTERNET:${esc(e.value)}');
  }
  for (final w in [...f.websites, ...f.socials, ...f.customLinks]) {
    b.writeln('URL:${esc(w.value)}');
  }
  if (f.address != null) b.writeln('ADR;TYPE=WORK:;;${esc(f.address!)};;;;');
  if (f.bio != null) b.writeln('NOTE:${esc(f.bio!)}');
  b.write('END:VCARD');
  return b.toString();
}

class ContactDetailScreen extends StatefulWidget {
  const ContactDetailScreen({super.key, required this.contact});
  final Contact contact;

  @override
  State<ContactDetailScreen> createState() => _ContactDetailScreenState();
}

class _ContactDetailScreenState extends State<ContactDetailScreen> {
  late Contact _c = widget.contact;
  late final _notes = TextEditingController(text: widget.contact.notes);
  final _tag = TextEditingController();

  @override
  void dispose() {
    _notes.dispose();
    _tag.dispose();
    super.dispose();
  }

  Future<void> _patch(Map<String, Object?> patch, Contact optimistic) async {
    setState(() => _c = optimistic);
    final api = context.read<PersonalState>().api;
    try {
      final updated = await api?.updateContact(_c.id, patch);
      if (updated != null && mounted) setState(() => _c = updated);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Not saved: $e')));
    }
  }

  Future<String> _vcard() async {
    try {
      final v = await context.read<PersonalState>().api?.contactVcard(_c.id);
      if (v != null && v.contains('BEGIN:VCARD')) return v;
    } catch (_) {}
    return buildVcard(_c.card);
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<PersonalState>();
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(_c.name),
        actions: [
          IconButton(
            tooltip: _c.favorite ? 'Unfavourite' : 'Favourite',
            icon: Icon(_c.favorite ? Icons.star : Icons.star_border),
            onPressed: () => _patch({'favorite': !_c.favorite}, _c.copyWith(favorite: !_c.favorite)),
          ),
          PopupMenuButton<String>(
            onSelected: (v) async {
              final nav = Navigator.of(context);
              if (v == 'delete') {
                try {
                  await p.api?.deleteContact(_c.id);
                  nav.pop();
                } catch (_) {}
              }
            },
            itemBuilder: (_) => const [PopupMenuItem(value: 'delete', child: Text('Delete contact'))],
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DigitalCardView(card: _c.card, layout: _c.templateLayout ?? p.templateFor(_c.card.templateId).layout, hideHiddenFields: false),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: FilledButton.icon(
                key: const Key('saveToPhone'),
                onPressed: () async => VcardIntents.save(await _vcard(), _c.name),
                icon: const Icon(Icons.person_add_alt),
                label: const Text('Save to phone'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () async => VcardIntents.share(await _vcard(), _c.name),
                icon: const Icon(Icons.share_outlined),
                label: const Text('Share'),
              ),
            ),
          ]),
          const SizedBox(height: 20),
          Text('Tags', style: t.titleSmall),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 4, children: [
            for (final tag in _c.tags)
              InputChip(
                label: Text('#$tag'),
                onDeleted: () {
                  final tags = [..._c.tags]..remove(tag);
                  _patch({'tags': tags}, _c.copyWith(tags: tags));
                },
              ),
            SizedBox(
              width: 140,
              child: TextField(
                key: const Key('addTag'),
                controller: _tag,
                decoration: const InputDecoration(hintText: 'Add tag', isDense: true, prefixIcon: Icon(Icons.tag, size: 18)),
                onSubmitted: (v) {
                  final tag = v.trim().replaceAll('#', '');
                  if (tag.isEmpty || _c.tags.contains(tag)) return;
                  final tags = [..._c.tags, tag];
                  _tag.clear();
                  _patch({'tags': tags}, _c.copyWith(tags: tags));
                },
              ),
            ),
          ]),
          const SizedBox(height: 20),
          Text('Notes', style: t.titleSmall),
          const SizedBox(height: 6),
          TextField(
            key: const Key('contactNotes'),
            controller: _notes,
            minLines: 3,
            maxLines: 8,
            decoration: const InputDecoration(hintText: 'Where you met, what to follow up on…'),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => _patch({'notes': _notes.text}, _c.copyWith(notes: _notes.text)),
              child: const Text('Save notes'),
            ),
          ),
          if (_c.metAt != null) Text('Met: ${_c.metAt!.split('T').first} · via ${_c.source.replaceAll('_', ' ')}', style: t.bodySmall),
          if (_c.live) Text('Live contact — updates when they edit their card.', style: t.bodySmall),
        ],
      ),
    );
  }
}
