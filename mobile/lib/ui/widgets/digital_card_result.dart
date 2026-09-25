import 'package:flutter/material.dart';

import '../../data/models/business.dart';
import '../../data/models/personal.dart';
import '../theme.dart';
import 'business_result.dart';

/// Terminal view of a digital card read (Part 4 §5): the person's public card.
class DigitalCardResult extends StatelessWidget {
  const DigitalCardResult({super.key, this.summary, required this.shareIdHex});

  final DigitalCardSummary? summary;
  final String shareIdHex;

  @override
  Widget build(BuildContext context) {
    final s = summary;
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final verified = s?.verified ?? false;
    final color = s == null ? scheme.primary : (verified ? StatusColors.success(context) : StatusColors.warning(context));
    final name = s?.fullName ?? 'Digital card';
    final subtitle = [?s?.headline, if (s?.headline == null) ?s?.jobTitle, ?s?.company].join(' · ');
    return Container(
      key: const Key('digitalCardResult'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [color.withValues(alpha: 0.16), scheme.surfaceContainerLow]),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: color.withValues(alpha: 0.25),
                foregroundImage: s?.photoUrl == null ? null : NetworkImage(s!.photoUrl!),
                onForegroundImageError: s?.photoUrl == null ? null : (_, _) {},
                child: Icon(Icons.badge_outlined, color: color),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: t.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                    if (subtitle.isNotEmpty) Text(subtitle, style: t.bodyMedium),
                    const SizedBox(height: 2),
                    Row(children: [
                      Icon(verified ? Icons.verified : Icons.phonelink_ring, size: 14, color: color),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          s == null
                              ? 'Digital card · signed token (not authenticated)'
                              : (verified ? 'Digital card · token verified' : 'Digital card · not verified'),
                          style: t.labelSmall?.copyWith(color: color),
                        ),
                      ),
                    ]),
                  ],
                ),
              ),
            ],
          ),
          if (s?.publicUrl != null && isOpenableActionUrl(s!.publicUrl)) ...[
            const SizedBox(height: 10),
            FilledButton.tonalIcon(
              onPressed: () => openActionUrl(s.publicUrl),
              icon: const Icon(Icons.open_in_new, size: 18),
              label: const Text('Open card'),
            ),
          ],
          if (s == null) ...[
            const SizedBox(height: 6),
            Text('Card ${shareIdHex.substring(0, 8)}…', style: t.labelSmall?.copyWith(fontFamily: 'monospace')),
          ],
        ],
      ),
    );
  }
}
