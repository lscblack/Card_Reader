import 'package:flutter/material.dart';

import '../../core/countries.dart';

/// Search field + list of countries (flag, name); [onSelected] gets the ISO code.
class CountryList extends StatefulWidget {
  const CountryList({super.key, this.selected, required this.onSelected, this.autofocus = false});

  final String? selected;
  final ValueChanged<String> onSelected;
  final bool autofocus;

  @override
  State<CountryList> createState() => _CountryListState();
}

class _CountryListState extends State<CountryList> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  String _q = '';

  static const _rowHeight = 56.0;

  @override
  void initState() {
    super.initState();
    final i = kCountries.indexWhere((c) => c.code == widget.selected);
    if (i > 2) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.jumpTo(((i - 2) * _rowHeight).clamp(0, _scroll.position.maxScrollExtent));
      });
    }
  }

  @override
  void dispose() {
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  List<Country> get _filtered {
    final q = _q.trim().toLowerCase();
    if (q.isEmpty) return kCountries;
    return kCountries.where((c) => c.name.toLowerCase().contains(q) || c.code.toLowerCase() == q).toList();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final list = _filtered;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: TextField(
            key: const Key('countrySearch'),
            controller: _search,
            autofocus: widget.autofocus,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search countries',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _q.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () => setState(() {
                        _search.clear();
                        _q = '';
                      }),
                    ),
            ),
            onChanged: (v) => setState(() => _q = v),
          ),
        ),
        Expanded(
          child: list.isEmpty
              ? const Center(child: Text('No country matches.'))
              : ListView.builder(
                  controller: _scroll,
                  itemCount: list.length,
                  itemExtent: _rowHeight,
                  itemBuilder: (context, i) {
                    final c = list[i];
                    final on = c.code == widget.selected;
                    return ListTile(
                      key: Key('country_${c.code}'),
                      leading: Text(c.flag, style: const TextStyle(fontSize: 24)),
                      title: Text(c.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                      trailing: on ? Icon(Icons.check_circle, color: scheme.primary) : null,
                      selected: on,
                      onTap: () => widget.onSelected(c.code),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// Full-screen country picker; returns the chosen ISO code (null when closed).
Future<String?> showCountryPicker(BuildContext context, {String? selected}) => Navigator.of(context).push<String>(
  MaterialPageRoute(
    fullscreenDialog: true,
    builder: (c) => Scaffold(
      appBar: AppBar(title: const Text('Country')),
      body: SafeArea(
        top: false,
        child: CountryList(selected: selected, onSelected: (code) => Navigator.pop(c, code)),
      ),
    ),
  ),
);

/// "🇷🇼 Rwanda" (or a placeholder when no country is set).
class CountryLabel extends StatelessWidget {
  const CountryLabel(this.code, {super.key, this.placeholder = 'Choose your country'});

  final String? code;
  final String placeholder;

  @override
  Widget build(BuildContext context) {
    final name = countryName(code);
    if (name == null) {
      return Text(placeholder, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant));
    }
    return Text('${countryFlag(code!)}  $name', maxLines: 1, overflow: TextOverflow.ellipsis);
  }
}
