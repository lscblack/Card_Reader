import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/error_catalog.dart';
import '../../data/models/business.dart';
import '../../data/models/device_config.dart';
import '../../services/app_state.dart';
import '../format.dart';
import '../theme.dart';
import '../widgets/business_result.dart';
import '../widgets/common.dart';
import '../widgets/help_sheet.dart';
import '../widgets/update_banner.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _unregister(BuildContext context) async {
    final app = context.read<AppState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Unregister this device?'),
        content: const Text(
          'The device token and signing secret are deleted from this phone. Events waiting for a retry '
          'will not be sent. To register again you will need an API key. '
          'Revoke or delete the device in the dashboard to remove it there.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(c).colorScheme.error),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Unregister'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final nav = Navigator.of(context);
    await app.unregister();
    // This screen describes a registration that no longer exists: back to the shell/setup.
    nav.popUntil((r) => r.isFirst);
  }

  Future<void> _resync(BuildContext context) async {
    final app = context.read<AppState>();
    final messenger = ScaffoldMessenger.of(context);
    final ok = await app.configSync?.sync() ?? false;
    messenger.showSnackBar(SnackBar(
      content: Text(ok ? 'Configuration updated' : 'Sync failed: ${app.configSync?.lastError ?? 'unknown error'}'),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final cfg = app.config;
    final sync = app.configSync;
    final dev = app.device;

    return Scaffold(
      appBar: AppBar(title: const Text('Terminal settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SectionCard(
            title: 'This device',
            children: [
              InfoRow('Name', cfg?.deviceName ?? '—'),
              InfoRow('Device ID', cfg?.deviceId ?? '—', mono: true),
              InfoRow('Model', dev == null ? '—' : dev.suggestedName),
              InfoRow('OS', dev?.osVersion ?? '—'),
              InfoRow('App version', dev == null ? '—' : '${dev.appVersion} (build ${dev.buildNumber})'),
            ],
          ),
          const SizedBox(height: 12),
          if (cfg?.isBusiness ?? false) ...[
            SectionCard(
              title: 'Business',
              children: [
                InfoRow('Business', cfg!.business!.name),
                InfoRow('Assigned to', cfg.assignedEmployee?.name ?? 'Nobody (shared device)',
                    key: const Key('assignedEmployee')),
                SwitchListTile(
                  key: const Key('autoRunActions'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Run card actions automatically'),
                  subtitle: const Text('Open the card\'s link (website, profile, WhatsApp…) as soon as it is recognized'),
                  value: app.autoRunActions,
                  onChanged: (v) => app.setAutoRunActions(v),
                ),
                InfoRow(
                  'Can',
                  [
                    'read cards',
                    if (cfg.can(Capability.registerCards)) 'register new cards',
                    if (cfg.can(Capability.programCards)) 'program cards',
                  ].join(', '),
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
          SectionCard(
            title: 'Connection',
            children: [
              InfoRow('Server', app.serverUrl ?? '—', mono: true),
              InfoRow('Application', cfg?.applicationName ?? '—'),
              InfoRow('Delivery mode', cfg?.deliveryMode.name ?? '—'),
              if (cfg?.deliveryMode == DeliveryMode.direct) ...[
                InfoRow('Endpoint', cfg?.endpointUrl ?? 'not configured', mono: true),
                InfoRow('Timeout', '${cfg?.timeoutSeconds ?? '—'} s'),
                InfoRow('Signing', cfg?.signingSecret == null ? 'No signing secret' : 'Per-device secret (stored securely)'),
              ],
              InfoRow(
                'Allowed domains',
                (cfg?.allowedDomains.isEmpty ?? true) ? 'Any (no restriction)' : cfg!.allowedDomains.join('\n'),
                mono: cfg?.allowedDomains.isNotEmpty ?? false,
              ),
              InfoRow('Max retries', '${cfg?.maxRetries ?? '—'}'),
              InfoRow('Last sync', sync?.lastSyncAt == null ? 'never' : formatLocalTime(sync!.lastSyncAt!)),
              InfoRow('Last heartbeat', sync?.lastHeartbeatAt == null ? 'never' : formatLocalTime(sync!.lastHeartbeatAt!)),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed: (sync?.syncing ?? true) ? null : () => _resync(context),
                  icon: const Icon(Icons.sync),
                  label: const Text('Re-sync configuration'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Background reading',
            children: [
              SwitchListTile(
                key: const Key('backgroundReadingSwitch'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Read cards when app is closed'),
                value: app.backgroundReading,
                onChanged: (v) async {
                  final messenger = ScaffoldMessenger.of(context);
                  final notificationsOk = await app.setBackgroundReading(v);
                  if (!notificationsOk) {
                    messenger.showSnackBar(SnackBar(
                      content: Text('${MobError.notificationsDenied.title} (${MobError.notificationsDenied.ref}). '
                          'Background reads still work, without a notification.'),
                    ));
                  }
                },
              ),
              Text(
                'Works when the screen is on and unlocked. Android may ask which app to use if another '
                'NFC app is installed — choose nexTap and "Always". After a read the app shows a '
                'notification and returns to what you were doing.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Security',
            children: [
              const UidOnlyNote(),
              const SizedBox(height: 8),
              Text(
                'Physical cards are read by UID only. A UID identifies a card but does not prove who holds it '
                'and can be cloned: such events are sent with security.authenticated = false and '
                'security.level = "uid_only". Phones sharing a digital card add a signed, short-lived token '
                '(verified by the platform) — an identifier, not strong authentication. Your backend decides '
                'what a card ID means.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'About',
            children: [
              if (app.availableUpdate != null)
                ListTile(
                  key: const Key('settingsUpdate'),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.system_update),
                  title: Text('Update available (v${app.availableUpdate!.versionName})'),
                  subtitle: const Text('Download the new version'),
                  onTap: () => startUpdateDownload(context, app.availableUpdate!),
                ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.help_outline),
                title: const Text('What happens when I tap a card?'),
                onTap: () => showTapHelpSheet(context, cfg),
              ),
              InfoRow('Version', dev == null ? '—' : '${dev.appVersion} (build ${dev.buildNumber})'),
              const SizedBox(height: 8),
              InkWell(
                key: const Key('poweredBy'),
                onTap: () => openActionUrl('http://nexventures.net/'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Text.rich(TextSpan(children: [
                    const TextSpan(text: 'Powered by '),
                    TextSpan(
                      text: 'Nexventures',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.primary,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ])),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            key: const Key('unregisterButton'),
            style: FilledButton.styleFrom(
              backgroundColor: StatusColors.error(context),
              foregroundColor: Theme.of(context).colorScheme.onError,
              minimumSize: const Size.fromHeight(48),
            ),
            onPressed: () => _unregister(context),
            icon: const Icon(Icons.link_off),
            label: const Text('Unregister device'),
          ),
        ],
      ),
    );
  }
}
