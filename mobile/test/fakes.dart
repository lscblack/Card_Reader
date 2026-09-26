import 'dart:async';

import 'package:nfc_terminal/data/api_client.dart';
import 'package:nfc_terminal/data/event_repository.dart';
import 'package:nfc_terminal/data/models/api_models.dart';
import 'package:nfc_terminal/data/models/business.dart';
import 'package:nfc_terminal/data/models/card_read.dart';
import 'package:nfc_terminal/data/models/device_config.dart';
import 'package:nfc_terminal/data/models/event_record.dart';
import 'package:nfc_terminal/services/nfc_service.dart';
import 'package:nfc_terminal/services/platform_info.dart';
import 'package:nfc_terminal/services/tag_dispatch.dart';

DeviceConfig testConfig({
  DeliveryMode mode = DeliveryMode.relay,
  String? endpointUrl = 'https://example.com/api/nfc/card',
  bool enabled = true,
  String? secret,
  int maxRetries = 3,
  Map<String, String> customHeaders = const {},
  List<String> allowedDomains = const [],
}) => DeviceConfig(
  deviceId: '3b241101-e2bb-4255-8caf-4136c566a962',
  deviceName: 'Front desk Pixel',
  applicationId: 'a1b2c3d4-0000-4000-8000-000000000000',
  applicationName: 'Gym',
  deliveryMode: mode,
  endpointUrl: endpointUrl,
  endpointEnabled: enabled,
  timeoutSeconds: 5,
  maxRetries: maxRetries,
  customHeaders: customHeaders,
  allowedDomains: allowedDomains,
  signingSecret: secret,
);

EventRecord testEvent({String id = '7f1c2d3e-0000-4000-8000-000000000001', int attempts = 0}) => EventRecord(
  eventId: id,
  cardId: '04A1B2C3D4E5',
  technologies: const ['NfcA', 'MifareUltralight'],
  cardType: 'mifare_ultralight',
  detectedAt: DateTime.utc(2026, 9, 25, 8, 30, 21),
  deliveryMode: DeliveryMode.relay,
  status: EventStatus.pending,
  attempts: attempts,
  updatedAt: DateTime.utc(2026, 9, 25, 8, 30, 21),
);

class InMemoryEventRepository implements EventRepository {
  final Map<String, EventRecord> rows = {};
  final _changes = StreamController<void>.broadcast();

  @override
  Stream<void> get changes => _changes.stream;

  @override
  Future<void> upsert(EventRecord record) async {
    rows[record.eventId] = record;
    _changes.add(null);
  }

  @override
  Future<EventRecord?> get(String eventId) async => rows[eventId];

  @override
  Future<List<EventRecord>> list({EventStatus? status, int limit = 200}) async {
    final l = rows.values.where((e) => status == null || e.status == status).toList()
      ..sort((a, b) => b.detectedAt.compareTo(a.detectedAt));
    return l.take(limit).toList();
  }

  @override
  Future<List<EventRecord>> dueForRetry(DateTime now) async => rows.values
      .where((e) => e.status == EventStatus.queued && (e.nextAttemptAt == null || !e.nextAttemptAt!.isAfter(now.toUtc())))
      .toList();

  @override
  Future<DateTime?> nextRetryAt() async {
    final t = rows.values.where((e) => e.status == EventStatus.queued).map((e) => e.nextAttemptAt).whereType<DateTime>().toList()
      ..sort();
    return t.isEmpty ? null : t.first;
  }

  @override
  Future<List<EventRecord>> withPendingReports() async =>
      rows.values.where((e) => e.pendingReport != null).toList();

  @override
  Future<Map<EventStatus, int>> countByStatus() async {
    final m = <EventStatus, int>{};
    for (final e in rows.values) {
      m[e.status] = (m[e.status] ?? 0) + 1;
    }
    return m;
  }

  @override
  Future<void> clear() async {
    rows.removeWhere((_, e) => e.status != EventStatus.queued && e.status != EventStatus.pending && e.pendingReport == null);
    _changes.add(null);
  }

  @override
  Future<void> close() => _changes.close();
}

class FakePlatformInfo implements PlatformInfo {
  @override
  Future<DeviceDetails> deviceDetails() async =>
      const DeviceDetails(manufacturer: 'Google', model: 'Pixel 8', osVersion: 'Android 15', appVersion: '1.0.0');

  @override
  Stream<bool> get onlineChanges => const Stream.empty();

