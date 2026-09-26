import 'dart:math' as math;

import 'package:flutter/material.dart';

/// True when the OS asks for reduced motion (Settings → Accessibility → Remove animations).
bool reduceMotion(BuildContext context) => MediaQuery.maybeDisableAnimationsOf(context) ?? false;

/// Fade + slight rise for list items, staggered by [index] (first ~8 items only; none with
/// reduced motion). Plays once per element.
class StaggeredEntrance extends StatefulWidget {
  const StaggeredEntrance({super.key, required this.index, required this.child});
  final int index;
  final Widget child;

  @override
  State<StaggeredEntrance> createState() => _StaggeredEntranceState();
}

class _StaggeredEntranceState extends State<StaggeredEntrance> with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    final delay = math.min(widget.index, 8) * 40;
    _c = AnimationController(vsync: this, duration: Duration(milliseconds: 260 + delay));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (reduceMotion(context)) {
      _c.value = 1;
    } else if (_c.value == 0 && !_c.isAnimating) {
      _c.forward();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final start = (math.min(widget.index, 8) * 40) / (_c.duration!.inMilliseconds);
    final a = CurvedAnimation(parent: _c, curve: Interval(start.clamp(0.0, 0.9), 1, curve: Curves.easeOutCubic));
    return FadeTransition(
      opacity: a,
      child: SlideTransition(position: Tween(begin: const Offset(0, 0.08), end: Offset.zero).animate(a), child: widget.child),
    );
  }
}

/// Animated success tick (circle pops, check draws). Static with reduced motion.
class SuccessCheck extends StatefulWidget {
  const SuccessCheck({super.key, this.size = 72, this.color});
  final double size;
  final Color? color;

  @override
  State<SuccessCheck> createState() => _SuccessCheckState();
}

class _SuccessCheckState extends State<SuccessCheck> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 650));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (reduceMotion(context)) {
      _c.value = 1;
    } else if (_c.value == 0 && !_c.isAnimating) {
      _c.forward();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? const Color(0xFF1E8E3E);
    return Semantics(
      label: 'Success',
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          final pop = Curves.elasticOut.transform((_c.value / 0.6).clamp(0.0, 1.0));
          final draw = Curves.easeOut.transform(((_c.value - 0.35) / 0.65).clamp(0.0, 1.0));
          return SizedBox(
            width: widget.size,
            height: widget.size,
            child: Transform.scale(
              scale: 0.6 + 0.4 * pop,
              child: CustomPaint(painter: _CheckPainter(color, draw)),
            ),
          );
        },
      ),
    );
  }
}

class _CheckPainter extends CustomPainter {
  _CheckPainter(this.color, this.progress);
  final Color color;
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    canvas.drawCircle(c, size.width / 2, Paint()..color = color.withValues(alpha: 0.14));
    canvas.drawCircle(c, size.width / 2 * 0.72, Paint()..color = color);
    final path = Path()
      ..moveTo(size.width * 0.33, size.height * 0.52)
      ..lineTo(size.width * 0.45, size.height * 0.63)
      ..lineTo(size.width * 0.68, size.height * 0.40);
    final metric = path.computeMetrics().first;
    canvas.drawPath(
      metric.extractPath(0, metric.length * progress),
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = size.width * 0.07
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(covariant _CheckPainter old) => old.progress != progress || old.color != color;
}

/// Horizontal shake to draw attention to an error (re-plays when [trigger] changes).
class ErrorShake extends StatefulWidget {
  const ErrorShake({super.key, required this.trigger, required this.child});
  final Object? trigger;
  final Widget child;

  @override
  State<ErrorShake> createState() => _ErrorShakeState();
}

class _ErrorShakeState extends State<ErrorShake> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 420));

  @override
  void didUpdateWidget(covariant ErrorShake old) {
    super.didUpdateWidget(old);
    if (widget.trigger != null && widget.trigger != old.trigger && !reduceMotion(context)) _c.forward(from: 0);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _c,
    builder: (context, child) => Transform.translate(
      offset: Offset(math.sin(_c.value * math.pi * 6) * 8 * (1 - _c.value), 0),
      child: child,
    ),
    child: widget.child,
  );
}
