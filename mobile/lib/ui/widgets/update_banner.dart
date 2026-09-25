import 'package:flutter/material.dart';

import '../../services/update_check.dart';
import 'business_result.dart';

/// Explains sideloading, then opens the APK download in the browser.
Future<void> startUpdateDownload(BuildContext context, AppRelease release) async {
  final go = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text('Update to v${release.versionName}'),
      content: const Text(
        'The new version downloads in your browser. Open the downloaded file to install it.\n\n'
        'If Android asks, allow "Install unknown apps" for your browser (this source) — only needed once. '
        'Your registration and history are kept.',
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Later')),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Download')),
      ],
    ),
  );
  if (go == true) await openActionUrl(release.downloadUrl);
}

/// Small, dismissible "Update available" strip.
class UpdateBanner extends StatefulWidget {
  const UpdateBanner({super.key, required this.release});

  final AppRelease release;

  @override
  State<UpdateBanner> createState() => _UpdateBannerState();
}

class _UpdateBannerState extends State<UpdateBanner> {
  int? _dismissedBuild;

  @override
  Widget build(BuildContext context) {
    if (_dismissedBuild == widget.release.buildNumber) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        key: const Key('updateBanner'),
        color: scheme.primaryContainer,
        borderRadius: BorderRadius.circular(12),
        child: ListTile(
          leading: Icon(Icons.system_update, color: scheme.onPrimaryContainer),
          title: Text('Update available (v${widget.release.versionName})',
              style: TextStyle(color: scheme.onPrimaryContainer)),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextButton(onPressed: () => startUpdateDownload(context, widget.release), child: const Text('Get')),
              IconButton(
                tooltip: 'Dismiss',
                icon: const Icon(Icons.close, size: 18),
                onPressed: () => setState(() => _dismissedBuild = widget.release.buildNumber),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
