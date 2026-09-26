import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/digital_card_token.dart';
import '../../data/models/personal.dart';
import '../../services/personal_state.dart';

/// Exchange QR payload generated on the phone (same token as NFC, works offline).
String? localExchangeQr(DigitalCard card, ShareKey? key, DateTime now) {
  if (key == null || key.secret.isEmpty || card.shareId.isEmpty) return null;
  try {
    final token = DigitalCardToken.generate(
      shareId: card.shareId,
      keyId: key.keyId,
      issuedAt: now.toUtc().millisecondsSinceEpoch ~/ 1000,
      secret: DigitalCardToken.decodeSecret(key.secret),
    );
    return 'nfcterminal://card?v=1&t=${DigitalCardToken.encode(token)}';
  } catch (_) {
    return null;
  }
}

/// QR fallback: exchange QR (refreshes every minute; tokens live 10 min) + public link QR.
class QrShareScreen extends StatefulWidget {
  const QrShareScreen({super.key, required this.card});
  final DigitalCard card;

  @override
  State<QrShareScreen> createState() => _QrShareScreenState();
}

class _QrShareScreenState extends State<QrShareScreen> {
  String? _exchange;
  bool _exchangeFailed = false;
  Timer? _timer;
  bool _public = false;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    final p = context.read<PersonalState>();
    var payload = localExchangeQr(widget.card, p.shareKey, DateTime.now());
    if (payload == null && p.api != null) {
      try {
        payload = await p.api!.exchangeQr(widget.card.id);
      } catch (_) {}
    }
    if (mounted) {
      setState(() {
        // Keep the last good code on a transient failure (it stays valid for 10 minutes).
        if (payload != null && payload.isNotEmpty) _exchange = payload;
        _exchangeFailed = payload == null || payload.isEmpty;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final url = widget.card.publicUrl;
    final webOn = widget.card.shareSettings.webPageEnabled;
    final data = _public ? (webOn && url != null && url.isNotEmpty ? url : null) : _exchange;
    // Instead of an endless spinner: say why there is no code.
    final String? unavailable = data != null
        ? null
        : _public
        ? (webOn ? 'This card has no public link yet.' : 'Your public web page is off. Turn it on in My Card settings.')
        : (_exchangeFailed ? 'Could not create an exchange code. Check your connection and try again.' : null);
    return Scaffold(
      appBar: AppBar(title: const Text('Share with QR')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('Exchange'), icon: Icon(Icons.sync_alt)),
              ButtonSegment(value: true, label: Text('Public link'), icon: Icon(Icons.link)),
            ],
            selected: {_public},
            onSelectionChanged: (s) => setState(() => _public = s.first),
          ),
          const SizedBox(height: 20),
          Center(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
              child: data != null
                  ? QrImageView(key: const Key('shareQr'), data: data, size: 240, backgroundColor: Colors.white)
                  : SizedBox(
                      width: 240,
                      height: 240,
                      child: Center(
                        child: unavailable == null
                            ? const CircularProgressIndicator()
                            : Column(mainAxisSize: MainAxisSize.min, children: [
                                Text(
                                  unavailable,
                                  key: const Key('qrUnavailable'),
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: Colors.black87),
                                ),
                                if (!_public)
                                  TextButton(
                                    onPressed: _refresh,
                                    child: const Text('Try again'),
                                  ),
                              ]),
                      ),
                    ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            _public
                ? 'Anyone can open your public card page — no app needed.'
                : 'The other person scans this in nexTap (My Card → Scan a card → Scan QR) and you exchange cards. '
                      'The code refreshes every minute and expires after 10 minutes.',
            textAlign: TextAlign.center,
            style: t.bodyMedium,
          ),
          if (_public && data != null) ...[
            const SizedBox(height: 12),
            SelectableText(data, textAlign: TextAlign.center, style: t.bodySmall),
            TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: data));
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied')));
              },
              icon: const Icon(Icons.copy),
              label: const Text('Copy link'),
            ),
          ],
        ],
      ),
    );
  }
}
