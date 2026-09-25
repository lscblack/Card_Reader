import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../core/config.dart';
import '../../core/http_client.dart';
import '../../core/pairing.dart';
import '../../services/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/error_ref.dart';
import 'pair_confirm_screen.dart';
import 'qr_scan_screen.dart';

/// First-run screen: server URL + API key + device name → register.
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key});

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _url;
  final _apiKey = TextEditingController();
  late final TextEditingController _name;
  bool _obscure = true;
  bool _busy = false;
  AppError? _error;

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    _url = TextEditingController(text: app.serverUrl ?? AppConfig.defaultServerUrl)
      ..addListener(() => setState(() {}));
    _name = TextEditingController(text: app.device?.suggestedName ?? '');
  }

  @override
  void dispose() {
    _url.dispose();
    _apiKey.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim();
    if (text != null && text.isNotEmpty) _apiKey.text = text;
  }

  Future<void> _scanQr() async {
    final nav = Navigator.of(context);
    final payload = await nav.push<PairingPayload>(
      MaterialPageRoute(builder: (_) => const QrScanScreen()),
    );
    if (payload == null || !mounted) return;
    await nav.push(MaterialPageRoute<void>(builder: (_) => PairConfirmScreen(pairing: payload)));
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final app = context.read<AppState>();
    final error = await app.register(
      serverUrl: _url.text,
      apiKey: _apiKey.text,
      deviceName: _name.text,
    );
    if (!mounted) return;
    // The API key is never kept: clear the field once registered.
    if (error == null) _apiKey.clear();
    setState(() {
      _busy = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final t = Theme.of(context).textTheme;
    final insecure = ServerUrl.validate(_url.text) == null && ServerUrl.isInsecure(_url.text);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.contactless_outlined, size: 56, color: Theme.of(context).colorScheme.primary),
                    const SizedBox(height: 12),
                    Text('NFC Terminal', style: t.headlineMedium, textAlign: TextAlign.center),
                    const SizedBox(height: 4),
                    Text(
                      'Connect this phone to your application: scan the pairing QR code from the dashboard, '
                      'or enter an API key (used once, never stored).',
                      style: t.bodyMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),
                    if (app.setupNotice != null) ...[
                      _Banner(icon: Icons.info_outline, text: app.setupNotice!, color: StatusColors.warning(context)),
                      const SizedBox(height: 16),
                    ],
                    FilledButton.icon(
                      key: const Key('scanQrButton'),
                      onPressed: _busy ? null : _scanQr,
                      icon: const Icon(Icons.qr_code_scanner),
                      label: const Text('Scan QR code'),
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                    ),
                    const SizedBox(height: 20),
                    Row(
                      children: [
                        const Expanded(child: Divider()),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Text('or enter an API key', style: t.labelMedium),
                        ),
                        const Expanded(child: Divider()),
                      ],
                    ),
                    const SizedBox(height: 20),
                    TextFormField(
                      key: const Key('serverUrl'),
                      controller: _url,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'https://api.example.com',
                        prefixIcon: Icon(Icons.dns_outlined),
                      ),
                      validator: (v) => ServerUrl.validate(v ?? ''),
                    ),
                    if (insecure) ...[
                      const SizedBox(height: 8),
                      _Banner(
                        icon: Icons.lock_open,
                        text: 'Not encrypted (http). Use only for local development.',
                        color: StatusColors.warning(context),
                      ),
                    ],
                    const SizedBox(height: 16),
                    TextFormField(
                      key: const Key('apiKey'),
                      controller: _apiKey,
                      obscureText: _obscure,
                      autocorrect: false,
                      enableSuggestions: false,
                      enableIMEPersonalizedLearning: false,
                      keyboardType: TextInputType.visiblePassword,
                      decoration: InputDecoration(
                        labelText: 'API key',
                        hintText: 'nfc_…',
                        prefixIcon: const Icon(Icons.key_outlined),
                        suffixIcon: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: _obscure ? 'Show' : 'Hide',
                              icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                              onPressed: () => setState(() => _obscure = !_obscure),
                            ),
                            IconButton(
                              tooltip: 'Paste',
                              icon: const Icon(Icons.content_paste),
                              onPressed: _paste,
                            ),
                          ],
                        ),
                      ),
                      validator: (v) {
                        final s = v?.trim() ?? '';
                        if (s.isEmpty) return 'API key is required';
                        if (!s.startsWith('nfc_') || s.startsWith('nfcd_')) {
                          return 'API keys start with "nfc_"';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Find it in the dashboard under API keys (shown once when created).',
                      style: t.bodySmall,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      key: const Key('deviceName'),
                      controller: _name,
                      decoration: const InputDecoration(
                        labelText: 'Device name',
                        hintText: 'Front desk reader',
                        prefixIcon: Icon(Icons.smartphone),
                      ),
                      validator: (v) => (v?.trim().length ?? 0) > 100 ? 'Max 100 characters' : null,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      _Banner(icon: Icons.error_outline, text: _error!.message, color: StatusColors.error(context)),
                      ErrorRefLine(errorRef: _error!.ref, requestId: _error!.requestId),
                    ],
                    const SizedBox(height: 24),
                    FilledButton.tonalIcon(
                      key: const Key('registerButton'),
                      onPressed: _busy ? null : _submit,
                      icon: _busy
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.link),
                      label: Text(_busy ? 'Registering…' : 'Register device'),
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                    ),
                    const SizedBox(height: 20),
                    const Center(child: UidOnlyNote(compact: true)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.text, required this.color});

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
