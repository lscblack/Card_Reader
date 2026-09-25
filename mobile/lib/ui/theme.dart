import 'package:flutter/material.dart';

/// Platform dark-red palette, light and dark. Every ColorScheme role is set
/// explicitly so Material 3 never derives purple/lavender tones.
class AppTheme {
  AppTheme._();

  static const brandRed = Color(0xFFB91C1C);

  static const lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: Color(0xFFB91C1C),
    onPrimary: Color(0xFFFFFFFF),
    primaryContainer: Color(0xFFFDE2E0),
    onPrimaryContainer: Color(0xFF5C0A0A),
    secondary: Color(0xFF7C4A45),
    onSecondary: Color(0xFFFFFFFF),
    secondaryContainer: Color(0xFFF6E1DE),
    onSecondaryContainer: Color(0xFF3A1714),
    tertiary: Color(0xFF9A5B13),
    onTertiary: Color(0xFFFFFFFF),
    tertiaryContainer: Color(0xFFFBE3C8),
    onTertiaryContainer: Color(0xFF3B2204),
    error: Color(0xFFC62828),
    onError: Color(0xFFFFFFFF),
    errorContainer: Color(0xFFFFDAD6),
    onErrorContainer: Color(0xFF410002),
    surface: Color(0xFFFFFBFA),
    onSurface: Color(0xFF221A19),
    onSurfaceVariant: Color(0xFF5A4643),
    surfaceDim: Color(0xFFE8D8D5),
    surfaceBright: Color(0xFFFFFBFA),
    surfaceContainerLowest: Color(0xFFFFFFFF),
    surfaceContainerLow: Color(0xFFFCF1EF),
    surfaceContainer: Color(0xFFF7EBE9),
    surfaceContainerHigh: Color(0xFFF1E5E3),
    surfaceContainerHighest: Color(0xFFEBDFDD),
    outline: Color(0xFF8E7471),
    outlineVariant: Color(0xFFDCC3BF),
    shadow: Color(0xFF000000),
    scrim: Color(0xFF000000),
    inverseSurface: Color(0xFF382E2D),
    onInverseSurface: Color(0xFFFCEEEC),
    inversePrimary: Color(0xFFFFB4AB),
    surfaceTint: Color(0xFFB91C1C),
  );

  static const darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: Color(0xFFF26B5E),
    onPrimary: Color(0xFF2B0503),
    primaryContainer: Color(0xFF8E1616),
    onPrimaryContainer: Color(0xFFFFDAD5),
    secondary: Color(0xFFE2BDB8),
    onSecondary: Color(0xFF3F2522),
    secondaryContainer: Color(0xFF4A2B27),
    onSecondaryContainer: Color(0xFFF6DEDA),
    tertiary: Color(0xFFF0B872),
    onTertiary: Color(0xFF462A00),
    tertiaryContainer: Color(0xFF6A4209),
    onTertiaryContainer: Color(0xFFFFDDB6),
    error: Color(0xFFFF8A80),
    onError: Color(0xFF3A0000),
    errorContainer: Color(0xFF7A1212),
    onErrorContainer: Color(0xFFFFDAD6),
    surface: Color(0xFF15100F), // warm near-black
    onSurface: Color(0xFFEFE0DE),
    onSurfaceVariant: Color(0xFFD2BCB8),
    surfaceDim: Color(0xFF15100F),
    surfaceBright: Color(0xFF3D3432),
    surfaceContainerLowest: Color(0xFF0F0B0A),
    surfaceContainerLow: Color(0xFF1E1716),
    surfaceContainer: Color(0xFF231B1A),
    surfaceContainerHigh: Color(0xFF2D2524),
    surfaceContainerHighest: Color(0xFF382F2E),
    outline: Color(0xFF9D8784),
    outlineVariant: Color(0xFF52413E),
    shadow: Color(0xFF000000),
    scrim: Color(0xFF000000),
    inverseSurface: Color(0xFFEFE0DE),
    onInverseSurface: Color(0xFF382E2D),
    inversePrimary: Color(0xFFB91C1C),
    surfaceTint: Color(0xFFF26B5E),
  );

  static ThemeData light() => _build(lightScheme);
  static ThemeData dark() => _build(darkScheme);

  static ThemeData _build(ColorScheme scheme) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
      appBarTheme: AppBarTheme(backgroundColor: scheme.surface, foregroundColor: scheme.onSurface, elevation: 0),
      inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        margin: EdgeInsets.zero,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainer,
        indicatorColor: scheme.primaryContainer,
      ),
      chipTheme: ChipThemeData(selectedColor: scheme.primaryContainer),
      listTileTheme: const ListTileThemeData(contentPadding: EdgeInsets.symmetric(horizontal: 16)),
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
