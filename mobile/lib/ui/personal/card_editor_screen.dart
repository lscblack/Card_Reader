import 'dart:async';

import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../core/error_catalog.dart';
import '../../data/models/personal.dart';
import '../../services/personal_state.dart';
import '../digital_card/card_style.dart';
import '../card_v2/card_math.dart';
import '../digital_card/any_card_view.dart';
import '../digital_card/card_view.dart';
import '../digital_card/color_picker.dart';
import '../widgets/error_ref.dart';
import 'editor_arrange.dart';
import 'editor_design_v2.dart';

/// Picks (camera/gallery) and crops an image; returns a local file path or null. Mockable.
typedef ImageSourcePicker = Future<String?> Function(BuildContext context, String kind);

Future<String?> pickAndCropImage(BuildContext context, String kind) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (c) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take a photo'),
            onTap: () => Navigator.pop(c, ImageSource.camera)),
        ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose from gallery'),
            onTap: () => Navigator.pop(c, ImageSource.gallery)),
      ]),
    ),
  );
  if (source == null) return null;
  final picked = await ImagePicker().pickImage(source: source, maxWidth: 2000, maxHeight: 2000, imageQuality: 92);
  if (picked == null) return null;
  final ratio = switch (kind) {
    'cover' => const CropAspectRatio(ratioX: 1200, ratioY: 630),
    'logo' => null,
    _ => const CropAspectRatio(ratioX: 1, ratioY: 1),
  };
  final cropped = await ImageCropper().cropImage(
    sourcePath: picked.path,
    aspectRatio: ratio,
    compressFormat: ImageCompressFormat.jpg,
    compressQuality: 90,
    uiSettings: [
      AndroidUiSettings(
        toolbarTitle: 'Crop ${kind == 'cover' ? 'cover' : kind}',
        toolbarColor: const Color(0xFFB91C1C),
        toolbarWidgetColor: Colors.white,
        activeControlsWidgetColor: const Color(0xFFB91C1C),
        cropStyle: kind == 'photo' ? CropStyle.circle : CropStyle.rectangle,
        lockAspectRatio: ratio != null,
      ),
      IOSUiSettings(
        title: 'Crop ${kind == 'cover' ? 'cover' : kind}',
        cropStyle: kind == 'photo' ? CropStyle.circle : CropStyle.rectangle,
        aspectRatioLockEnabled: ratio != null,
        resetAspectRatioEnabled: ratio == null,
      ),
    ],
  );
  return cropped?.path;
}

/// Full card editor (templates, design, images, fields, visibility, sharing) with live preview.
class CardEditorScreen extends StatefulWidget {
  const CardEditorScreen({super.key, required this.card, this.imagePicker = pickAndCropImage});

  final DigitalCard card;
  final ImageSourcePicker imagePicker;

  @override
  State<CardEditorScreen> createState() => _CardEditorScreenState();
}

enum SaveStatus { saved, unsaved, saving, failed }

class _CardEditorScreenState extends State<CardEditorScreen> {
  late DigitalCard _draft = widget.card;
  bool _saving = false;
  bool _dirty = false;
  AppError? _error;

  // Undo / redo (text edits of the same field within a second are coalesced).
  late final List<DigitalCard> _history = [widget.card];
  int _hIndex = 0;
  String? _lastKind;
  DateTime _lastAt = DateTime(0);

  /// Bumped on undo/redo so text fields re-read their initial values.
  int _revision = 0;

  // Preview
  String _side = 'front';
  String _viewer = 'owner';

  // Autosave
  static const autosaveDelay = Duration(seconds: 4);
  Timer? _autosave;
  bool _saveFailed = false;

  SaveStatus get _status => _saving
      ? SaveStatus.saving
      : _saveFailed
      ? SaveStatus.failed
      : (_dirty ? SaveStatus.unsaved : SaveStatus.saved);

  @override
  void dispose() {
    _autosave?.cancel();
    super.dispose();
  }

  void _update(DigitalCard c, {String? kind}) {
    final now = DateTime.now();
    setState(() {
      if (kind != null && kind == _lastKind && now.difference(_lastAt) < const Duration(seconds: 1)) {
        _history[_hIndex] = c;
      } else {
        _history.removeRange(_hIndex + 1, _history.length);
        _history.add(c);
        if (_history.length > 60) _history.removeAt(0);
        _hIndex = _history.length - 1;
      }
      _lastKind = kind;
      _lastAt = now;
      _draft = c;
      _dirty = true;
      _saveFailed = false;
    });
    _scheduleAutosave();
  }

