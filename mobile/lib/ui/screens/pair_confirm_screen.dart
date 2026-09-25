import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../core/pairing.dart';
import '../../services/app_state.dart';
import '../widgets/error_ref.dart';

/// Confirms a pairing (from a scanned QR code or a deep link) before the
/// single-use code is redeemed.
class PairConfirmScreen extends StatefulWidget {
  const PairConfirmScreen({super.key, required this.pairing});

  final PairingPayload pairing;

  @override
  State<PairConfirmScreen> createState() => _PairConfirmScreenState();
}

class _PairConfirmScreenState extends State<PairConfirmScreen> {
  late final TextEditingController _name;
  bool _busy = false;
  AppError? _error;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(
      text: widget.pairing.deviceName ?? context.read<AppState>().device?.suggestedName ?? '',
    );
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _pair() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final nav = Navigator.of(context);
    final err = await context.read<AppState>().registerWithPairing(widget.pairing, deviceName: _name.text);
    if (!mounted) return;
    if (err == null) {
      nav.popUntil((r) => r.isFirst);
      return;
    }
    setState(() {
      _busy = false;
      _error = err;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final p = widget.pairing;
    final presetName = p.deviceName != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Pair this phone')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Icon(Icons.qr_code_2, size: 56, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 12),
          Text('Connect to this server?', style: t.headlineSmall, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: Icon(p.isInsecure ? Icons.lock_open : Icons.lock_outline),
              title: Text(p.serverHost, key: const Key('pairServerHost')),
              subtitle: Text(p.isInsecure ? 'Not encrypted (http) — development only' : 'Encrypted (https)'),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Only continue if you created this code yourself in the dashboard. '
            'The code works once and expires after 10 minutes.',
            style: t.bodySmall,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            enabled: !presetName,
            decoration: InputDecoration(
              labelText: 'Device name',
              prefixIcon: const Icon(Icons.smartphone),
              helperText: presetName ? 'Set by the pairing code' : null,
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            ErrorMessage(_error!, key: const Key('pairError')),
          ],
          const SizedBox(height: 24),
          FilledButton.icon(
            key: const Key('pairButton'),
            onPressed: _busy ? null : _pair,
            icon: _busy
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.link),
            label: Text(_busy ? 'Pairing…' : 'Pair this device'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          ),
          TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(), child: const Text('Cancel')),
        ],
      ),
    );
  }
}
