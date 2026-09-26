import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/models/personal.dart';
import '../../data/models/template_v2.dart';
import '../card_v2/card_math.dart';

IconData blockIcon(String b) => switch (b) {
  'photo' => Icons.account_circle_outlined,
  'name' => Icons.badge_outlined,
  'logo' => Icons.business,
  'company' => Icons.apartment,
  'tagline' => Icons.format_quote,
  'qr' => Icons.qr_code_2,
  'contacts' => Icons.contact_phone_outlined,
  'socials' => Icons.share_outlined,
  'website' => Icons.language,
  'address' => Icons.place_outlined,
  'bio' => Icons.notes,
  'badge_meta' => Icons.verified_outlined,
  'barcode' => Icons.view_week_outlined,
  _ => Icons.widgets_outlined,
};

/// Drag target payload: a block, and where it comes from (null = hidden tray).
class _Drag {
  const _Drag(this.block);
  final String block;
}

/// Part 5 §5 "Arrange": drag blocks between zones and reorder them (long-press), a hidden tray,
/// reset to the template default; every action is also available from a tap menu.
class ArrangePanel extends StatelessWidget {
  const ArrangePanel({
    super.key,
    required this.card,
    required this.template,
    required this.side,
    required this.onSide,
    required this.onChanged,
    this.locked = false,
  });

  final DigitalCard card;
  final TemplateV2 template;
  final String side;
  final ValueChanged<String> onSide;

  /// New arrangement / sides.
  final void Function(Arrangement arrangement, List<String> sides) onChanged;
  final bool locked;

  Arrangement get _a => template.resolve(card.arrangement);
  List<String> get _sides => card.sidesEnabled.where(template.sides.contains).toList();

  void _set(Arrangement a) => onChanged(a, _sides);

  void _drop(String block, String zone, [int? index]) {
    final next = template.move(_a, block, side, zone, index);
    if (!identical(next, _a)) HapticFeedback.mediumImpact();
    _set(next);
  }

