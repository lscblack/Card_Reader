import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/models/card_read.dart';
import '../../services/card_registrar.dart';
import '../personal/share_ripple.dart';
import '../theme.dart';
import '../widgets/error_ref.dart';
import '../widgets/motion.dart';
import '../widgets/register_card_sheet.dart';

/// "Register cards" mode (business devices with `cards.register`): tap → name → registered →
/// tap the next one. Taps are not delivered as events while this screen is open.
class RegisterCardsScreen extends StatefulWidget {
  const RegisterCardsScreen({super.key, required this.registrar, this.initialUid});

  final CardRegistrar registrar;

  /// A card already read on the Reader (unknown-card result): its sheet opens first.
  final String? initialUid;

  @override
  State<RegisterCardsScreen> createState() => _RegisterCardsScreenState();
}

class _RegisterCardsScreenState extends State<RegisterCardsScreen> with WidgetsBindingObserver {
  CardRegistrar get r => widget.registrar;
  bool _sheetOpen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    r.addListener(_changed);
    unawaited(r.start().then((_) {
      final uid = widget.initialUid;
      if (uid != null && mounted) r.registerUid(uid);
    }));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) unawaited(r.onPaused());
    if (state == AppLifecycleState.resumed) unawaited(r.onResumed());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    r.removeListener(_changed);
    unawaited(r.stop().then((_) => r.dispose()));
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    setState(() {});
    if (r.phase == RegisterPhase.sheet && !_sheetOpen) unawaited(_openSheet());
  }

  Future<void> _openSheet() async {
    final uid = r.pendingUid;
    if (uid == null) return;
    _sheetOpen = true;
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => RegisterCardSheet(
        key: ValueKey('sheet_$uid'),
        uid: uid,
        initialName: r.suggestedName(r.kind),
        nameFor: r.suggestedName,
        kind: r.kind,
        assignToBusiness: r.assignToBusiness,
        businessName: r.businessName,
        writeHint: r.writeLink && r.canProgram ? 'The tap link is written right after — keep the card on the phone.' : null,
        onSubmit: (choice) async {
          final err = await r.submit(
            name: choice.name,
            kind: choice.kind,
            assignToBusiness: choice.assignToBusiness,
            note: choice.note,
          );
          if (err == null && c.mounted) Navigator.of(c).pop(true);
          return err;
        },
      ),
    );
    _sheetOpen = false;
    if (done != true) r.cancelSheet();
  }

  Widget _status(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final last = r.last;
    final next = r.registered.isEmpty ? 'Tap a card to register it' : 'Tap the next card';
    Widget panel(Key key, Widget visual, String title, List<Widget> extra) => Column(
      key: key,
      children: [
        SizedBox(height: 140, child: Center(child: visual)),
        const SizedBox(height: 8),
        Text(title, textAlign: TextAlign.center, style: t.titleLarge),
        ...extra,
      ],
    );
    final ripple = NfcRipple(color: scheme.primary, icon: Icons.add_card, active: true, size: 140);
    return switch (r.phase) {
      RegisterPhase.success when last != null => panel(
        ValueKey('success_${last.item.id}_${last.programmed}'),
        SuccessCheck(size: 96, color: StatusColors.success(context)),
        'Registered · ${last.item.name}',
        [
          const SizedBox(height: 4),
          Text(
            [
              last.item.kind == 'tag' ? 'Tag' : 'Card',
              last.item.assigneeType == 'business' ? 'company card' : 'unassigned',
              if (last.programmed) 'link written ✓',
            ].join(' · '),
            style: t.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
          if (last.writeError != null) ...[
            const SizedBox(height: 8),
            ErrorMessage(last.writeError!, key: const Key('writeError')),
            TextButton.icon(
              key: const Key('retryWrite'),
              onPressed: () => r.write(last),
              icon: const Icon(Icons.edit_note),
              label: const Text('Write the link again'),
            ),
          ],
          const SizedBox(height: 8),
          Text('Tap the next card', key: const Key('tapNext'), style: t.titleSmall?.copyWith(color: scheme.primary)),
        ],
      ),
      RegisterPhase.already => panel(
        const ValueKey('already'),
        Icon(Icons.check_circle_outline, size: 72, color: scheme.onSurfaceVariant),
        r.alreadyName == null ? 'Already registered' : 'Already registered as ${r.alreadyName}',
        [const SizedBox(height: 8), Text(next, style: t.titleSmall?.copyWith(color: scheme.primary))],
      ),
      RegisterPhase.writing => panel(
        const ValueKey('writing'),
        ripple,
        'Writing the tap link…',
        [
          const SizedBox(height: 4),
          Text('Keep the card on the phone. If you moved it away, hold it again.',
              textAlign: TextAlign.center, style: t.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
        ],
      ),
      RegisterPhase.saving => panel(const ValueKey('saving'), const CircularProgressIndicator(), 'Registering…', const []),
      RegisterPhase.notice => panel(
        const ValueKey('notice'),
        Icon(Icons.info_outline, size: 64, color: scheme.onSurfaceVariant),
        r.notice ?? '',
        [const SizedBox(height: 8), Text(next, style: t.titleSmall?.copyWith(color: scheme.primary))],
      ),
      _ => panel(
        const ValueKey('waiting'),
        ripple,
        next,
        [
          const SizedBox(height: 4),
          Text('Hold each new card or tag to the back of the phone.',
              textAlign: TextAlign.center, style: t.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
        ],
      ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final list = r.registered;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Register cards'),
        actions: [
          TextButton(key: const Key('registerDone'), onPressed: () => Navigator.of(context).maybePop(), child: const Text('Done')),
        ],
      ),
      body: ListView(
        key: const Key('registerCardsScreen'),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: AnimatedSwitcher(
                duration: reduceMotion(context) ? Duration.zero : const Duration(milliseconds: 250),
                child: _status(context),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Taps are not sent as events while registering. Normal reading resumes when you leave.',
            style: t.bodySmall,
          ),
          if (r.canProgram)
            SwitchListTile(
              key: const Key('writeLinkToggle'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Also write the tap link to each card'),
              subtitle: const Text('Phones without the app then open the card\'s page'),
              value: r.writeLink,
              onChanged: (v) => setState(() => r.writeLink = v),
            ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: Text('Registered this session', style: t.titleMedium)),
            Container(
              key: const Key('registeredCount'),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
              decoration: BoxDecoration(color: scheme.primaryContainer, borderRadius: BorderRadius.circular(20)),
              child: Text('${list.length}', style: t.labelLarge?.copyWith(color: scheme.onPrimaryContainer)),
            ),
          ]),
          const SizedBox(height: 8),
          if (list.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text('Nothing yet.', style: t.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
            ),
          for (var i = 0; i < list.length; i++)
            StaggeredEntrance(
              key: ValueKey(list[i].item.id),
              index: 0,
              child: Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: Icon(list[i].item.kind == 'tag' ? Icons.sell_outlined : Icons.badge_outlined, color: scheme.primary),
                  title: Text(list[i].item.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    [
                      CardUtils.formatUid(list[i].uid),
                      if (list[i].item.assigneeType == 'business') 'company',
                    ].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: list[i].programmed
                      ? Tooltip(message: 'Link written', child: Icon(Icons.link, color: StatusColors.success(context)))
                      : (list[i].writeError != null ? Icon(Icons.link_off, color: StatusColors.warning(context)) : null),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
