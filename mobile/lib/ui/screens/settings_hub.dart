import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/app_state.dart';
import '../../services/personal_state.dart';
import '../personal/personal_auth_screen.dart';
import '../personal/personal_settings_screen.dart';
import '../widgets/business_result.dart';
import '../widgets/common.dart';
import '../widgets/help_sheet.dart';
import '../widgets/update_banner.dart';
import 'settings_screen.dart';
import 'setup_screen.dart';

/// Settings for both spaces + About.
class SettingsHub extends StatelessWidget {
  const SettingsHub({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final personal = context.watch<PersonalState>();
    final dev = app.device;
    void push(Widget w) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => w));
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (app.availableUpdate != null) UpdateBanner(release: app.availableUpdate!),
          SectionCard(
            title: 'Spaces',
            children: [
              ListTile(
                key: const Key('hubPersonal'),
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.badge_outlined),
                title: Text(personal.signedIn ? 'My Card' : 'Set up a personal digital card'),
                subtitle: Text(personal.signedIn ? (personal.user?.email ?? 'Signed in') : 'Share your card by tapping phones'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => push(personal.signedIn ? const PersonalSettingsScreen() : const PersonalAuthScreen()),
              ),
              ListTile(
                key: const Key('hubTerminal'),
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.point_of_sale_outlined),
                title: Text(app.phase == AppPhase.ready ? 'Terminal' : 'Set up this phone as a terminal'),
                subtitle: Text(app.phase == AppPhase.ready
                    ? (app.config?.applicationName ?? 'Registered')
                    : 'Read cards for an application or a business'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => push(app.phase == AppPhase.ready ? const SettingsScreen() : const SetupScreen()),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Appearance',
            children: [
              SizedBox(
                width: double.infinity,
                child: SegmentedButton<String>(
                  key: const Key('themeMode'),
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(value: 'system', label: Text('System'), icon: Icon(Icons.brightness_auto_outlined)),
                    ButtonSegment(value: 'light', label: Text('Light'), icon: Icon(Icons.light_mode_outlined)),
                    ButtonSegment(value: 'dark', label: Text('Dark'), icon: Icon(Icons.dark_mode_outlined)),
                  ],
                  selected: {app.themeMode},
                  onSelectionChanged: (s) => app.setThemeMode(s.first),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'About',
            children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.help_outline),
                title: const Text('What happens when I tap a card?'),
                onTap: () => showTapHelpSheet(context, app.config),
              ),
              InfoRow('Version', dev == null ? '—' : '${dev.appVersion} (build ${dev.buildNumber})'),
              InkWell(
                key: const Key('hubPoweredBy'),
                onTap: () => openActionUrl('http://nexventures.net/'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text.rich(TextSpan(children: [
                    const TextSpan(text: 'Powered by '),
                    TextSpan(
                      text: 'Nexventures',
                      style: TextStyle(color: Theme.of(context).colorScheme.primary, decoration: TextDecoration.underline),
                    ),
                  ])),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