  Future<void> _menu(BuildContext context, String block, {String? zone}) async {
    final a = _a;
    final list = zone == null ? null : a[side]?[zone];
    final i = list?.indexOf(block) ?? -1;
    final targets = <(String, CardZone)>[
      for (final s in _sides)
        for (final z in template.side(s).zones)
          if (!(s == side && z.id == zone) && template.canPlace(a, s, z.id, block)) (s, z),
    ];
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(blockLabels[block] ?? block, style: Theme.of(c).textTheme.titleMedium)),
            if (list != null && i > 0)
              ListTile(key: const Key('moveUp'), leading: const Icon(Icons.arrow_upward), title: const Text('Move up'),
                  onTap: () => Navigator.pop(c, 'up')),
            if (list != null && i >= 0 && i < list.length - 1)
              ListTile(key: const Key('moveDown'), leading: const Icon(Icons.arrow_downward), title: const Text('Move down'),
                  onTap: () => Navigator.pop(c, 'down')),
            for (final (s, z) in targets)
              ListTile(
                key: Key('moveTo_${s}_${z.id}'),
                leading: const Icon(Icons.drive_file_move_outline),
                title: Text('Move to ${_sides.length > 1 ? '${s == 'front' ? 'Front' : 'Back'} · ' : ''}${z.label}'),
                onTap: () => Navigator.pop(c, 'to:$s:${z.id}'),
              ),
            if (zone != null)
              ListTile(key: const Key('hideBlock'), leading: const Icon(Icons.visibility_off_outlined),
                  title: const Text('Hide from the card'), onTap: () => Navigator.pop(c, 'hide')),
          ],
        ),
      ),
    );
    if (action == null) return;
    HapticFeedback.selectionClick();
    if (action == 'hide') return _set(TemplateV2.hide(a, block));
    if (action == 'up' && zone != null) return _set(template.move(a, block, side, zone, i - 1));
    if (action == 'down' && zone != null) return _set(template.move(a, block, side, zone, i + 2));
    if (action.startsWith('to:')) {
      final p = action.split(':');
      _set(template.move(a, block, p[1], p[2]));
    }
  }

  bool _hasContent(String b) {
    final f = card.fields;
    return switch (b) {
      'photo' => true,
      'logo' => card.logoUrl != null,
      'company' => f.company != null || f.department != null,
      'tagline' => f.headline != null,
      'qr' => card.publicUrl != null,
      'contacts' => f.phones.isNotEmpty || f.emails.isNotEmpty,
      'socials' => f.socials.isNotEmpty,
      'website' => f.websites.isNotEmpty,
      'address' => f.address != null,
      'bio' => f.bio != null,
      'badge_meta' => f.idNumber != null || f.validUntil != null || f.validFrom != null,
      'barcode' => f.barcodeValue != null && barcodeValueError(f.barcodeValue) == null,
      _ => true,
    };
  }

  Widget _tile(BuildContext context, String block, {String? zone}) {
    final scheme = Theme.of(context).colorScheme;
    final empty = !_hasContent(block);
    final chip = Material(
      color: scheme.surfaceContainerHigh,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: locked ? null : () => _menu(context, block, zone: zone),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(children: [
            Icon(blockIcon(block), size: 20, color: scheme.primary),
            const SizedBox(width: 10),
            Expanded(
              child: Text.rich(TextSpan(children: [
                TextSpan(text: blockLabels[block] ?? block),
                if (empty) TextSpan(text: '  · empty', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
              ]), overflow: TextOverflow.ellipsis),
            ),
            if (!locked) Icon(Icons.drag_indicator, size: 20, color: scheme.onSurfaceVariant),
          ]),
        ),
      ),
    );
    if (locked) return chip;
    return LongPressDraggable<_Drag>(
      key: Key('block_$block'),
      data: _Drag(block),
      onDragStarted: HapticFeedback.selectionClick,
      feedback: Material(
        elevation: 8,
        borderRadius: BorderRadius.circular(12),
        color: scheme.primaryContainer,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(blockIcon(block), size: 20, color: scheme.onPrimaryContainer),
            const SizedBox(width: 8),
            Text(blockLabels[block] ?? block, style: TextStyle(color: scheme.onPrimaryContainer)),
          ]),
        ),
      ),
      childWhenDragging: Opacity(opacity: 0.35, child: chip),
      child: chip,
    );
  }

  Widget _zone(BuildContext context, CardZone z, List<String> blocks) {
    final scheme = Theme.of(context).colorScheme;
    return DragTarget<_Drag>(
      key: Key('zone_${z.id}'),
      onWillAcceptWithDetails: (d) => template.canPlace(_a, side, z.id, d.data.block),
      onAcceptWithDetails: (d) => _drop(d.data.block, z.id),
      builder: (context, candidates, rejected) {
        final active = candidates.isNotEmpty;
        final bad = rejected.isNotEmpty;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: active ? scheme.primaryContainer.withValues(alpha: 0.5) : scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: bad ? scheme.error : (active ? scheme.primary : scheme.outlineVariant),
              width: active || bad ? 2 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Expanded(child: Text(z.label, style: Theme.of(context).textTheme.titleSmall)),
                Text('${blocks.length}/${z.maxBlocks}', style: Theme.of(context).textTheme.labelMedium),
              ]),
              const SizedBox(height: 8),
              if (blocks.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('Drop a block here', style: TextStyle(color: scheme.onSurfaceVariant)),
                ),
              for (var i = 0; i < blocks.length; i++)
                DragTarget<_Drag>(
                  onWillAcceptWithDetails: (d) => d.data.block != blocks[i] && template.canPlace(_a, side, z.id, d.data.block),
                  onAcceptWithDetails: (d) => _drop(d.data.block, z.id, i),
                  builder: (context, c, _) => Padding(
                    padding: EdgeInsets.only(top: c.isNotEmpty ? 18 : 0, bottom: 8),
                    child: _tile(context, blocks[i], zone: z.id),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final a = _a;
    final scheme = Theme.of(context).colorScheme;
    final hidden = template.hiddenBlocks(a);
    final zones = template.side(side).zones;
    return ListView(
      key: const Key('arrangePanel'),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        if (template.hasBack) ...[
          SwitchListTile(
            key: const Key('twoSided'),
            contentPadding: EdgeInsets.zero,
            title: const Text('Two-sided card'),
            subtitle: const Text('Tap the card to flip it'),
            value: _sides.contains('back'),
            onChanged: locked
                ? null
                : (v) {
                    onChanged(a, v ? ['front', 'back'] : ['front']);
                    if (!v) onSide('front');
                  },
          ),
          if (_sides.contains('back'))
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: SegmentedButton<String>(
                key: const Key('arrangeSide'),
                segments: const [
                  ButtonSegment(value: 'front', label: Text('Front')),
                  ButtonSegment(value: 'back', label: Text('Back')),
                ],
                selected: {side},
                onSelectionChanged: (s) => onSide(s.first),
              ),
            ),
        ],
        Text(
          locked
              ? 'The layout of this card is managed by your company.'
              : 'Long-press a block and drag it to another zone, or tap it for options.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        for (final z in zones) _zone(context, z, a[side]?[z.id] ?? const []),
        DragTarget<_Drag>(
          key: const Key('hiddenTray'),
          onWillAcceptWithDetails: (_) => !locked,
          onAcceptWithDetails: (d) {
            HapticFeedback.mediumImpact();
            _set(TemplateV2.hide(_a, d.data.block));
          },
          builder: (context, c, _) => Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: c.isNotEmpty ? scheme.primary : scheme.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(children: [
                  Icon(Icons.visibility_off_outlined, size: 18, color: scheme.onSurfaceVariant),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Hidden blocks', style: Theme.of(context).textTheme.titleSmall)),
                ]),
                const SizedBox(height: 8),
                if (hidden.isEmpty)
                  Text('Drop a block here to hide it.', style: TextStyle(color: scheme.onSurfaceVariant))
                else
                  for (final b in hidden) Padding(padding: const EdgeInsets.only(bottom: 8), child: _tile(context, b)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            key: const Key('arrangeReset'),
            onPressed: locked ? null : () => onChanged(template.resolve(null), template.sides),
            icon: const Icon(Icons.restart_alt),
            label: const Text('Reset to template layout'),
          ),
        ),
      ],
    );
  }
}
