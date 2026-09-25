import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/error_catalog.dart';
import '../../data/models/personal.dart';
import '../../services/personal_state.dart';
import '../widgets/common.dart';

/// Personal space settings: sharing toggles, sessions, sign out.
class PersonalSettingsScreen extends StatefulWidget {
  const PersonalSettingsScreen({super.key});

  @override
  State<PersonalSettingsScreen> createState() => _PersonalSettingsScreenState();
}

class _PersonalSettingsScreenState extends State<PersonalSettingsScreen> {
  List<PersonalSession>? _sessions;

  @override
  void initState() {
    super.initState();
    _loadSessions();
  }

  Future<void> _loadSessions() async {
    try {
      final s = await context.read<PersonalState>().api?.sessions();
      if (mounted) setState(() => _sessions = s?.where((x) => x.revokedAt == null).toList());
    } catch (_) {
      if (mounted) setState(() => _sessions = const []);
    }
  }

  Future<void> _toggle(PersonalState p, ShareSettings s) async {
    final messenger = ScaffoldMessenger.of(context);
    final err = await p.updateShareSettings(s);
    if (err != null) messenger.showSnackBar(SnackBar(content: Text(err.toString())));
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<PersonalState>();
    final card = p.primary;
    final s = card?.shareSettings ?? const ShareSettings();
    return Scaffold(
      appBar: AppBar(title: const Text('My Card settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SectionCard(
            title: 'Account',
            children: [
              InfoRow('Name', p.user?.fullName ?? '—'),
              InfoRow('Email', p.user?.email ?? '—'),
              InfoRow('Server', p.serverUrl ?? '—', mono: true),
              InfoRow('NFC sharing', p.hceSupported ? 'Supported' : 'Not supported (${MobError.hceUnsupported.ref})'),
            ],
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Sharing (primary card${card == null ? '' : ': ${card.label}'})',
            children: [
              SwitchListTile(
                key: const Key('ps_nfc'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Share by NFC'),
                subtitle: const Text('Your phone acts as your card when held near another phone or reader'),
                value: s.nfcSharingEnabled,
                onChanged: card == null ? null : (v) => _toggle(p, s.copyWith(nfcSharingEnabled: v)),
              ),
              SwitchListTile(
                key: const Key('ps_web'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Public web page'),
                subtitle: const Text('iPhones and phones without the app open your web card'),
                value: s.webPageEnabled,
                onChanged: card == null ? null : (v) => _toggle(p, s.copyWith(webPageEnabled: v)),
              ),
              SwitchListTile(
                key: const Key('ps_auto'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Exchange automatically'),
                subtitle: const Text('People who scan you also receive your card'),
                value: s.autoExchange,
                onChanged: card == null ? null : (v) => _toggle(p, s.copyWith(autoExchange: v)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Signed-in devices',
            children: [
              if (_sessions == null) const LinearProgressIndicator(),
              for (final ses in _sessions ?? const <PersonalSession>[])
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(ses.platform == 'web' ? Icons.laptop : Icons.smartphone),
                  title: Text('${ses.deviceName ?? ses.model ?? 'Device'}${ses.id == p.sessionId ? ' (this phone)' : ''}'),
                  subtitle: Text('Last seen ${ses.lastSeenAt?.split('T').first ?? '—'}'),
                  trailing: ses.id == p.sessionId
                      ? null
                      : TextButton(
                          onPressed: () async {
                            await p.api?.revokeSession(ses.id);
                            await _loadSessions();
                          },
                          child: const Text('Revoke'),
                        ),
                ),
            ],
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            key: const Key('personalSignOut'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
              minimumSize: const Size.fromHeight(48),
            ),
            onPressed: () async {
              final nav = Navigator.of(context);
              final ok = await showDialog<bool>(
                context: context,
                builder: (c) => AlertDialog(
                  title: const Text('Sign out of My Card?'),
                  content: const Text('This phone stops sharing your card and forgets your session. Your contacts stay in your account.'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
                    FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out')),
                  ],
                ),
              );
              if (ok == true) {
                await p.signOut();
                nav.popUntil((r) => r.isFirst);
              }
            },
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}
