import 'package:flutter/material.dart';

import '../../data/models/personal.dart';
import '../card_v2/card_v2_view.dart';
import 'card_view.dart';

/// Renders a card with the right engine: v2 shape templates (Part 5) or the v1 layouts.
class AnyCardView extends StatelessWidget {
  const AnyCardView({
    super.key,
    required this.card,
    required this.template,
    this.layoutOverride,
    this.hideHiddenFields = true,
    this.showFields = true,
    this.interactive = true,
    this.thumbnail = false,
    this.viewer,
    this.side,
    this.onSideChanged,
    this.maxPortraitWidth = 300,
  });

  final DigitalCard card;
  final CardTemplate template;

  /// v1: layout from a contact snapshot (`card.layout`) when present.
  final String? layoutOverride;
  final bool hideHiddenFields, showFields, interactive, thumbnail;

  /// v2 viewer level; default: `owner` (or `all` when hidden fields are shown).
  final String? viewer;
  final String? side;
  final ValueChanged<String>? onSideChanged;
  final double maxPortraitWidth;

  @override
  Widget build(BuildContext context) {
    final v2 = template.v2;
    if (v2 == null) {
      return DigitalCardView(
        card: card,
        layout: layoutOverride ?? template.layout,
        showFields: showFields,
        interactive: interactive,
        hideHiddenFields: hideHiddenFields,
      );
    }
    final view = CardV2View(
      key: ValueKey('cardv2_${v2.id}'),
      card: card,
      template: v2,
      viewer: viewer ?? (hideHiddenFields ? 'owner' : 'all'),
      thumbnail: thumbnail,
      side: side,
      onSideChanged: onSideChanged,
    );
    if (!v2.portrait || thumbnail) return view;
    return Center(child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxPortraitWidth), child: view));
  }
}
