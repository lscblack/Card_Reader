import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../core/countries.dart';
import '../../services/personal_state.dart';
import '../widgets/country_picker.dart';
import '../widgets/error_ref.dart';

/// Shown after sign-in when the account has no country yet (required; can't be skipped).
class CountryGateScreen extends StatefulWidget {
  const CountryGateScreen({super.key, this.localeName});

  /// Overrides the device locale used for the default guess (tests).
  final String? localeName;

  @override
  State<CountryGateScreen> createState() => _CountryGateScreenState();
}

class _CountryGateScreenState extends State<CountryGateScreen> {
  late String? _selected = guessCountry(widget.localeName);
  bool _busy = false;
  AppError? _error;

  Future<void> _save() async {
    final code = _selected;
    if (code == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final err = await context.read<PersonalState>().setCountry(code);
    if (mounted) {
      setState(() {
        _busy = false;
        _error = err;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return PopScope(
      canPop: false,
      child: Scaffold(
        key: const Key('countryGate'),
        appBar: AppBar(title: const Text('Choose your country'), automaticallyImplyLeading: false),
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: Text('Your account needs a country before you continue. You can change it later in settings.',
                    style: t.bodyMedium),
              ),
              Expanded(child: CountryList(selected: _selected, onSelected: (c) => setState(() => _selected = c))),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_error != null) ...[ErrorMessage(_error!), const SizedBox(height: 8)],
                    FilledButton(
                      key: const Key('countrySave'),
                      onPressed: _busy || _selected == null ? null : _save,
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                      child: Text(_busy
                          ? 'Saving…'
                          : _selected == null
                              ? 'Choose a country'
                              : 'Continue with ${countryName(_selected)}'),
                    ),
                    TextButton(
                      onPressed: _busy ? null : () => context.read<PersonalState>().signOut(),
                      child: const Text('Sign out of My Card'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
