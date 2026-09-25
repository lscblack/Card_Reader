import 'dart:convert';

import 'business.dart';

enum DeliveryMode {
  relay,
  direct;

  static DeliveryMode parse(Object? v) =>
      v == 'direct' ? DeliveryMode.direct : DeliveryMode.relay;
}

/// `DeviceConfig` from the contract (`GET /device/config`).
class DeviceConfig {
  const DeviceConfig({
    required this.deviceId,
    required this.deviceName,
    required this.applicationId,
    required this.applicationName,
    required this.deliveryMode,
    required this.endpointUrl,
    required this.endpointEnabled,
    required this.timeoutSeconds,
    required this.maxRetries,
    required this.customHeaders,
    this.allowedDomains = const [],
    this.signingSecret,
    this.accountType = 'developer',
    this.business,
    this.assignedEmployee,
    this.capabilities = const [],
  });

  final String deviceId;
  final String deviceName;
  final String applicationId;
  final String applicationName;
  final DeliveryMode deliveryMode;
  final String? endpointUrl;
  final bool endpointEnabled;
  final int timeoutSeconds;
  final int maxRetries;
  final Map<String, String> customHeaders;

  /// Endpoint host allowlist (contract 7.1). Empty = no restriction.
  final List<String> allowedDomains;

  /// Present only in direct mode. Kept in memory / secure storage only.
  final String? signingSecret;

  /// Part 2 C1 (absent in Part 1 configs → developer defaults).
  final String accountType;
  final BusinessInfo? business;
  final AssignedEmployee? assignedEmployee;
  final List<String> capabilities;

  bool get isBusiness => accountType == 'business' && business != null;
  bool can(String capability) => isBusiness && capabilities.contains(capability);

  String? get endpointHost {
    final u = endpointUrl == null ? null : Uri.tryParse(endpointUrl!);
    return (u == null || u.host.isEmpty) ? null : u.host;
  }

  Duration get timeout => Duration(seconds: timeoutSeconds.clamp(1, 30));

  factory DeviceConfig.fromJson(Map<String, dynamic> json) {
    final app = (json['application'] as Map?)?.cast<String, dynamic>() ?? {};
    final headers = <String, String>{};
    final rawHeaders = json['custom_headers'];
    if (rawHeaders is Map) {
      rawHeaders.forEach((k, v) {
        if (k is String && v != null) headers[k] = v.toString();
      });
    }
    return DeviceConfig(
      deviceId: json['device_id'] as String? ?? '',
      deviceName: json['device_name'] as String? ?? '',
      applicationId: app['id'] as String? ?? '',
      applicationName: app['name'] as String? ?? '',
      deliveryMode: DeliveryMode.parse(json['delivery_mode']),
      endpointUrl: json['endpoint_url'] as String?,
      endpointEnabled: json['endpoint_enabled'] as bool? ?? false,
      timeoutSeconds: (json['timeout_seconds'] as num?)?.toInt() ?? 10,
      maxRetries: (json['max_retries'] as num?)?.toInt() ?? 3,
      customHeaders: headers,
      allowedDomains: (json['allowed_domains'] as List?)?.whereType<String>().toList() ?? const [],
      signingSecret: json['signing_secret'] as String?,
      accountType: json['account_type'] == 'business' ? 'business' : 'developer',
      business: BusinessInfo.fromJson(json['business']),
      assignedEmployee: AssignedEmployee.fromJson(json['assigned_employee']),
      capabilities: (json['capabilities'] as List?)?.whereType<String>().toList() ?? const [],
    );
  }

  /// Serialisation for the offline cache. Never includes the signing secret.
  String toCacheJson() => jsonEncode({
    'device_id': deviceId,
    'device_name': deviceName,
    'application': {'id': applicationId, 'name': applicationName},
    'delivery_mode': deliveryMode.name,
    'endpoint_url': endpointUrl,
    'endpoint_enabled': endpointEnabled,
    'timeout_seconds': timeoutSeconds,
    'max_retries': maxRetries,
    'custom_headers': customHeaders,
    'allowed_domains': allowedDomains,
    'account_type': accountType,
    'business': business?.toJson(),
    'assigned_employee': assignedEmployee?.toJson(),
    'capabilities': capabilities,
  });

  DeviceConfig withSigningSecret(String? secret) => DeviceConfig(
    deviceId: deviceId,
    deviceName: deviceName,
    applicationId: applicationId,
    applicationName: applicationName,
    deliveryMode: deliveryMode,
    endpointUrl: endpointUrl,
    endpointEnabled: endpointEnabled,
    timeoutSeconds: timeoutSeconds,
    maxRetries: maxRetries,
    customHeaders: customHeaders,
    allowedDomains: allowedDomains,
    signingSecret: secret,
    accountType: accountType,
    business: business,
    assignedEmployee: assignedEmployee,
    capabilities: capabilities,
  );

  @override
  String toString() =>
      'DeviceConfig(device=$deviceId, app=$applicationName, mode=${deliveryMode.name}, '
      'endpointHost=$endpointHost, secret=${signingSecret == null ? 'none' : 'set'})';
}
