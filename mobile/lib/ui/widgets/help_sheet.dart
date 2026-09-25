import 'package:flutter/material.dart';

import '../../data/models/device_config.dart';
import 'common.dart';

/// "What happens when I tap a card?"
Future<void> showTapHelpSheet(BuildContext context, DeviceConfig? config) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => TapHelpSheet(config: config),
);

class TapHelpSheet extends StatelessWidget {
  const TapHelpSheet({super.key, this.config});

  final DeviceConfig? config;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final business = config?.isBusiness ?? false;
    final direct = config?.deliveryMode == DeliveryMode.direct;
    Widget point(IconData icon, String title, String body, {bool highlight = false}) => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: highlight ? Theme.of(context).colorScheme.primary : null),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: t.titleSmall),
                const SizedBox(height: 2),
                Text(body, style: t.bodyMedium),
              ],
            ),
          ),
        ],
      ),
    );

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      maxChildSize: 0.95,
      builder: (context, controller) => ListView(
        key: const Key('tapHelpSheet'),
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        children: [
          Text('What happens when I tap a card?', style: t.titleLarge),
          const SizedBox(height: 16),
          point(Icons.contactless_outlined, '1. The phone reads the card ID',
              'Only the card\'s UID (a serial number like 04:A1:B2…) is read. Nothing is written to the card.'),
          point(
            Icons.code,
            'Developer device${business ? '' : ' (this phone)'}',
            'The card ID is sent as an event to the developer\'s endpoint — '
                '${direct ? 'directly from this phone, signed with its key (direct mode)' : 'through the platform, which signs, logs and retries it (relay mode)'}. '
                'The developer\'s system decides what the card means. The app shows whether it was delivered.',
            highlight: !business,
          ),
          point(
            Icons.storefront_outlined,
            'Business device${business ? ' (this phone)' : ''}',
            'The platform looks the card up in the business\'s cards and shows who or what it is '
                '(e.g. "John Doe · Sales Manager"), green if recognized, amber if inactive. It records the tap for analytics '
                'and runs the card\'s action (open a profile, link, Wi-Fi…) — "Open" starts it on this phone. '
                'Unknown cards can be registered here if the business allows it.',
            highlight: business,
          ),
          point(Icons.cloud_off_outlined, 'Offline?',
              'Reads are kept on the phone and sent automatically when the network is back.'),
          point(Icons.lock_open_outlined, 'Screen off / app closed',
              'Android reads cards only while the screen is on and unlocked. With "Read cards when app is closed" on, '
                  'a tap opens the app briefly and returns you to what you were doing.'),
          const SizedBox(height: 4),
          const UidOnlyNote(),
          const SizedBox(height: 6),
          Text(
            'A UID identifies a card but does not prove who holds it — it can be copied. Every event is marked '
            '"not authenticated" (uid_only). Don\'t use it alone to open doors or approve payments.',
            style: t.bodySmall,
          ),
        ],
      ),
    );
  }
}
