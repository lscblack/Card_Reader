import 'dart:async';

import 'package:flutter/services.dart';

import '../core/logger.dart';
import '../data/models/card_read.dart';

/// A tag delivered by Android's tag dispatch system (the app was opened, or
/// brought forward, by tapping a card), as opposed to reader mode.
class DispatchedTag {
  const DispatchedTag({
    required this.uidHex,
    required this.techList,
    this.sak,
    this.productType,
    required this.launchedFromBackground,
    required this.receivedAt,
    this.digitalCardToken,
  });

  final String uidHex;
  final List<String> techList;
  final int? sak;

  /// GET_VERSION product type probed in Kotlin (0x04 = NTAG), if any.
  final int? productType;

  /// True when the activity was not visible when the tag arrived (cold start
  /// or brought from the background). Only then do we return to the previous
  /// app after delivery.
  final bool launchedFromBackground;
  final DateTime receivedAt;

  /// Part 4: set when the tag was a phone sharing a digital card (probed in Kotlin).
  final String? digitalCardToken;

  factory DispatchedTag.fromMap(Map<Object?, Object?> m, {DateTime? now}) => DispatchedTag(
    uidHex: (m['uid'] as String?) ?? '',
    techList: ((m['techList'] as List?) ?? const []).whereType<String>().toList(),
    sak: (m['sak'] as num?)?.toInt(),
    productType: (m['productType'] as num?)?.toInt(),
    launchedFromBackground: m['fromBackground'] == true,
    receivedAt: now ?? DateTime.now().toUtc(),
    digitalCardToken: m['digitalCardToken'] as String?,
  );

  /// Same normalisation and type guessing as reader mode. Null if the UID is unusable.
  CardRead? toCardRead() {
    final token = digitalCardToken;
    if (token != null) {
      final d = digitalCardRead(token, techList.map(CardUtils.shortTechName).toList(), receivedAt);
      if (d != null) return d;
    }
    final uid = CardUtils.normalizeUid(uidHex);
    if (uid == null) return null;
    final techs = techList.map(CardUtils.shortTechName).toList();
    return CardRead(
      uid: uid,
      technologies: techs,
      type: CardUtils.guessCardType(technologies: techs, sak: sak, ultralightProductType: productType),
      detectedAt: receivedAt,
    );
  }
}

/// Bridge to the Android tag-dispatch alias, notifications and task control.
abstract class TagDispatch {
  /// Tags that arrived before Dart was listening (e.g. the launch tag).
  Future<List<DispatchedTag>> takePending();

  /// Tags arriving while running.
  Stream<DispatchedTag> get tags;

  /// Enables/disables the `.NfcTagLauncher` activity-alias.
  Future<void> setDispatchEnabled(bool enabled);
  Future<bool> isDispatchEnabled();

  Future<void> showNotification(String title, String body);

  /// Android 13+: asks for POST_NOTIFICATIONS. Returns whether granted.
  Future<bool> requestNotificationPermission();

  /// Sends the task to the back so the user returns to the previous app.
  Future<void> moveToBack();
}

class AndroidTagDispatch implements TagDispatch {
  AndroidTagDispatch({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel('net.nexventures.nfc_terminal/tags') {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'onTag' && call.arguments is Map) {
        _tags.add(DispatchedTag.fromMap(call.arguments as Map));
      }
    });
  }

  final MethodChannel _channel;
  final _tags = StreamController<DispatchedTag>.broadcast();

  Future<T?> _call<T>(String method, [Object? args]) async {
    try {
      return await _channel.invokeMethod<T>(method, args);
    } on PlatformException catch (e) {
      Log.e('tags', '$method failed', e);
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Future<List<DispatchedTag>> takePending() async {
    final list = await _call<List<Object?>>('takePendingTags') ?? const [];
    return list.whereType<Map<Object?, Object?>>().map(DispatchedTag.fromMap).toList();
  }

  @override
  Stream<DispatchedTag> get tags => _tags.stream;

  @override
  Future<void> setDispatchEnabled(bool enabled) => _call<void>('setDispatchEnabled', enabled);

  @override
  Future<bool> isDispatchEnabled() async => await _call<bool>('isDispatchEnabled') ?? false;

  @override
  Future<void> showNotification(String title, String body) =>
      _call<void>('showNotification', {'title': title, 'body': body});

  @override
  Future<bool> requestNotificationPermission() async =>
      await _call<bool>('requestNotificationPermission') ?? false;

  @override
  Future<void> moveToBack() => _call<void>('moveToBack');
}

/// No-op implementation (tests, non-Android).
class NoTagDispatch implements TagDispatch {
  const NoTagDispatch();
  @override
  Future<List<DispatchedTag>> takePending() async => const [];
  @override
  Stream<DispatchedTag> get tags => const Stream.empty();
  @override
  Future<void> setDispatchEnabled(bool enabled) async {}
  @override
  Future<bool> isDispatchEnabled() async => false;
  @override
  Future<void> showNotification(String title, String body) async {}
  @override
  Future<bool> requestNotificationPermission() async => false;
  @override
  Future<void> moveToBack() async {}
}
