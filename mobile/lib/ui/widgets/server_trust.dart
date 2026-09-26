import 'package:flutter/material.dart';

import '../../core/http_client.dart';
import '../theme.dart';

/// Why a server from a QR code / deep link deserves a second look before the phone connects
/// to it (pairing or sign-in codes can be crafted by anyone and point anywhere).
class ServerTrust {
  ServerTrust._();

  static String host(String url) {
    final u = Uri.tryParse(ServerUrl.normalize(url));
    if (u == null || u.host.isEmpty) return url;
    return u.hasPort ? '${u.host}:${u.port}' : u.host;
  }

  static String _key(String url) {
    final u = Uri.tryParse(ServerUrl.normalize(url));
    if (u == null) return url.toLowerCase();
    return '${u.scheme.toLowerCase()}://${u.host.toLowerCase()}:${u.hasPort ? u.port : (u.scheme == 'http' ? 80 : 443)}';
  }

  /// [known] = servers this phone already uses or was built for (null/empty entries ignored).
  static List<String> warnings(String serverUrl, Iterable<String?> known) {
    final out = <String>[];
    if (ServerUrl.isInsecure(serverUrl)) {
      out.add('Not encrypted (http://). Only continue on a development network you control.');
    }
    final knownKeys = {for (final k in known) if (k != null && k.trim().isNotEmpty) _key(k)};
    if (knownKeys.isNotEmpty && !knownKeys.contains(_key(serverUrl))) {
      final hosts = {for (final k in known) if (k != null && k.trim().isNotEmpty) host(k)}.join(', ');
      out.add('This is not the server this phone uses ($hosts). A code from someone else can point '
          'your phone at their server.');
    }
    return out;
  }
}

/// Prominent server host + warnings + (when there are warnings) an explicit "I trust it" box.
class ServerTrustPanel extends StatelessWidget {
  const ServerTrustPanel({
    super.key,
    required this.serverUrl,
    required this.warnings,
    required this.trusted,
    required this.onTrustedChanged,
  });

  final String serverUrl;
  final List<String> warnings;
  final bool trusted;
  final ValueChanged<bool> onTrustedChanged;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final insecure = ServerUrl.isInsecure(serverUrl);
    final warn = StatusColors.warning(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: ListTile(
            leading: Icon(insecure ? Icons.lock_open : Icons.lock_outline, color: insecure ? warn : null),
            title: Text(
              ServerTrust.host(serverUrl),
              key: const Key('trustServerHost'),
              style: t.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(insecure ? 'Not encrypted (http) — development only' : 'Encrypted (https)'),
          ),
        ),
        // One keyed group for all warnings: several can apply at once (e.g. http AND a different
        // server), and sibling widgets must never share a key.
        if (warnings.isNotEmpty)
          Column(
            key: const Key('serverWarning'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, w) in warnings.indexed)
                Container(
                  key: ValueKey('serverWarning-$i'),
                  margin: const EdgeInsets.only(top: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: warn.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Icon(Icons.warning_amber_rounded, color: warn, size: 20),
                    const SizedBox(width: 8),
                    Expanded(child: Text(w)),
                  ]),
                ),
            ],
          ),
        if (warnings.isNotEmpty)
          CheckboxListTile(
            key: const Key('trustServer'),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: trusted,
            onChanged: (v) => onTrustedChanged(v ?? false),
            title: Text('I created this code myself and trust ${ServerTrust.host(serverUrl)}'),
          ),
      ],
    );
  }
}