  void _jump(int to) {
    setState(() {
      _hIndex = to;
      _draft = _history[to];
      _lastKind = null;
      _dirty = true;
      _revision++;
    });
    _scheduleAutosave();
  }

  void _scheduleAutosave() {
    _autosave?.cancel();
    _autosave = Timer(autosaveDelay, () => _save(silent: true));
  }

  void _fields(Map<String, Object?> patch) =>
      _update(_draft.copyWith(fields: _draft.fields.copyWithJson(patch)), kind: 'fields:${patch.keys.join(',')}');

  Future<bool> _save({bool silent = false}) async {
    _autosave?.cancel();
    if (_saving) return false;
    final sent = _draft;
    setState(() {
      _saving = true;
      _error = null;
    });
    final err = await context.read<PersonalState>().saveCard(sent);
    if (!mounted) return err == null;
    setState(() {
      _saving = false;
      _error = err;
      _saveFailed = err != null;
      if (err == null && identical(_draft, sent)) _dirty = false;
    });
    if (err == null && !silent) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Card saved ✓')));
    }
    if (err == null && _dirty) _scheduleAutosave();
    return err == null;
  }

  Future<void> _image(String kind) async {
    final p = context.read<PersonalState>();
    String? path;
    try {
      path = await widget.imagePicker(context, kind);
    } catch (_) {
      setState(() => _error = AppError.mob(MobError.imagePickFailed));
      return;
    }
    if (path == null || !mounted) return;
    setState(() => _saving = true);
    final err = await p.uploadImage(_draft.id, kind, path);
    if (!mounted) return;
    final fresh = p.cards.where((c) => c.id == _draft.id).firstOrNull;
    setState(() {
      _saving = false;
      _error = err;
      if (fresh != null) {
        _draft = _draft.copyWith(photoUrl: () => fresh.photoUrl, coverUrl: () => fresh.coverUrl, logoUrl: () => fresh.logoUrl);
      }
    });
  }

  Future<void> _removeImage(String kind) async {
    final p = context.read<PersonalState>();
    final err = await p.deleteImage(_draft.id, kind);
    if (!mounted) return;
    setState(() {
      _error = err;
      if (err == null) {
        _draft = switch (kind) {
          'photo' => _draft.copyWith(photoUrl: () => null),
          'cover' => _draft.copyWith(coverUrl: () => null),
          _ => _draft.copyWith(logoUrl: () => null),
        };
      }
    });
  }

  /// Leaving with changes: save them (autosave semantics); ask only when saving fails.
  Future<bool> _leave() async {
    if (!_dirty) return true;
    if (await _save(silent: true)) return true;
    if (!mounted) return false;
    final r = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Changes not saved'),
        content: const Text('Your latest changes could not be saved. Leave anyway?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep editing')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Discard')),
        ],
      ),
    );
    return r ?? false;
  }

  Widget _statusChip(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (icon, text, color) = switch (_status) {
      SaveStatus.saved => (Icons.cloud_done_outlined, 'Saved', scheme.onSurfaceVariant),
      SaveStatus.unsaved => (Icons.edit_outlined, 'Unsaved', scheme.onSurfaceVariant),
      SaveStatus.saving => (Icons.cloud_upload_outlined, 'Saving…', scheme.primary),
      SaveStatus.failed => (Icons.cloud_off_outlined, 'Not saved', scheme.error),
    };
    return Tooltip(
      message: 'Changes save automatically',
      child: Row(
        key: const Key('saveStatus'),
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 4),
          Text(text, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color)),
        ],
      ),
    );
  }

  Widget _preview(BuildContext context, CardTemplate template) {
    final v2 = template.v2;
    final twoSided = v2 != null && v2.hasBack && _draft.sidesEnabled.contains('back');
    final card = KeyedSubtree(
      key: const Key('editorPreview'),
      child: AnyCardView(
        card: _draft,
        template: template,
        interactive: false,
        viewer: _viewer,
        side: twoSided ? _side : 'front',
        onSideChanged: (s) => setState(() => _side = s),
        maxPortraitWidth: 170,
      ),
    );
    return Container(
      color: Theme.of(context).colorScheme.surfaceContainerLowest,
      child: Column(
        children: [
          if (v2 != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
              child: Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 4,
                children: [
                  if (twoSided)
                    TextButton.icon(
                      key: const Key('previewFlip'),
                      onPressed: () => setState(() => _side = _side == 'front' ? 'back' : 'front'),
                      icon: const Icon(Icons.flip, size: 18),
                      label: Text(_side == 'front' ? 'Front' : 'Back'),
                    ),
                  PopupMenuButton<String>(
                    key: const Key('viewAs'),
                    tooltip: 'View as',
                    initialValue: _viewer,
                    onSelected: (v) => setState(() => _viewer = v),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'owner', child: Text('Me (all but hidden)')),
                      PopupMenuItem(value: 'contact', child: Text('A contact')),
                      PopupMenuItem(value: 'public', child: Text('The public')),
                    ],
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        const Icon(Icons.visibility_outlined, size: 18),
                        const SizedBox(width: 4),
                        Text(switch (_viewer) { 'public' => 'Public', 'contact' => 'Contact', _ => 'Me' }),
                      ]),
                    ),
                  ),
                ],
              ),
            ),
          Expanded(
            child: v2 == null
                ? SingleChildScrollView(padding: const EdgeInsets.all(16), child: card)
                : InteractiveViewer(
                    maxScale: 4,
                    child: Center(child: Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 12), child: card)),
                  ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<PersonalState>();
    final template = p.templateFor(_draft.templateId);
    final v2 = template.v2;
    final designLocked = _draft.businessLink?.templateLocked ?? false;
    final screenH = MediaQuery.sizeOf(context).height;
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final nav = Navigator.of(context);
        if (await _leave()) nav.pop();
      },
      child: DefaultTabController(
        length: 7,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Edit card'),
            actions: [
              IconButton(
                key: const Key('undo'),
                tooltip: 'Undo',
                onPressed: _hIndex > 0 ? () => _jump(_hIndex - 1) : null,
                icon: const Icon(Icons.undo),
              ),
              IconButton(
                key: const Key('redo'),
                tooltip: 'Redo',
                onPressed: _hIndex < _history.length - 1 ? () => _jump(_hIndex + 1) : null,
                icon: const Icon(Icons.redo),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilledButton(
                  key: const Key('saveCard'),
                  onPressed: _saving || !_dirty ? null : _save,
                  child: Text(_saving ? 'Saving…' : 'Save'),
                ),
              ),
            ],
            bottom: const TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(text: 'Template'),
                Tab(text: 'Design'),
                Tab(text: 'Photos'),
                Tab(text: 'Details'),
                Tab(text: 'Arrange'),
                Tab(text: 'Privacy'),
                Tab(text: 'Sharing'),
              ],
            ),
          ),
          body: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
                child: Row(children: [
                  _statusChip(context),
                  const Spacer(),
                  if (_draft.businessLink != null)
                    Flexible(
                      flex: 3,
                      child: Text(
                        'Issued by ${_draft.businessLink!.businessName}',
                        textAlign: TextAlign.end,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                ]),
              ),
              if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), child: ErrorMessage(_error!)),
              if (_draft.businessLink != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                  child: Text(
                    'Locked fields${designLocked ? ', design and layout' : ''} are managed by your company.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              SizedBox(height: (screenH * 0.3).clamp(170.0, 270.0), child: _preview(context, template)),
              Expanded(
                child: TabBarView(
                  children: [
                    _TemplateTab(
                      draft: _draft,
                      templates: p.templates,
                      templateFor: p.templateFor,
                      onChanged: (c) {
                        _side = 'front';
                        _update(c);
                      },
                    ),
                    v2 != null
                        ? DesignV2Panel(
                            card: _draft,
                            presets: p.presets,
                            variants: v2.variants,
                            locked: designLocked,
                            onChanged: (d) => _update(_draft.copyWith(design: d), kind: 'design'),
                          )
                        : _DesignTab(draft: _draft, onChanged: (c) => _update(c, kind: 'design')),
                    _PhotosTab(draft: _draft, busy: _saving, onPick: _image, onRemove: _removeImage),
                    _FieldsTab(key: ValueKey('fields_$_revision'), draft: _draft, onFields: _fields),
                    v2 != null
                        ? ArrangePanel(
                            card: _draft,
                            template: v2,
                            side: _draft.sidesEnabled.contains(_side) ? _side : 'front',
                            locked: designLocked,
                            onSide: (s) => setState(() => _side = s),
                            onChanged: (a, sides) => _update(_draft.copyWith(arrangement: a, sidesEnabled: sides)),
                          )
                        : const _ArrangeUnavailable(),
                    _VisibilityTab(draft: _draft, onChanged: _update),
                    _SharingTab(key: ValueKey('sharing_$_revision'), draft: _draft, onChanged: (c) => _update(c, kind: 'sharing')),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ArrangeUnavailable extends StatelessWidget {
  const _ArrangeUnavailable();

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.dashboard_customize_outlined, size: 40, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 12),
        const Text(
          'Pick a Business, ID badge or Minimal template to arrange blocks on the front and back of your card.',
          textAlign: TextAlign.center,
        ),
      ]),
    ),
  );
}

