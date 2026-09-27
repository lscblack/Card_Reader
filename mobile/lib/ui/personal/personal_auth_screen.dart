import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../core/config.dart';
import '../../core/countries.dart';
import '../../core/error_catalog.dart';
import '../../core/http_client.dart';
import '../../core/links.dart';
import '../../services/app_state.dart';
import '../../services/personal_state.dart';
import '../screens/qr_scan_screen.dart';
import '../theme.dart';
import 'sign_in_steps.dart';
import '../widgets/country_picker.dart';
import '../widgets/error_ref.dart';
import '../widgets/server_trust.dart';

/// Sign in / create a personal account / scan the web "Sign in on your phone" QR.
class PersonalAuthScreen extends StatefulWidget {
  const PersonalAuthScreen({super.key, this.loginLink});

  /// From a `nfcterminal://login` deep link: confirm and sign in with it.
  final LoginPayload? loginLink;

  @override
  State<PersonalAuthScreen> createState() => _PersonalAuthScreenState();
}

class _PersonalAuthScreenState extends State<PersonalAuthScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _server;
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _phone = TextEditingController();
  bool _create = false;
  bool _busy = false;
  bool _obscure = true;
  bool _showServer = false;
  bool _emailCodeMode = false;
  String? _country = guessCountry();
  AppError? _error;
  late final PersonalState _personal = context.read<PersonalState>();

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(text: _personal.defaultServer);
    final link = widget.loginLink;
    if (link != null) WidgetsBinding.instance.addPostFrameCallback((_) => _confirmLogin(link));
  }

  @override
  void dispose() {
    for (final c in [_server, _name, _email, _password, _phone]) {
      c.dispose();
    }
    _personal.discardPendingSignIn();
    super.dispose();
  }

  void _done(AppError? err) {
    if (!mounted) return;
    if (err == null && context.read<PersonalState>().signedIn) {
      Navigator.of(context).popUntil((r) => r.isFirst);
    } else {
      setState(() {
        _busy = false;
        _error = err;
      });
    }
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final p = context.read<PersonalState>();
    _done(_create
        ? await p.createAccount(
            server: _server.text,
            fullName: _name.text,
            email: _email.text,
            password: _password.text,
            phone: _phone.text,
            country: _country)
        : _emailCodeMode
            ? await p.requestEmailCode(server: _server.text, email: _email.text)
            : await p.signIn(server: _server.text, email: _email.text, password: _password.text));
  }

  Future<void> _scanQr() async {
    final r = await Navigator.of(context).push<Object>(MaterialPageRoute(
      builder: (_) => QrScanScreen(
        title: 'Scan sign-in code',
        hint: 'On the web, open My Card → Share → "Sign in on your phone" and point the camera at the QR code.',
        errorRef: MobError.invalidLoginQr.ref,
        parse: (raw) => LoginPayload.parse(raw),
      ),
    ));
    if (r is LoginPayload && mounted) await _confirmLogin(r);
  }

  Future<void> _confirmLogin(LoginPayload link) async {
    final warnings = ServerTrust.warnings(link.serverUrl, [
      context.read<PersonalState>().serverUrl,
      context.read<AppState>().serverUrl,
      AppConfig.defaultServerUrl,
    ]);
    var trusted = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setDialog) => AlertDialog(
          key: const Key('loginConfirm'),
          title: const Text('Sign in on this phone?'),
          scrollable: true,
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ServerTrustPanel(
                serverUrl: link.serverUrl,
                warnings: warnings,
                trusted: trusted,
                onTrustedChanged: (v) => setDialog(() => trusted = v),
              ),
              const SizedBox(height: 8),
              const Text('Only continue if you created this code yourself.'),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(
              key: const Key('loginConfirmButton'),
              onPressed: warnings.isNotEmpty && !trusted ? null : () => Navigator.pop(c, true),
              child: const Text('Sign in'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    _done(await context.read<PersonalState>().signInWithCode(link));
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final p = context.watch<PersonalState>();
    final notice = p.notice;
    final step = p.challenge != null || p.emailCode != null;
    return PopScope(
      canPop: !step,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) p.cancelSignIn();
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Personal digital card')),
        body: SafeArea(
          child: step
              ? ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    SignInCodeStep(
                      key: ValueKey(p.challenge?.challengeId ?? p.emailCode?.challengeId),
                      onSignedIn: () => _done(null),
                      onRestart: (e) => setState(() {
                        _busy = false;
                        _error = e;
                      }),
                    ),
                  ],
                )
              : Form(
                key: _form,
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (notice != null) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: StatusColors.warning(context).withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(notice, key: const Key('personalNotice')),
                      ),
                      const SizedBox(height: 16),
                    ],
                    FilledButton.icon(
                      key: const Key('scanLoginQr'),
                      onPressed: _busy ? null : _scanQr,
                      icon: const Icon(Icons.qr_code_scanner),
                      label: const Text('Scan "Sign in on your phone" QR'),
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54)),
                    ),
                    const SizedBox(height: 18),
                    SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(value: false, label: Text('Sign in'), icon: Icon(Icons.login)),
                        ButtonSegment(value: true, label: Text('Create account'), icon: Icon(Icons.person_add_alt)),
                      ],
                      selected: {_create},
                      onSelectionChanged: (s) => setState(() {
                        _create = s.first;
                        _emailCodeMode = false;
                        _error = null;
                      }),
                    ),
                    const SizedBox(height: 18),
                    if (_create) ...[
                      TextFormField(
                        key: const Key('personalName'),
                        controller: _name,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(labelText: 'Full name', prefixIcon: Icon(Icons.person_outline)),
                        validator: (v) => (v?.trim().length ?? 0) < 2 ? 'Enter your name' : null,
                      ),
                      const SizedBox(height: 12),
                    ],
                    TextFormField(
                      key: const Key('personalEmail'),
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
                      validator: (v) => (v?.contains('@') ?? false) ? null : 'Enter a valid email',
                    ),
                    if (!_emailCodeMode || _create) ...[
                    const SizedBox(height: 12),
                    TextFormField(
                      key: const Key('personalPassword'),
                      controller: _password,
                      obscureText: _obscure,
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: (v) => _create && (v?.length ?? 0) < 10
                          ? 'At least 10 characters'
                          : ((v?.isEmpty ?? true) ? 'Enter your password' : null),
                    ),
                    ],
                    if (_create) ...[
                      const SizedBox(height: 12),
                      FormField<String>(
                        key: const Key('personalCountry'),
                        initialValue: _country,
                        validator: (_) => _country == null ? 'Choose your country' : null,
                        builder: (field) => InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () async {
                            final c = await showCountryPicker(context, selected: _country);
                            if (c != null) {
                              setState(() => _country = c);
                              field.didChange(c);
                            }
                          },
                          child: InputDecorator(
                            decoration: InputDecoration(
                              labelText: 'Country',
                              prefixIcon: const Icon(Icons.public),
                              suffixIcon: const Icon(Icons.arrow_drop_down),
                              errorText: field.errorText,
                            ),
                            child: CountryLabel(_country),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _phone,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(labelText: 'Phone (optional)', prefixIcon: Icon(Icons.call_outlined)),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: () => setState(() => _showServer = !_showServer),
                        icon: const Icon(Icons.dns_outlined, size: 18),
                        label: Text(_showServer ? 'Hide server' : 'Server: ${Uri.tryParse(_server.text)?.host ?? _server.text}'),
                      ),
                    ),
                    if (_showServer)
                      TextFormField(
                        controller: _server,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(labelText: 'Server URL'),
                        validator: (v) => ServerUrl.validate(v ?? ''),
                      ),
                    if (_error != null) ...[const SizedBox(height: 12), ErrorMessage(_error!, key: const Key('personalError'))],
                    const SizedBox(height: 20),
                    FilledButton(
                      key: const Key('personalSubmit'),
                      onPressed: _busy ? null : _submit,
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                      child: Text(_busy
                          ? 'Please wait…'
                          : (_create ? 'Create my card' : (_emailCodeMode ? 'Email me a code' : 'Sign in'))),
                    ),
                    if (!_create) ...[
                      const SizedBox(height: 4),
                      TextButton.icon(
                        key: const Key('toggleEmailCode'),
                        onPressed: _busy
                            ? null
                            : () => setState(() {
                                _emailCodeMode = !_emailCodeMode;
                                _error = null;
                              }),
                        icon: Icon(_emailCodeMode ? Icons.password : Icons.mark_email_unread_outlined, size: 18),
                        label: Text(_emailCodeMode ? 'Use my password instead' : 'Email me a code instead'),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Text(
                      'Your phone becomes your card. A digital card is an identifier with a signed, short-lived token — '
                      'not strong authentication.',
                      style: t.bodySmall,
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
        ),
      ),
    );
  }
}
