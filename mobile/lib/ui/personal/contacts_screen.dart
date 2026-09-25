import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../data/models/personal.dart';
import '../../services/personal_state.dart';
import '../widgets/error_ref.dart';
import 'contact_detail_screen.dart';
import 'exchange_flow.dart';

/// Contacts collected by exchanges, QR and web leads.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  List<Contact> _items = const [];
  bool _loading = true;
  bool _favorites = false;
  String? _tag;
  AppError? _error;

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
    final api = context.read<PersonalState>().api;
    if (api == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await api.contacts(query: _search.text, tag: _tag, favorite: _favorites ? true : null);
      if (mounted) setState(() => _items = items);
    } catch (e) {
      if (mounted) setState(() => _error = exchangeError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tags = {for (final c in _items) ...c.tags}.toList()..sort();
    return Scaffold(
      appBar: AppBar(title: const Text('Contacts')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: TextField(
              key: const Key('contactSearch'),
              controller: _search,
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search name, company, email'),
              onChanged: (_) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 350), _load);
              },
            ),
          ),
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              children: [
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    avatar: const Icon(Icons.star, size: 16),
                    label: const Text('Favourites'),
                    selected: _favorites,
                    onSelected: (v) {
                      setState(() => _favorites = v);
                      _load();
                    },
                  ),
                ),
                for (final t in tags)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: Text('#$t'),
                      selected: _tag == t,
                      onSelected: (v) {
                        setState(() => _tag = v ? t : null);
                        _load();
                      },
                    ),
                  ),
              ],
            ),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: ErrorMessage(_error!)),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _items.isEmpty
                ? const _Empty()
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
                      itemBuilder: (context, i) => _ContactTile(
                        contact: _items[i],
                        onOpen: () async {
                          await Navigator.of(context).push(MaterialPageRoute<void>(
                            builder: (_) => ContactDetailScreen(contact: _items[i]),
                          ));
                          await _load();
                        },
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _ContactTile extends StatelessWidget {
  const _ContactTile({required this.contact, required this.onOpen});
  final Contact contact;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final f = contact.card.fields;
    final photo = contact.card.photoUrl;
    return ListTile(
      key: Key('contact_${contact.id}'),
      onTap: onOpen,
      leading: CircleAvatar(
        foregroundImage: photo == null ? null : NetworkImage(photo),
        onForegroundImageError: photo == null ? null : (_, _) {},
        child: Text(f.initials),
      ),
      title: Row(children: [
        Flexible(child: Text(contact.name, overflow: TextOverflow.ellipsis)),
        if (contact.favorite) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.star, size: 16, color: Colors.amber)),
      ]),
      subtitle: Text(
        [if (f.subtitle.isNotEmpty) f.subtitle, sourceLabel(contact.source), ...contact.tags.map((t) => '#$t')].join(' · '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: contact.live ? const Tooltip(message: 'Live — updates when they edit their card', child: Icon(Icons.sync, size: 18)) : null,
    );
  }
}

String sourceLabel(String s) => switch (s) {
  'nfc_exchange' => 'NFC',
  'qr_exchange' => 'QR',
  'web_lead' => 'Web lead',
  _ => 'Manual',
};

class _Empty extends StatelessWidget {
  const _Empty();
  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(32),
      child: Text('No contacts yet. Tap phones or scan a card QR from My Card → Scan a card.', textAlign: TextAlign.center),
    ),
  );
}