// --------------------------------------------------------------- template --

class _TemplateTab extends StatefulWidget {
  const _TemplateTab({required this.draft, required this.templates, required this.templateFor, required this.onChanged});
  final DigitalCard draft;
  final List<CardTemplate> templates;
  final CardTemplate Function(String id) templateFor;
  final ValueChanged<DigitalCard> onChanged;

  @override
  State<_TemplateTab> createState() => _TemplateTabState();
}

class _TemplateTabState extends State<_TemplateTab> {
  static const _cats = [('business', 'Business'), ('badge', 'ID badge'), ('minimal', 'Minimal'), ('classic', 'Classic')];
  late String _cat = widget.templateFor(widget.draft.templateId).category;

  @override
  Widget build(BuildContext context) {
    final draft = widget.draft;
    final locked = draft.businessLink?.templateLocked ?? false;
    final scheme = Theme.of(context).colorScheme;
    final list = widget.templates.where((t) => t.category == _cat).toList();
    final portrait = _cat == 'badge';
    return Column(
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: Row(
            children: [
              for (final (id, label) in _cats)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    key: Key('cat_$id'),
                    label: Text(label),
                    selected: _cat == id,
                    onSelected: (_) => setState(() => _cat = id),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: list.isEmpty
              ? const Center(child: Text('No templates in this category yet.'))
              : GridView.builder(
                  padding: const EdgeInsets.all(12),
                  gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: portrait ? 170 : 240,
                    childAspectRatio: portrait ? 0.56 : (_cat == 'classic' ? 0.72 : 1.3),
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                  ),
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final t = list[i];
                    final selected = t.id == draft.templateId;
                    final preview = draft.withTemplate(t);
                    return Semantics(
                      selected: selected,
                      button: true,
                      label: 'Template ${t.name}',
                      child: InkWell(
                        key: Key('template_${t.id}'),
                        borderRadius: BorderRadius.circular(16),
                        onTap: locked || selected ? null : () => widget.onChanged(preview),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 180),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: selected ? scheme.primary : scheme.outlineVariant,
                              width: selected ? 2.5 : 1,
                            ),
                          ),
                          padding: const EdgeInsets.all(8),
                          child: Column(
                            children: [
                              Expanded(
                                child: IgnorePointer(
                                  child: t.isV2
                                      ? Center(child: AnyCardView(card: preview, template: t, thumbnail: true, interactive: false))
                                      : ClipRRect(
                                          borderRadius: BorderRadius.circular(10),
                                          child: FittedBox(
                                            fit: BoxFit.fitWidth,
                                            alignment: Alignment.topCenter,
                                            child: SizedBox(
                                              width: 340,
                                              child: DigitalCardView(card: preview, layout: t.layout, showFields: false, interactive: false),
                                            ),
                                          ),
                                        ),
                                ),
                              ),
                              const SizedBox(height: 6),
                              Row(children: [
                                Expanded(
                                  child: Text(t.name, maxLines: 1, overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontWeight: FontWeight.w600)),
                                ),
                                if (t.premium) const Icon(Icons.workspace_premium, size: 16),
                                if (t.v2?.hasBack ?? false) Icon(Icons.flip, size: 14, color: scheme.onSurfaceVariant),
                                if (selected) Icon(Icons.check_circle, size: 18, color: scheme.primary),
                              ]),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

// ----------------------------------------------------------------- design --

class _DesignTab extends StatelessWidget {
  const _DesignTab({required this.draft, required this.onChanged});
  final DigitalCard draft;
  final ValueChanged<DigitalCard> onChanged;

  @override
  Widget build(BuildContext context) {
    final d = draft.design;
    final locked = draft.businessLink?.templateLocked ?? false;
    void set(CardDesign nd) => onChanged(draft.copyWith(design: nd));
    Widget colorRow(String label, String value, ValueChanged<String> onPick) => ListTile(
      key: Key('color_$label'),
      enabled: !locked,
      title: Text(label),
      trailing: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(color: hexColor(value), shape: BoxShape.circle, border: Border.all(color: Colors.black26)),
      ),
      subtitle: Text(value.toUpperCase()),
      onTap: () async {
        final c = await pickCardColor(context, value, title: label);
        if (c != null) onPick(c);
      },
    );
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        colorRow('Primary', d.primary, (c) => set(d.copyWith(primary: c))),
        colorRow('Background', d.background, (c) => set(d.copyWith(background: c))),
        colorRow('Text', d.text, (c) => set(d.copyWith(text: c))),
        colorRow('Accent', d.accent, (c) => set(d.copyWith(accent: c))),
        const Divider(),
        _Section('Background style'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, children: [
            for (final s in const ['solid', 'gradient', 'glass', 'pattern'])
              ChoiceChip(
                label: Text(s[0].toUpperCase() + s.substring(1)),
                selected: d.backgroundStyle == s,
                onSelected: locked ? null : (_) => set(d.copyWith(backgroundStyle: s)),
              ),
          ]),
        ),
        if (d.backgroundStyle == 'pattern')
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Wrap(spacing: 8, children: [
              for (final p in const ['dots', 'lines', 'grid', 'waves'])
                ChoiceChip(label: Text(p), selected: (d.pattern ?? 'dots') == p,
                    onSelected: locked ? null : (_) => set(d.copyWith(pattern: () => p))),
            ]),
          ),
        _Section('Font'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, children: [
            for (final f in const ['sans', 'serif', 'mono', 'display'])
              ChoiceChip(
                label: Text(f[0].toUpperCase() + f.substring(1), style: CardStyle(d.copyWith(font: f)).body(14)),
                selected: d.font == f,
                onSelected: locked ? null : (_) => set(d.copyWith(font: f)),
              ),
          ]),
        ),
        _Section('Corner radius · ${d.cornerRadius}'),
        Slider(value: d.cornerRadius.toDouble(), max: 32, divisions: 32,
            onChanged: locked ? null : (v) => set(d.copyWith(cornerRadius: v.round()))),
        SwitchListTile(
          title: const Text('Show QR code on the card'),
          value: d.showQr,
          onChanged: locked ? null : (v) => set(d.copyWith(showQr: v)),
        ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
    child: Text(text, style: Theme.of(context).textTheme.titleSmall),
  );
}

// ----------------------------------------------------------------- photos --

class _PhotosTab extends StatelessWidget {
  const _PhotosTab({required this.draft, required this.busy, required this.onPick, required this.onRemove});
  final DigitalCard draft;
  final bool busy;
  final Future<void> Function(String kind) onPick;
  final Future<void> Function(String kind) onRemove;

  @override
  Widget build(BuildContext context) {
    Widget tile(String kind, String title, String hint, String? url) => ListTile(
      key: Key('image_$kind'),
      leading: CircleAvatar(
        foregroundImage: url == null ? null : NetworkImage(url),
        onForegroundImageError: url == null ? null : (_, _) {},
        child: Icon(kind == 'cover' ? Icons.panorama_outlined : (kind == 'logo' ? Icons.business : Icons.person_outline)),
      ),
      title: Text(title),
      subtitle: Text(hint),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton(tooltip: 'Change', icon: const Icon(Icons.add_a_photo_outlined), onPressed: busy ? null : () => onPick(kind)),
        if (url != null) IconButton(tooltip: 'Remove', icon: const Icon(Icons.delete_outline), onPressed: busy ? null : () => onRemove(kind)),
      ]),
    );
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        if (busy) const LinearProgressIndicator(),
        tile('photo', 'Photo', 'Square, shown round (512×512)', draft.photoUrl),
        tile('cover', 'Cover', 'Wide banner (1200×630) — Banner & Photo hero templates', draft.coverUrl),
        tile('logo', 'Logo', 'Company logo (PNG with transparency works best)', draft.logoUrl),
      ],
    );
  }
}

