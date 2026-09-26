import 'package:flutter/material.dart';

/// Platform dark-red palette, light and dark. Every ColorScheme role is set
/// explicitly so Material 3 never derives purple/lavender tones.
class AppTheme {
  AppTheme._();

  static const brandRed = Color(0xFFB91C1C);

  // Mirrors the web design tokens (web/src/index.css): one dark-red accent on warm neutrals.
  static const lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: Color(0xFFB91C1C), // --accent / --accent-solid
    onPrimary: Color(0xFFFFFFFF),
    primaryContainer: Color(0xFFFEF2F2), // --accent-soft
    onPrimaryContainer: Color(0xFF7F1D1D),
    secondary: Color(0xFF6F5A57),
    onSecondary: Color(0xFFFFFFFF),
    secondaryContainer: Color(0xFFF1E9E8),
    onSecondaryContainer: Color(0xFF2F2221),
    tertiary: Color(0xFFB45309),
    onTertiary: Color(0xFFFFFFFF),
    tertiaryContainer: Color(0xFFFDEBD3),
    onTertiaryContainer: Color(0xFF3B2204),
    error: Color(0xFFC62828),
    onError: Color(0xFFFFFFFF),
    errorContainer: Color(0xFFFFDAD6),
    onErrorContainer: Color(0xFF410002),
    surface: Color(0xFFF7F5F5), // --bg
    onSurface: Color(0xFF1C1717), // --fg
    onSurfaceVariant: Color(0xFF57524F), // --muted
    surfaceDim: Color(0xFFE6E1E1),
    surfaceBright: Color(0xFFFFFFFF),
    surfaceContainerLowest: Color(0xFFFFFFFF),
    surfaceContainerLow: Color(0xFFFFFFFF), // --surface (cards)
    surfaceContainer: Color(0xFFF5F3F3), // --surface-2
    surfaceContainerHigh: Color(0xFFEBE7E7), // --surface-3
    surfaceContainerHighest: Color(0xFFE2DDDD),
    outline: Color(0xFF8A8282),
    outlineVariant: Color(0xFFE7E2E2), // --border
    shadow: Color(0xFF000000),
    scrim: Color(0xFF000000),
    inverseSurface: Color(0xFF2A2324),
    onInverseSurface: Color(0xFFF5F1F1),
    inversePrimary: Color(0xFFF06A6E),
    surfaceTint: Color(0x00000000),
  );

  static const darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: Color(0xFFE5484D), // --accent (text, icons, rings)
    onPrimary: Color(0xFFFFFFFF),
    primaryContainer: Color(0xFF3A1719), // --accent-soft over --bg
    onPrimaryContainer: Color(0xFFFFDAD6),
    secondary: Color(0xFFD6C2BF),
    onSecondary: Color(0xFF3A2A28),
    secondaryContainer: Color(0xFF3A3132),
    onSecondaryContainer: Color(0xFFF1E4E2),
    tertiary: Color(0xFFF0B872),
    onTertiary: Color(0xFF462A00),
    tertiaryContainer: Color(0xFF6A4209),
    onTertiaryContainer: Color(0xFFFFDDB6),
    error: Color(0xFFFF8A80),
    onError: Color(0xFF3A0000),
    errorContainer: Color(0xFF7A1212),
    onErrorContainer: Color(0xFFFFDAD6),
    surface: Color(0xFF0C0A0A), // --bg (warm near-black)
    onSurface: Color(0xFFF5F1F1), // --fg
    onSurfaceVariant: Color(0xFFB3ACAC), // --muted
    surfaceDim: Color(0xFF0C0A0A),
    surfaceBright: Color(0xFF302829),
    surfaceContainerLowest: Color(0xFF0A0808),
    surfaceContainerLow: Color(0xFF141112), // --surface (cards)
    surfaceContainer: Color(0xFF1C1819), // --surface-2
    surfaceContainerHigh: Color(0xFF272122), // --surface-3
    surfaceContainerHighest: Color(0xFF302829),
    outline: Color(0xFF8F8888), // --subtle
    outlineVariant: Color(0xFF2A2324), // --border
    shadow: Color(0xFF000000),
    scrim: Color(0xFF000000),
    inverseSurface: Color(0xFFF5F1F1),
    onInverseSurface: Color(0xFF1C1717),
    inversePrimary: Color(0xFFB91C1C),
    surfaceTint: Color(0x00000000),
  );

  /// Filled buttons/badges (white text ≥ 4.5:1): `--accent-solid`.
  static Color accentSolid(ColorScheme s) => s.brightness == Brightness.dark ? const Color(0xFFDC2626) : s.primary;

  /// `--border-strong` (inputs, outlined buttons).
  static Color borderStrong(ColorScheme s) =>
      s.brightness == Brightness.dark ? const Color(0xFF3A3132) : const Color(0xFFD6D0D0);

  static ThemeData light() => _build(lightScheme);
  static ThemeData dark() => _build(darkScheme);

  static TextTheme _text(TextTheme base, ColorScheme s) {
    TextStyle? t(TextStyle? x, FontWeight w, [double? ls]) => x?.copyWith(fontWeight: w, letterSpacing: ls);
    return base
        .copyWith(
          displaySmall: t(base.displaySmall, FontWeight.w800, -0.8),
          headlineLarge: t(base.headlineLarge, FontWeight.w800, -0.6),
          headlineMedium: t(base.headlineMedium, FontWeight.w700, -0.5),
          headlineSmall: t(base.headlineSmall, FontWeight.w700, -0.3),
          titleLarge: t(base.titleLarge, FontWeight.w700, -0.2),
          titleMedium: t(base.titleMedium, FontWeight.w600, -0.1),
          titleSmall: t(base.titleSmall, FontWeight.w600, 0),
          labelLarge: t(base.labelLarge, FontWeight.w600, 0.1),
          labelMedium: t(base.labelMedium, FontWeight.w600, 0.2),
          bodySmall: base.bodySmall?.copyWith(color: s.onSurfaceVariant, height: 1.4),
          bodyMedium: base.bodyMedium?.copyWith(height: 1.45),
        )
        .apply(bodyColor: s.onSurface, displayColor: s.onSurface);
  }

  static ThemeData _build(ColorScheme scheme) {
    final base = ThemeData(useMaterial3: true, colorScheme: scheme);
    final text = _text(base.textTheme, scheme);
    final radius12 = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
    final strong = borderStrong(scheme);
    return base.copyWith(
      scaffoldBackgroundColor: scheme.surface,
      textTheme: text,
      visualDensity: VisualDensity.standard,
      splashFactory: InkSparkle.splashFactory,
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: AppPageTransitionsBuilder(),
        TargetPlatform.iOS: AppPageTransitionsBuilder(),
        TargetPlatform.linux: AppPageTransitionsBuilder(),
      }),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: text.titleLarge?.copyWith(fontSize: 20),
        shape: Border(bottom: BorderSide(color: scheme.outlineVariant)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerLowest,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: strong)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: strong)),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: scheme.outlineVariant),
        ),
        margin: EdgeInsets.zero,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: accentSolid(scheme),
          foregroundColor: Colors.white,
          shape: radius12,
          minimumSize: const Size(64, 44),
          textStyle: text.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          shape: radius12,
          minimumSize: const Size(64, 44),
          side: BorderSide(color: strong),
          textStyle: text.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(shape: radius12, textStyle: text.labelLarge)),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(
          shape: radius12,
          side: BorderSide(color: strong),
          selectedBackgroundColor: scheme.primaryContainer,
          selectedForegroundColor: scheme.onPrimaryContainer,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 68,
        indicatorColor: scheme.primaryContainer,
        indicatorShape: const StadiumBorder(),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (s) => text.labelMedium?.copyWith(
            color: s.contains(WidgetState.selected) ? scheme.onSurface : scheme.onSurfaceVariant,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (s) => IconThemeData(color: s.contains(WidgetState.selected) ? scheme.primary : scheme.onSurfaceVariant),
        ),
      ),
      chipTheme: ChipThemeData(
        selectedColor: scheme.primaryContainer,
        side: BorderSide(color: scheme.outlineVariant),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        labelStyle: text.labelLarge,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1),
      tabBarTheme: TabBarThemeData(
        labelStyle: text.labelLarge,
        unselectedLabelStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w500),
        dividerColor: scheme.outlineVariant,
        indicatorSize: TabBarIndicatorSize.label,
      ),
      listTileTheme: const ListTileThemeData(contentPadding: EdgeInsets.symmetric(horizontal: 16)),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: scheme.primary),
    );
  }
}

/// Page transition: short fade + slight rise; none when the OS asks for reduced motion.
class AppPageTransitionsBuilder extends PageTransitionsBuilder {
  const AppPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return child;
    final curved = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic, reverseCurve: Curves.easeInCubic);
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween(begin: const Offset(0, 0.04), end: Offset.zero).animate(curved),
        child: FadeTransition(
          opacity: Tween(begin: 1.0, end: 0.6).animate(secondaryAnimation),
          child: child,
        ),
      ),
    );
  }
}

/// Semantic colours for delivery states that read well in both themes.
class StatusColors {
  StatusColors._();

  static Color success(BuildContext c) =>
      Theme.of(c).brightness == Brightness.dark ? const Color(0xFF6DD58C) : const Color(0xFF1E8E3E);
  static Color warning(BuildContext c) =>
      Theme.of(c).brightness == Brightness.dark ? const Color(0xFFFFB74D) : const Color(0xFFB26A00);
  static Color error(BuildContext c) => Theme.of(c).colorScheme.error;
  static Color neutral(BuildContext c) => Theme.of(c).colorScheme.outline;
  static Color active(BuildContext c) => Theme.of(c).colorScheme.primary;
}