  @override
  Future<bool> isOnline() async => true;

  @override
  Future<void> keepScreenOn(bool on) async {}

  @override
  Future<bool> openAppSettings() async => true;
}

class FakeNfcService implements NfcService {
  NfcState state = NfcState.enabled;
  void Function(CardRead)? onCard;
  final _states = StreamController<NfcState>.broadcast();

  @override
  Future<NfcState> checkAvailability() async => state;

  @override
  Stream<NfcState> get stateChanges => _states.stream;

  @override
  Future<void> startReading({required void Function(CardRead) onCard, required void Function(Object) onError}) async {
    this.onCard = onCard;
  }

  @override
  Future<void> stopReading() async => onCard = null;

  @override
  Future<bool> openNfcSettings() async => true;
}

/// Scriptable [DeviceApi].
class FakeDeviceApi implements DeviceApi {
  final List<EventSubmission> submissions = [];
  List<BusinessCardItem> cards = [];
  final registered = <Map<String, Object?>>[];
  final programmed = <Map<String, String>>[];
  Object? registerError;
  Object? programmedError;

  @override
  Future<List<BusinessCardItem>> listBusinessCards({String? query, bool? programmed}) async => cards
      .where((c) => programmed == null || c.programmed == programmed)
      .where((c) => query == null || query.isEmpty || c.name.toLowerCase().contains(query.toLowerCase()))
      .toList();

  final registeredOptions = <Map<String, Object?>>[];

  @override
  Future<BusinessCardItem> registerBusinessCard({
    required String uid,
    String? name,
    required String kind,
    bool? assignToBusiness,
    String? note,
  }) async {
    if (registerError != null) throw registerError!;
    registered.add({'uid': uid, 'name': name, 'kind': kind});
    registeredOptions.add({'assign_to_business': assignToBusiness, 'note': note});
    final item = BusinessCardItem(
      id: 'new${registered.length}',
      name: (name == null || name.trim().isEmpty) ? 'Card ${uid.substring(uid.length - 4)}' : name.trim(),
      kind: kind,
      assigneeType: assignToBusiness == true ? 'business' : null,
      uidMasked: '••${uid.substring(uid.length - 4)}',
      tapUrl: 'https://t.example/c/new${registered.length}',
      programmed: false,
    );
    cards = [...cards, item];
    return item;
  }

  @override
  Future<void> markCardProgrammed({required String cardId, required String uid}) async {
    if (programmedError != null) throw programmedError!;
    programmed.add({'id': cardId, 'uid': uid});
  }
  Future<EventSubmitResult> Function(EventSubmission s)? onSubmit;
  Future<DeviceConfig> Function()? onGetConfig;

  @override
  Future<RegisterResult> register({required String apiKey, required DeviceRegistration registration}) async =>
      RegisterResult(deviceToken: 'nfcd_test', config: testConfig());

  @override
  Future<DeviceConfig> getConfig() => onGetConfig?.call() ?? Future.value(testConfig());

  @override
  Future<HeartbeatResult> heartbeat() async => const HeartbeatResult(status: 'active');

  @override
  Future<EventSubmitResult> submitEvent(EventSubmission submission, {Duration? timeout}) {
    submissions.add(submission);
    return onSubmit?.call(submission) ??
        Future.value(EventSubmitResult(eventId: submission.eventId, status: 'delivered', statusCode: 200, latencyMs: 12));
  }
}

class FakeTagDispatch implements TagDispatch {
  final pending = <DispatchedTag>[];
  final _tags = StreamController<DispatchedTag>.broadcast();
  final enabledCalls = <bool>[];
  final notifications = <String>[];
  int movedToBack = 0;
  int permissionRequests = 0;

  void emit(DispatchedTag t) => _tags.add(t);

  @override
  Future<List<DispatchedTag>> takePending() async {
    final l = List<DispatchedTag>.of(pending);
    pending.clear();
    return l;
  }

  @override
  Stream<DispatchedTag> get tags => _tags.stream;

  @override
  Future<void> setDispatchEnabled(bool enabled) async => enabledCalls.add(enabled);

  @override
  Future<bool> isDispatchEnabled() async => enabledCalls.isNotEmpty && enabledCalls.last;

  @override
  Future<void> showNotification(String title, String body) async => notifications.add(title);

  @override
  Future<bool> requestNotificationPermission() async {
    permissionRequests++;
    return true;
  }

  @override
  Future<void> moveToBack() async => movedToBack++;
}
