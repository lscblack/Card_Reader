import 'package:flutter/material.dart';

/// NexTap brand images (assets/brand). Wide spots (welcome, setup, headers) use the wordmark — the logo with the
/// name, with a lighter version on dark backgrounds; small or square spots use the icon.
class BrandWordmark extends StatelessWidget {
  const BrandWordmark({super.key, this.height = 56});
  final double height;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Image.asset(
      dark ? 'assets/brand/wordmark_dark.png' : 'assets/brand/wordmark.png',
      key: const Key('brandWordmark'),
      height: height,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
      semanticLabel: 'nexTap',
    );
  }
}

class BrandIcon extends StatelessWidget {
  const BrandIcon({super.key, this.size = 40});
  final double size;

  @override
  Widget build(BuildContext context) => Image.asset(
        'assets/brand/icon.png',
        key: const Key('brandIcon'),
        width: size,
        height: size,
        filterQuality: FilterQuality.medium,
        semanticLabel: 'nexTap',
      );
}
