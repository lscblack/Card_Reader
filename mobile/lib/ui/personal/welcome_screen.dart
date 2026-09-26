import 'package:flutter/material.dart';

import '../screens/setup_screen.dart';
import '../widgets/common.dart';
import '../widgets/guest_tap.dart';
import 'personal_auth_screen.dart';

/// First run: choose Personal digital card and/or Terminal (both can be set up).
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return GuestTapScope(
      child: Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 24),
          children: [
            Icon(Icons.contactless_outlined, size: 56, color: scheme.primary),
            const SizedBox(height: 12),
            Text('nexTap', style: t.headlineMedium?.copyWith(fontWeight: FontWeight.w700), textAlign: TextAlign.center),
            const SizedBox(height: 6),
            Text('How do you want to use this phone? You can set up both.', style: t.bodyMedium, textAlign: TextAlign.center),
            const SizedBox(height: 28),
            _Choice(
              key: const Key('choosePersonal'),
              icon: Icons.badge_outlined,
              title: 'Personal digital card',
              body: 'Your business card on your phone. Tap phones to exchange contacts; iPhones get your web card.',
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const PersonalAuthScreen())),
            ),
            const SizedBox(height: 14),
            _Choice(
              key: const Key('chooseTerminal'),
              icon: Icons.point_of_sale_outlined,
              title: 'Terminal',
              body: 'Turn this phone into a card reader for an application or a business (check-ins, badges, tags).',
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SetupScreen())),
            ),
            const SizedBox(height: 20),
            const TapACardPanel(),
            const SizedBox(height: 28),
            const Center(child: UidOnlyNote(compact: true)),
          ],
        ),
      ),
    ),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({super.key, required this.icon, required this.title, required this.body, required this.onTap});
  final IconData icon;
  final String title, body;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(color: scheme.primaryContainer, borderRadius: BorderRadius.circular(14)),
                child: Icon(icon, color: scheme.onPrimaryContainer),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(body, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
