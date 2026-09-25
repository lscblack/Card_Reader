import 'package:flutter/material.dart';

/// Animated NFC ripple around a phone icon (Share / Scan states).
class NfcRipple extends StatefulWidget {
  const NfcRipple({super.key, required this.color, this.icon = Icons.contactless_outlined, this.active = true, this.size = 150});

  final Color color;
  final IconData icon;
  final bool active;
  final double size;

  @override
  State<NfcRipple> createState() => _NfcRippleState();
}

class _NfcRippleState extends State<NfcRipple> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200));

  @override
  void initState() {
    super.initState();
    if (widget.active) _c.repeat();
  }

  @override
  void didUpdateWidget(covariant NfcRipple old) {
    super.didUpdateWidget(old);
    if (widget.active && !_c.isAnimating) _c.repeat();
    if (!widget.active && _c.isAnimating) {
      _c.stop();
      _c.value = 0;
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.size;
    return SizedBox(
      width: s,
      height: s,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => Stack(
          alignment: Alignment.center,
          children: [
            for (var i = 0; i < 3; i++)
              Builder(builder: (_) {
                final v = ((_c.value + i / 3) % 1.0);
                return Opacity(
                  opacity: widget.active ? (1 - v) * 0.5 : 0,
                  child: Container(
                    width: s * (0.4 + 0.6 * v),
                    height: s * (0.4 + 0.6 * v),
                    decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: widget.color, width: 2)),
                  ),
                );
              }),
            Container(
              width: s * 0.42,
              height: s * 0.42,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: widget.color,
                boxShadow: [BoxShadow(color: widget.color.withValues(alpha: 0.4), blurRadius: 18)],
              ),
              child: Icon(widget.icon, color: Colors.white, size: s * 0.2),
            ),
          ],
        ),
      ),
    );
  }
}
