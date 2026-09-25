import 'package:flutter/material.dart';

import 'card_style.dart';

/// Presets + HSV sliders + hex field. Returns `#RRGGBB` or null.
Future<String?> pickCardColor(BuildContext context, String current, {String title = 'Colour'}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => _ColorPickerSheet(initial: current, title: title),
);

class _ColorPickerSheet extends StatefulWidget {
  const _ColorPickerSheet({required this.initial, required this.title});
  final String initial, title;

  @override
  State<_ColorPickerSheet> createState() => _ColorPickerSheetState();
}

class _ColorPickerSheetState extends State<_ColorPickerSheet> {
  late HSVColor _hsv = HSVColor.fromColor(hexColor(widget.initial));
  late final _hex = TextEditingController(text: widget.initial.toUpperCase());

  void _set(HSVColor c, {bool fromHex = false}) {
    setState(() => _hsv = c);
    if (!fromHex) _hex.text = colorHex(c.toColor());
  }

  @override
  void dispose() {
    _hex.dispose();
    super.dispose();
  }

  Widget _slider(String label, double value, double max, ValueChanged<double> onChanged, List<Color> colors) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: Theme.of(context).textTheme.labelMedium),
      Container(
        height: 12,
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(6), gradient: LinearGradient(colors: colors)),
      ),
      Slider(value: value, max: max, onChanged: onChanged),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final c = _hsv.toColor();
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(children: [
              Expanded(child: Text(widget.title, style: Theme.of(context).textTheme.titleLarge)),
              Container(width: 40, height: 40, decoration: BoxDecoration(color: c, shape: BoxShape.circle, border: Border.all(color: Colors.black26))),
            ]),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final p in cardColorPresets)
                  InkWell(
                    key: Key('preset_$p'),
                    customBorder: const CircleBorder(),
                    onTap: () => Navigator.of(context).pop(p),
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: hexColor(p),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.black26),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            _slider('Hue', _hsv.hue, 360, (v) => _set(_hsv.withHue(v)),
                [for (var h = 0; h <= 360; h += 60) HSVColor.fromAHSV(1, h.toDouble(), 1, 1).toColor()]),
            _slider('Saturation', _hsv.saturation, 1, (v) => _set(_hsv.withSaturation(v)),
                [_hsv.withSaturation(0).toColor(), _hsv.withSaturation(1).toColor()]),
            _slider('Brightness', _hsv.value, 1, (v) => _set(_hsv.withValue(v)),
                [Colors.black, _hsv.withValue(1).toColor()]),
            TextField(
              controller: _hex,
              decoration: const InputDecoration(labelText: 'Hex', prefixIcon: Icon(Icons.tag)),
              onChanged: (v) {
                final col = hexColor(v, const Color(0x00000000));
                if (col.a > 0 && RegExp(r'^#?[0-9a-fA-F]{6}$').hasMatch(v.trim())) _set(HSVColor.fromColor(col), fromHex: true);
              },
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => Navigator.of(context).pop(colorHex(c)), child: const Text('Use colour')),
          ],
        ),
      ),
    );
  }
}
