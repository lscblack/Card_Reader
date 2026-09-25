import 'dart:async';

import 'package:flutter/services.dart';

/// Source of `nfcterminal://pair...` deep links (mockable).
abstract class DeepLinkSource {
  /// The link that launched the app, if any (returned once).
  Future<String?> initialLink();

  /// Links received while the app is running.
  Stream<String> get links;
}

/// Android implementation backed by MainActivity's `links` channel.
class AndroidDeepLinks implements DeepLinkSource {
  AndroidDeepLinks() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'onLink' && call.arguments is String) {
        _links.add(call.arguments as String);
      }
    });
  }

  static const _channel = MethodChannel('net.nexventures.nfc_terminal/links');
  final _links = StreamController<String>.broadcast();

  @override
  Future<String?> initialLink() async {
    try {
      return await _channel.invokeMethod<String>('getInitialLink');
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Stream<String> get links => _links.stream;
}

/// No deep links (tests, unsupported platforms).
class NoDeepLinks implements DeepLinkSource {
  const NoDeepLinks();

  @override
  Future<String?> initialLink() async => null;

  @override
  Stream<String> get links => const Stream.empty();
}
