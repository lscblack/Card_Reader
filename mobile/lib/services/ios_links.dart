import 'dart:async';

import 'package:flutter/widgets.dart';

import '../core/logger.dart';
import '../core/tap_links.dart';
import 'deep_links.dart';
import 'tag_dispatch.dart';

/// iOS counterpart of MainActivity's link handling. One stream of links opened into the app (from
/// `app_links`, which sees both custom schemes and universal links) is split in two:
/// * `nfcterminal://pair|login|card…` → [deepLinks] (QR pairing, "sign in on your phone", card exchange);
/// * `https://…/t/{code}` universal links → [tags]. iOS reads a card's link in the background when the
///   iPhone touches it and, once the user taps the banner, opens it here: the iPhone version of Android
///   tag dispatch (the card's UID isn't known, only its tap link).
class IosLinkRouter {
  IosLinkRouter(Stream<Uri> links, {bool Function()? inForeground})
    : _inForeground = inForeground ?? _appResumed {
    _sub = links.listen(_route, onError: (Object e) => Log.e('links', 'link stream failed', e));
  }

  final bool Function() _inForeground;
  StreamSubscription<Uri>? _sub;
  late final deepLinks = _IosDeepLinks();
  late final tags = _IosTagDispatch();

  static bool _appResumed() => WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;

  void _route(Uri uri) {
    final scheme = uri.scheme.toLowerCase();
    if (scheme == 'nfcterminal') {
      if (const {'pair', 'login', 'card'}.contains(uri.host.toLowerCase())) deepLinks._add(uri.toString());
      return;
    }
    if (tapCodeOf(uri) != null) {
      tags._add(DispatchedTag(
        uidHex: '',
        techList: const [],
        launchedFromBackground: !_inForeground(),
        receivedAt: DateTime.now().toUtc(),
        ndefUris: [uri.toString()],
      ));
      return;
    }
    Log.d('links', 'ignored link ${uri.scheme}://${uri.host}${uri.path}');
  }

  void dispose() => _sub?.cancel();
}

/// Links wait until the app asks for its initial link (the app isn't listening before).
class _IosDeepLinks implements DeepLinkSource {
  final _links = StreamController<String>.broadcast();
  final _early = <String>[];
  bool _ready = false;

  void _add(String link) => _ready ? _links.add(link) : _early.add(link);

  @override
  Future<String?> initialLink() async {
    _ready = true;
    if (_early.isEmpty) return null;
    // The latest one wins (like Android's single launch intent).
    final last = _early.last;
    _early.clear();
    return last;
  }

  @override
  Stream<String> get links => _links.stream;
}

/// Tap links buffered until Dart takes them, like MainActivity's pending tags. iOS has no background
/// dispatch to switch, no notifications to show for it, and an app can't send itself to the back.
class _IosTagDispatch implements TagDispatch {
  final _tags = StreamController<DispatchedTag>.broadcast();
  final _pending = <DispatchedTag>[];
  bool _ready = false;

  void _add(DispatchedTag t) => _ready ? _tags.add(t) : _pending.add(t);

  @override
  Future<List<DispatchedTag>> takePending() async {
    _ready = true;
    final l = List<DispatchedTag>.of(_pending);
    _pending.clear();
    return l;
  }

  @override
  Stream<DispatchedTag> get tags => _tags.stream;

  @override
  Future<void> setDispatchEnabled(bool enabled) async {}

  @override
  Future<bool> isDispatchEnabled() async => true;

  @override
  Future<void> showNotification(String title, String body) async {}

  /// Nothing to ask: tap links open the app in the foreground, where the result is shown.
  @override
  Future<bool> requestNotificationPermission() async => true;

  @override
  Future<void> moveToBack() async {}
}