// ----------------------------------------------------------------- fields --

class _FieldsTab extends StatelessWidget {
  const _FieldsTab({super.key, required this.draft, required this.onFields});
  final DigitalCard draft;
  final void Function(Map<String, Object?>) onFields;

  @override
  Widget build(BuildContext context) {
    final f = draft.fields;
    Widget text(String key, String label, String? value, {int lines = 1, IconData? icon}) {
      final locked = draft.isLocked(key);
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
        child: TextFormField(
          key: Key('field_$key'),
          initialValue: value ?? '',
          enabled: !locked,
          minLines: lines,
          maxLines: lines == 1 ? 1 : 5,
          decoration: InputDecoration(
            labelText: label,
            prefixIcon: icon == null ? null : Icon(icon),
            suffixIcon: locked ? const Icon(Icons.lock_outline, size: 18) : null,
          ),
          onChanged: (v) => onFields({key: v.trim().isEmpty ? null : v}),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        text('full_name', 'Full name', f.fullName, icon: Icons.person_outline),
        text('pronouns', 'Pronouns', f.pronouns),
        text('headline', 'Headline', f.headline, icon: Icons.short_text),
        text('job_title', 'Job title', f.jobTitle, icon: Icons.work_outline),
        text('company', 'Company', f.company, icon: Icons.apartment),
        text('department', 'Department', f.department),
        text('bio', 'About', f.bio, lines: 3),
        text('address', 'Address', f.address, icon: Icons.place_outlined),
        _RowsEditor(key: const Key('rows_phones'), title: 'Phones', rows: f.phones, locked: draft.isLocked('phones'),
            labelHint: 'Mobile', valueHint: '+250 7…', keyboard: TextInputType.phone,
            onChanged: (r) => onFields({'phones': r.map((e) => e.toJson('label', 'value')).toList()})),
        _RowsEditor(key: const Key('rows_emails'), title: 'Emails', rows: f.emails, locked: draft.isLocked('emails'),
            labelHint: 'Work', valueHint: 'you@company.com', keyboard: TextInputType.emailAddress,
            onChanged: (r) => onFields({'emails': r.map((e) => e.toJson('label', 'value')).toList()})),
        _RowsEditor(key: const Key('rows_websites'), title: 'Websites', rows: f.websites, locked: draft.isLocked('websites'),
            labelHint: 'Site', valueHint: 'https://…', keyboard: TextInputType.url,
            onChanged: (r) => onFields({'websites': r.map((e) => e.toJson('label', 'url')).toList()})),
        _RowsEditor(key: const Key('rows_socials'), title: 'Social profiles', rows: f.socials, locked: draft.isLocked('socials'),
            labelHint: 'linkedin', valueHint: 'https://linkedin.com/in/…', keyboard: TextInputType.url,
            labelOptions: const ['linkedin', 'x', 'instagram', 'facebook', 'github', 'youtube', 'tiktok', 'whatsapp', 'other'],
            onChanged: (r) => onFields({'socials': r.map((e) => e.toJson('platform', 'url')).toList()})),
        _RowsEditor(key: const Key('rows_custom_links'), title: 'Links', rows: f.customLinks, locked: draft.isLocked('custom_links'),
            labelHint: 'Book a meeting', valueHint: 'https://…', keyboard: TextInputType.url,
            onChanged: (r) => onFields({'custom_links': r.map((e) => e.toJson('label', 'url')).toList()})),
        if (draft.isV2) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
            child: Text('ID badge', style: Theme.of(context).textTheme.titleSmall),
          ),
          text('id_number', 'ID number', f.idNumber, icon: Icons.tag),
          _DateField(key: const Key('field_valid_from'), label: 'Valid from', value: f.validFrom,
              locked: draft.isLocked('valid_from'), onChanged: (v) => onFields({'valid_from': v})),
          _DateField(key: const Key('field_valid_until'), label: 'Valid until', value: f.validUntil,
              locked: draft.isLocked('valid_until'), onChanged: (v) => onFields({'valid_until': v})),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: TextFormField(
              key: const Key('field_barcode_value'),
              initialValue: f.barcodeValue ?? '',
              enabled: !draft.isLocked('barcode_value'),
              maxLength: 48,
              autovalidateMode: AutovalidateMode.onUserInteraction,
              validator: barcodeValueError,
              decoration: InputDecoration(
                labelText: 'Barcode (Code 128)',
                prefixIcon: const Icon(Icons.view_week_outlined),
                suffixIcon: draft.isLocked('barcode_value') ? const Icon(Icons.lock_outline, size: 18) : null,
              ),
              onChanged: (v) {
                if (barcodeValueError(v.trim()) == null) onFields({'barcode_value': v.trim().isEmpty ? null : v.trim()});
              },
            ),
          ),
        ],
      ],
    );
  }
}

