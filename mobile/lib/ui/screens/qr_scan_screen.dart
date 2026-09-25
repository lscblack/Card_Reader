import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import '../../core/error_catalog.dart';
import '../../core/pairing.dart';
import '../../services/app_state.dart';

/// Scans a QR code and pops with what [parse] returns (default: a pairing QR →
/// [PairingPayload]). [parse] throws with a user-facing message for other codes.
class QrScanScreen extends StatefulWidget {
  const QrScanScreen({super.key, this.parse, this.title = 'Scan pairing code', this.hint, this.errorRef});

  final Object Function(String raw)? parse;
  final String title;
  final String? hint;
  final String? errorRef;

  @override
  State<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<QrScanScreen> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  String? _lastRaw;
  String? _error;
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_done) return;
    for (final b in capture.barcodes) {
      final raw = b.rawValue;
      if (raw == null || raw == _lastRaw) continue;
      _lastRaw = raw;
      try {
        final payload = (widget.parse ?? PairingPayload.parse)(raw);
        _done = true;
        Navigator.of(context).pop(payload);
        return;
      } catch (e) {
        final msg = e is PairingFormatException ? e.message : e.toString();
        setState(() => _error = '$msg\n${widget.errorRef ?? MobError.invalidQr.ref}');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            tooltip: 'Torch',
            icon: const Icon(Icons.flashlight_on_outlined),
            onPressed: () => _controller.toggleTorch(),
          ),
        ],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            errorBuilder: (context, error) => _ScannerError(error: error),
          ),
          IgnorePointer(
            child: Center(
              child: Container(
                width: 240,
                height: 240,
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.white, width: 3),
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: Material(
              color: _error == null ? scheme.surface.withValues(alpha: 0.9) : scheme.errorContainer,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(
                  _error ??
                      widget.hint ??
                      'In the dashboard, open your application and choose "Pair a phone", '
                          'then point the camera at the QR code.',
                  style: TextStyle(color: _error == null ? scheme.onSurface : scheme.onErrorContainer),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ScannerError extends StatelessWidget {
  const _ScannerError({required this.error});

  final MobileScannerException error;

  @override
  Widget build(BuildContext context) {
    final denied = error.errorCode == MobileScannerErrorCode.permissionDenied;
    final unsupported = error.errorCode == MobileScannerErrorCode.unsupported;
    return ColoredBox(
      color: Theme.of(context).colorScheme.surface,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(denied ? Icons.no_photography_outlined : Icons.error_outline, size: 48),
              const SizedBox(height: 12),
              Text(
                denied
                    ? 'Camera permission is needed to scan the pairing QR code. '
                          'Allow camera access in the app settings, or go back and enter an API key manually.\n'
                          '${MobError.cameraDenied.ref}'
                    : unsupported
                    ? 'This phone cannot scan QR codes. Go back and enter an API key manually.'
                    : 'The camera could not be started (${error.errorCode.name}).',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              if (denied)
                FilledButton.icon(
                  onPressed: () => context.read<AppState>().platform.openAppSettings(),
                  icon: const Icon(Icons.settings),
                  label: const Text('Open app settings'),
                ),
              TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Back')),
            ],
          ),
        ),
      ),
    );
  }
}
