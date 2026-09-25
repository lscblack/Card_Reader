import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_error.dart';
import '../theme.dart';

/// "NFC-1003 · 3f9c…" under a failure, tap-to-copy (for support requests).
class ErrorRefLine extends StatelessWidget {
  const ErrorRefLine({super.key, this.errorRef, this.requestId});

  final String? errorRef;
  final String? requestId;

  static String? text(String? ref, String? requestId) {
    final parts = [?ref, ?requestId];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final t = text(errorRef, requestId);
    if (t == null) return const SizedBox.shrink();
    final style = Theme.of(context).textTheme.labelSmall?.copyWith(
      fontFamily: 'monospace',
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    );
    return InkWell(
      key: const Key('errorRefLine'),
      borderRadius: BorderRadius.circular(6),
      onTap: () async {
        await Clipboard.setData(ClipboardData(text: t));
        if (context.mounted) {
          ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Reference copied')));
        }
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(child: Text(t, style: style)),
            const SizedBox(width: 6),
            Icon(Icons.copy, size: 14, color: style?.color),
          ],
        ),
      ),
    );
  }
}

/// Message + reference for an [AppError].
class ErrorMessage extends StatelessWidget {
  const ErrorMessage(this.error, {super.key});

  final AppError error;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(error.message, style: TextStyle(color: StatusColors.error(context))),
        ErrorRefLine(errorRef: error.ref, requestId: error.requestId),
      ],
    );
  }
}