/// Add/remove `{label, value}` rows.
class _RowsEditor extends StatefulWidget {
  const _RowsEditor({
    super.key,
    required this.title,
    required this.rows,
    required this.onChanged,
    required this.labelHint,
    required this.valueHint,
    this.keyboard = TextInputType.text,
    this.labelOptions,
    this.locked = false,
  });

  final String title, labelHint, valueHint;
  final List<LabeledValue> rows;
  final ValueChanged<List<LabeledValue>> onChanged;
  final TextInputType keyboard;
  final List<String>? labelOptions;
  final bool locked;

  @override
  State<_RowsEditor> createState() => _RowsEditorState();
}

class _RowsEditorState extends State<_RowsEditor> {
  late List<(int, String, String)> _rows = [
    for (var i = 0; i < widget.rows.length; i++) (i, widget.rows[i].label, widget.rows[i].value),
  ];
  late int _next = _rows.length;

  void _emit() => widget.onChanged([for (final r in _rows) LabeledValue(r.$2, r.$3)]);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            Expanded(child: Text(widget.title, style: Theme.of(context).textTheme.titleSmall)),
            if (widget.locked) const Icon(Icons.lock_outline, size: 18),
            if (!widget.locked)
              TextButton.icon(
                key: Key('add_${widget.title}'),
                onPressed: () => setState(() {
                  _rows = [..._rows, (_next++, widget.labelOptions?.first ?? '', '')];
                  _emit();
                }),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Add'),
              ),
          ]),
          for (var i = 0; i < _rows.length; i++)
            Padding(
              key: ValueKey(_rows[i].$1),
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                SizedBox(
                  width: 110,
                  child: widget.labelOptions != null
                      ? DropdownButtonFormField<String>(
                          initialValue: widget.labelOptions!.contains(_rows[i].$2) ? _rows[i].$2 : 'other',
                          isExpanded: true,
                          items: [for (final o in widget.labelOptions!) DropdownMenuItem(value: o, child: Text(o))],
                          onChanged: widget.locked ? null : (v) {
                            final r = _rows[i];
                            _rows[i] = (r.$1, v ?? '', r.$3);
                            _emit();
                          },
                        )
                      : TextFormField(
                          initialValue: _rows[i].$2,
                          enabled: !widget.locked,
                          decoration: InputDecoration(hintText: widget.labelHint, isDense: true),
                          onChanged: (v) {
                            final r = _rows[i];
                            _rows[i] = (r.$1, v, r.$3);
                            _emit();
                          },
                        ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    initialValue: _rows[i].$3,
                    enabled: !widget.locked,
                    keyboardType: widget.keyboard,
                    decoration: InputDecoration(hintText: widget.valueHint, isDense: true),
                    onChanged: (v) {
                      final r = _rows[i];
                      _rows[i] = (r.$1, r.$2, v);
                      _emit();
                    },
                  ),
                ),
                if (!widget.locked)
                  IconButton(
                    tooltip: 'Remove',
                    icon: const Icon(Icons.remove_circle_outline),
                    onPressed: () => setState(() {
                      _rows = [..._rows]..removeAt(i);
                      _emit();
                    }),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------- visibility --

class _VisibilityTab extends StatelessWidget {
  const _VisibilityTab({required this.draft, required this.onChanged});
  final DigitalCard draft;
  final ValueChanged<DigitalCard> onChanged;

  static const _labels = {
    'photo': 'Photo', 'full_name': 'Name', 'pronouns': 'Pronouns', 'headline': 'Headline', 'job_title': 'Job title',
    'company': 'Company', 'department': 'Department', 'bio': 'About', 'phones': 'Phones', 'emails': 'Emails',
    'websites': 'Websites', 'address': 'Address', 'socials': 'Social profiles', 'custom_links': 'Links',
  };

  static const _badgeLabels = {
    'id_number': 'ID number', 'valid_from': 'Valid from', 'valid_until': 'Valid until', 'barcode_value': 'Barcode',
  };

  @override
  Widget build(BuildContext context) {
    final labels = {..._labels, if (draft.isV2) ..._badgeLabels};
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Text(
          'Public: anyone (web page, terminals). Contacts: people you exchange with. Hidden: only you.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        for (final e in labels.entries)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(children: [
              Expanded(child: Text(e.value)),
              SegmentedButton<String>(
                key: Key('vis_${e.key}'),
                showSelectedIcon: false,
                style: SegmentedButton.styleFrom(visualDensity: VisualDensity.compact, padding: const EdgeInsets.symmetric(horizontal: 6)),
                segments: const [
                  ButtonSegment(value: 'public', icon: Icon(Icons.public, size: 18), tooltip: 'Public'),
                  ButtonSegment(value: 'contacts', icon: Icon(Icons.people_outline, size: 18), tooltip: 'Contacts'),
                  ButtonSegment(value: 'hidden', icon: Icon(Icons.visibility_off_outlined, size: 18), tooltip: 'Hidden'),
                ],
                selected: {draft.visibility[e.key] ?? 'public'},
                onSelectionChanged: (s) => onChanged(draft.copyWith(visibility: {...draft.visibility, e.key: s.first})),
              ),
            ]),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------- sharing --

class _SharingTab extends StatelessWidget {
  const _SharingTab({super.key, required this.draft, required this.onChanged});
  final DigitalCard draft;
  final ValueChanged<DigitalCard> onChanged;

  @override
  Widget build(BuildContext context) {
    final s = draft.shareSettings;
    final p = context.read<PersonalState>();
    void set(ShareSettings n) => onChanged(draft.copyWith(shareSettings: n));
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextFormField(
            key: const Key('field_label'),
            initialValue: draft.label,
            decoration: const InputDecoration(labelText: 'Card label (e.g. Work, Personal)'),
            onChanged: (v) => onChanged(draft.copyWith(label: v)),
          ),
        ),
        SwitchListTile(
          key: const Key('share_auto'),
          title: const Text('Exchange automatically'),
          subtitle: const Text('When someone scans you, you get their card too'),
          value: s.autoExchange,
          onChanged: (v) => set(s.copyWith(autoExchange: v)),
        ),
        SwitchListTile(
          key: const Key('share_nfc'),
          title: const Text('Share by NFC'),
          subtitle: const Text('Other phones and readers can read this card'),
          value: s.nfcSharingEnabled,
          onChanged: (v) => set(s.copyWith(nfcSharingEnabled: v)),
        ),
        SwitchListTile(
          key: const Key('share_web'),
          title: const Text('Public web page'),
          subtitle: const Text('Phones without the app (e.g. iPhone) open your web card'),
          value: s.webPageEnabled,
          onChanged: (v) => set(s.copyWith(webPageEnabled: v)),
        ),
        SwitchListTile(
          title: const Text('Let visitors share their details'),
          value: s.leadCaptureEnabled,
          onChanged: (v) => set(s.copyWith(leadCaptureEnabled: v)),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.autorenew),
          title: const Text('Rotate link'),
          subtitle: const Text('Old QR codes and links stop working'),
          onTap: () async {
            final ok = await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: const Text('Rotate this card\'s link?'),
                content: const Text('Printed QR codes and shared links will stop working.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
                  FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Rotate')),
                ],
              ),
            );
            if (ok == true) await p.rotateShareId(draft.id);
          },
        ),
        ListTile(
          leading: const Icon(Icons.copy_all_outlined),
          title: const Text('Duplicate card'),
          onTap: () => p.duplicateCard(draft.id),
        ),
        if (!draft.isPrimary)
          ListTile(
            leading: const Icon(Icons.star_outline),
            title: const Text('Make this the card my phone shares'),
            onTap: () => p.setPrimary(draft.id),
          ),
        if (draft.businessLink == null)
          ListTile(
            leading: Icon(Icons.delete_outline, color: Theme.of(context).colorScheme.error),
            title: const Text('Delete card'),
            onTap: () async {
              final nav = Navigator.of(context);
              final ok = await showDialog<bool>(
                context: context,
                builder: (c) => AlertDialog(
                  title: const Text('Delete this card?'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
                    FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Delete')),
                  ],
                ),
              );
              if (ok == true && await p.deleteCard(draft.id) == null) nav.pop();
            },
          ),
      ],
    );
  }
}

/// ISO date (YYYY-MM-DD) with a date picker and clear.
class _DateField extends StatelessWidget {
  const _DateField({super.key, required this.label, required this.value, required this.onChanged, this.locked = false});
  final String label;
  final String? value;
  final ValueChanged<String?> onChanged;
  final bool locked;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
    child: InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        enabled: !locked,
        prefixIcon: const Icon(Icons.event_outlined),
        suffixIcon: locked
            ? const Icon(Icons.lock_outline, size: 18)
            : (value == null
                  ? null
                  : IconButton(tooltip: 'Clear', icon: const Icon(Icons.close), onPressed: () => onChanged(null))),
      ),
      child: InkWell(
        onTap: locked
            ? null
            : () async {
                final now = DateTime.now();
                final picked = await showDatePicker(
                  context: context,
                  initialDate: DateTime.tryParse(value ?? '') ?? now,
                  firstDate: DateTime(now.year - 30),
                  lastDate: DateTime(now.year + 30),
                );
                if (picked != null) {
                  onChanged('${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-'
                      '${picked.day.toString().padLeft(2, '0')}');
                }
              },
        child: Text(value ?? 'Not set'),
      ),
    ),
  );
}
