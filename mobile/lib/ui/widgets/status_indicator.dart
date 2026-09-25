import 'package:flutter/material.dart';

/// Large circular state indicator. Pulses while [pulsing] is true.
class StatusIndicator extends StatefulWidget {
  const StatusIndicator({
    super.key,
    required this.icon,
    required this.color,
    required this.title,
    this.subtitle,
    this.pulsing = false,
    this.busy = false,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String? subtitle;
  final bool pulsing;
  final bool busy;

  @override
  State<StatusIndicator> createState() => _StatusIndicatorState();
}

class _StatusIndicatorState extends State<StatusIndicator> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant StatusIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    if (widget.pulsing && !_c.isAnimating) {
      _c.repeat();
    } else if (!widget.pulsing && _c.isAnimating) {
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
    final t = Theme.of(context).textTheme;
    const size = 168.0;
    return Semantics(
      liveRegion: true,
      label: '${widget.title}. ${widget.subtitle ?? ''}',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: size + 48,
            height: size + 48,
            child: AnimatedBuilder(
              animation: _c,
              builder: (context, child) {
                final v = _c.value;
                return Stack(
                  alignment: Alignment.center,
                  children: [
                    if (widget.pulsing)
                      Container(
                        width: size + 48 * v,
                        height: size + 48 * v,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: widget.color.withValues(alpha: 0.18 * (1 - v)),
                        ),
                      ),
                    child!,
                  ],
                );
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                width: size,
                height: size,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: widget.color.withValues(alpha: 0.14),
                  border: Border.all(color: widget.color, width: 3),
                ),
                child: widget.busy
                    ? Padding(
                        padding: const EdgeInsets.all(52),
                        child: CircularProgressIndicator(strokeWidth: 5, color: widget.color),
                      )
                    : Icon(widget.icon, size: 72, color: widget.color),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(widget.title, style: t.headlineSmall?.copyWith(fontWeight: FontWeight.w600), textAlign: TextAlign.center),
          if (widget.subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              widget.subtitle!,
              style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}
