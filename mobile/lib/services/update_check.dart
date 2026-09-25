import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config.dart';
import '../core/http_client.dart';
import '../core/logger.dart';

/// Latest published release (`GET /meta/app-release`, Part 3 §9).
class AppRelease {
  const AppRelease({
    required this.versionName,
    required this.buildNumber,
    required this.downloadUrl,
    this.fileSize,
    this.sha256,
    this.minAndroid,
  });

  final String versionName;
  final int buildNumber;
  final String downloadUrl;
  final int? fileSize;
  final String? sha256;
  final String? minAndroid;

  /// Null when the payload is unusable. Relative download URLs are resolved
  /// against [baseUrl].
  static AppRelease? fromJson(Map<String, dynamic> j, String baseUrl) {
    final build = (j['build_number'] as num?)?.toInt();
    final url = j['download_url'] as String?;
    if (build == null || url == null || url.isEmpty) return null;
    final resolved = Uri.parse(baseUrl).resolve(url).toString();
    final scheme = Uri.parse(resolved).scheme;
    if (scheme != 'https' && scheme != 'http') return null;
    return AppRelease(
      versionName: j['version_name'] as String? ?? '$build',
      buildNumber: build,
      downloadUrl: resolved,
      fileSize: (j['file_size'] as num?)?.toInt(),
      sha256: j['sha256'] as String?,
      minAndroid: j['min_android'] as String?,
    );
  }
}

/// Checks the platform for a newer APK. Failures (incl. `404 no_release`) are silent.
class UpdateChecker {
  UpdateChecker({required this.client, required this.installedBuild, DateTime Function()? clock})
    : _now = clock ?? DateTime.now;

  final http.Client client;
  final int installedBuild;
  final DateTime Function() _now;
  static const interval = Duration(hours: 24);

  DateTime? lastCheckedAt;

  bool get isDue => lastCheckedAt == null || _now().difference(lastCheckedAt!) >= interval;

  /// Returns the newer release, or null (up to date, no release, or any error).
  Future<AppRelease?> check(String serverUrl) async {
    lastCheckedAt = _now();
    final base = ServerUrl.normalize(serverUrl);
    try {
      final res = await sendBytes(
        client,
        method: 'GET',
        url: Uri.parse('$base${AppConfig.apiPrefix}/meta/app-release'),
        headers: const {'Accept': 'application/json', 'User-Agent': AppConfig.apiUserAgent},
        timeout: const Duration(seconds: 15),
      );
      if (res.statusCode != 200) return null; // 404 no_release and anything else: silent
      final j = jsonDecode(res.body);
      if (j is! Map<String, dynamic>) return null;
      final release = AppRelease.fromJson(j, base);
      if (release == null || release.buildNumber <= installedBuild) return null;
      return release;
    } catch (e) {
      Log.d('update', 'update check failed: ${e.runtimeType}');
      return null;
    }
  }
}
