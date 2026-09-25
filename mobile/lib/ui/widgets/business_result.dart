import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/models/business.dart';
import '../theme.dart';

/// Colour for a business result: recognized green, inactive amber, unknown neutral.
Color businessResultColor(BuildContext c, BusinessResult b) => switch (b.result) {
  'recognized' => StatusColors.success(c),
  'inactive' => StatusColors.warning(c),
  _ => StatusColors.neutral(c),
};

String businessResultLabel(BusinessResult b) => switch (b.result) {
  'recognized' => 'Recognized',
  'inactive' => 'Inactive',
  _ => 'Unknown card',
};

/// Opens an action URL if its scheme is allowed (http/https incl. wa.me, tel, mailto).
Future<bool> openActionUrl(String? url) async {
  if (!isOpenableActionUrl(url)) return false;
  try {
    return await launchUrl(Uri.parse(url!.trim()), mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}

/// Business read result (C2/C4).
class BusinessResultCard extends StatelessWidget {
  const BusinessResultCard({super.key, required this.result, this.onRegister, this.compact = false});

  final BusinessResult result;

  /// Shown for `unknown_card` when the device has `cards.register`.
  final VoidCallback? onRegister;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final b = result;
    final color = businessResultColor(context, b);
    final t = Theme.of(context).textTheme;
    final photo = b.assigneePhotoUrl;
    final canOpen = isOpenableActionUrl(b.actionUrl);
    return Container(
      key: const Key('businessResult'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.6), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: compact ? 18 : 24,
                backgroundColor: color.withValues(alpha: 0.2),
                foregroundImage: photo == null ? null : NetworkImage(photo),
                onForegroundImageError: photo == null ? null : (_, _) {},
                child: Icon(
                  b.isRecognized ? Icons.verified_outlined : (b.isInactive ? Icons.block : Icons.help_outline),
                  color: color,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      b.message ?? b.assigneeName ?? b.cardName ?? businessResultLabel(b),
                      key: const Key('businessMessage'),
                      style: (compact ? t.titleSmall : t.titleMedium)?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    Text(
                      [
                        businessResultLabel(b),
                        if (b.cardName != null) '${b.cardName}${b.cardKind == null ? '' : ' (${b.cardKind})'}',
                      ].join(' · '),
                      style: t.bodySmall?.copyWith(color: color),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (!compact && b.assigneeName != null && b.message != null && !b.message!.contains(b.assigneeName!)) ...[
            const SizedBox(height: 8),
            Text([b.assigneeName, ?b.assigneePosition].join(' · ')),
          ],
          if (!compact && (canOpen || (b.isUnknown && onRegister != null))) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: [
                if (canOpen)
                  FilledButton.tonalIcon(
                    key: const Key('openActionButton'),
                    onPressed: () => openActionUrl(b.actionUrl),
                    icon: const Icon(Icons.open_in_new, size: 18),
                    label: Text(b.actionLabel ?? 'Open'),
                  ),
                if (b.isUnknown && onRegister != null)
                  FilledButton.icon(
                    key: const Key('registerCardButton'),
                    onPressed: onRegister,
                    icon: const Icon(Icons.add_card, size: 18),
                    label: const Text('Register this card'),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
