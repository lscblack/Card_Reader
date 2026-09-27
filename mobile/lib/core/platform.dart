import 'package:flutter/foundation.dart';

/// iPhone build: wording and flows that differ from Android (scan sheet, no NFC switch, no HCE, no USSD
/// dialing). Follows `debugDefaultTargetPlatformOverride`, so widget tests can check the iOS variants.
bool get isIos => defaultTargetPlatform == TargetPlatform.iOS;

/// Where to hold a card: iPhones read at the top edge, Android phones on the back.
String get nfcSpot => isIos ? 'near the top of the iPhone' : 'near the back of the phone';
