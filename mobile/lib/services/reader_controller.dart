import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:uuid/uuid.dart';

import '../core/logger.dart';
import '../data/event_repository.dart';
import '../data/models/business.dart';
import '../data/models/card_read.dart';
import '../data/models/device_config.dart';
import '../data/models/event_record.dart';
import 'delivery_service.dart';
import 'nfc_service.dart';
import 'platform_info.dart';

/// What the big indicator on the reader screen shows.
enum ReaderPhase {
  checking,
  unsupported,
  nfcOff,
  stopped,
  ready,
  reading,
  sending,
  delivered,
  failed,
  platformRetrying,
}

/// Reader screen state: NFC session, debounce, and handing reads to delivery.
class ReaderController extends ChangeNotifier {
  ReaderController({
    required this.nfc,
    required this.repository,
    required this.platform,
    required this.deliveryProvider,
    required this.configProvider,
    UidDebouncer? debouncer,
    Future<void> Function()? haptic,
    this.runAction,
  }) : _debouncer = debouncer ?? UidDebouncer(),
       _haptic = haptic ?? HapticFeedback.heavyImpact;

  final NfcService nfc;
  final EventRepository repository;
  final PlatformInfo platform;
  final DeliveryService? Function() deliveryProvider;
  final DeviceConfig? Function() configProvider;
  final UidDebouncer _debouncer;

  /// Business terminals: runs a recognized card's action (e.g. opens `action.url`) after delivery.
  final Future<void> Function(BusinessResult result)? runAction;
  final Future<void> Function() _haptic;

  NfcState nfcState = NfcState.enabled;
  ReaderPhase phase = ReaderPhase.checking;

  /// User wants the reader running (survives pause/resume).
  bool active = false;
  CardRead? lastCard;
  EventRecord? lastEvent;
  String? lastMessage;

  StreamSubscription<NfcState>? _stateSub;
  StreamSubscription<void>? _repoSub;
  Timer? _backToReady;
  bool _disposed = false;
  bool _foreground = true;

  /// While a card is being programmed, reads are not delivered as events.
  bool programming = false;

  /// Reader mode off while another space needs NFC (My Card sharing via HCE, personal scan).
  /// Dispatched tags are still handled.
  bool suspended = false;

  Future<void> suspend() async {
    if (suspended) return;
    suspended = true;
    await nfc.stopReading();
    _notify();
  }

  Future<void> unsuspend() async {
    if (!suspended) return;
    suspended = false;
    if (active) await _enable();
    _notify();
  }

  /// Stops reader mode so the write tap isn't also delivered as an event.
  Future<void> pauseForProgramming() async {
    programming = true;
    _backToReady?.cancel();
    await nfc.stopReading();
    _notify();
  }

  Future<void> resumeAfterProgramming() async {
    programming = false;
    _debouncer.reset(); // the programmed card may be tapped right after
    if (active) await _enable();
    _notify();
  }

  Future<void> init({bool autoStart = true}) async {
    // "active" is the user's intent; reader mode only runs while NFC is on.
    active = autoStart;
    _stateSub = nfc.stateChanges.listen((s) async {
      nfcState = s;
      if (s != NfcState.enabled) {
        phase = ReaderPhase.nfcOff;
      } else if (active) {
        await _enable();
      } else {
        phase = ReaderPhase.stopped;
      }
      _notify();
    });
    // Keep the "last event" panel current when the retry queue updates it.
    _repoSub = repository.changes.listen((_) async {
      final id = lastEvent?.eventId;
      if (id == null) return;
      final fresh = await repository.get(id);
      if (fresh != null && lastEvent?.eventId == id) {
        lastEvent = fresh;
        _notify();
      }
    });
    await refreshAvailability();
    if (active && nfcState == NfcState.enabled) await start();
  }

  Future<void> refreshAvailability() async {
    nfcState = await nfc.checkAvailability();
    phase = switch (nfcState) {
      NfcState.unsupported => ReaderPhase.unsupported,
      NfcState.disabled => ReaderPhase.nfcOff,
      NfcState.enabled => active ? ReaderPhase.ready : ReaderPhase.stopped,
    };
    _notify();
  }

  Future<void> start() async {
    active = true;
    await _enable();
    _notify();
  }

  Future<void> stop() async {
    active = false;
    _backToReady?.cancel();
    await nfc.stopReading();
    await platform.keepScreenOn(false);
    if (nfcState == NfcState.enabled) phase = ReaderPhase.stopped;
    _notify();
  }

  Future<void> _enable() async {
    if (nfcState != NfcState.enabled || !_foreground || programming || suspended) return;
    try {
      await nfc.startReading(onCard: _onCard, onError: _onReadError);
      await platform.keepScreenOn(true);
      phase = ReaderPhase.ready;
      lastMessage = null;
    } catch (e) {
      Log.e('reader', 'cannot start reader mode', e);
      phase = ReaderPhase.failed;
      lastMessage = 'Could not start the NFC reader';
    }
    _notify();
  }

  /// Reader mode only works while the activity is in the foreground.
  Future<void> onResumed() async {
    _foreground = true;
    await refreshAvailability();
    if (active) await _enable();
  }

  Future<void> onPaused() async {
    _foreground = false;
    // Only stop reader mode when this controller owns it. While a card is being programmed or
    // the personal scanner runs (suspended), reader mode belongs to that session: disabling it
    // here would kill the write/scan, and Android restores it by itself on resume.
    if (active && !programming && !suspended) await nfc.stopReading();
  }

  Future<void> openNfcSettings() => nfc.openNfcSettings();

  void _onReadError(Object error) {
    Log.e('reader', 'read failed', error);
    phase = ReaderPhase.failed;
    lastMessage = 'Card read failed, hold the card still and try again';
    _scheduleBackToReady();
    _notify();
  }

  Future<void> _onCard(CardRead card) async {
    await handleCard(card);
  }

  /// The single read → debounce → deliver pipeline, shared by reader mode and
  /// Android tag dispatch. Returns null when the read was ignored (debounced),
  /// otherwise the event after its first delivery attempt.
  Future<EventRecord?> handleCard(CardRead card) async {
    if (programming) return null;
    if (!_debouncer.accept(card.uid, card.detectedAt)) return null;
    unawaited(_haptic());
    _backToReady?.cancel();
    lastCard = card;
    phase = ReaderPhase.reading;
    lastMessage = null;
    _notify();

    final config = configProvider();
    final record = EventRecord(
      eventId: const Uuid().v4(),
      cardId: card.uid,
      technologies: card.technologies,
      cardType: card.type == CardType.unknown ? null : card.type,
      detectedAt: card.detectedAt,
      deliveryMode: config?.deliveryMode ?? DeliveryMode.relay,
      status: EventStatus.pending,
      updatedAt: DateTime.now().toUtc(),
      digitalCardToken: card.digitalCardToken,
    );
    await repository.upsert(record);
    lastEvent = record;

    final delivery = deliveryProvider();
    if (delivery == null || config == null) {
      final queued = record.copyWith(
        status: EventStatus.queued,
        lastError: () => 'Configuration not loaded yet',
        nextAttemptAt: () => DateTime.now().toUtc().add(const Duration(seconds: 5)),
      );
      await repository.upsert(queued);
      _showResult(queued);
      return queued;
    }

    phase = ReaderPhase.sending;
    _notify();
    final result = await delivery.deliver(record, config) ?? record;
    // A newer card may have been read meanwhile; only show the latest.
    if (lastEvent?.eventId == record.eventId) _showResult(result);
    final b = result.business;
    final run = runAction;
    if (run != null && b != null && b.isRecognized && b.actionUrl != null) {
      try {
        await run(b);
      } catch (e) {
        Log.e('reader', 'card action failed', e);
      }
    }
    return result;
  }

  void _showResult(EventRecord r) {
    lastEvent = r;
    phase = switch (r.status) {
      EventStatus.delivered || EventStatus.logged => ReaderPhase.delivered,
      EventStatus.retrying => ReaderPhase.platformRetrying,
      EventStatus.pending => ReaderPhase.sending,
      EventStatus.queued || EventStatus.failed => ReaderPhase.failed,
    };
    _scheduleBackToReady();
    _notify();
  }

  void _scheduleBackToReady() {
    _backToReady?.cancel();
    _backToReady = Timer(const Duration(seconds: 4), () {
      if (active && nfcState == NfcState.enabled) {
        phase = ReaderPhase.ready;
        _notify();
      }
    });
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _backToReady?.cancel();
    _stateSub?.cancel();
    _repoSub?.cancel();
    unawaited(nfc.stopReading());
    unawaited(platform.keepScreenOn(false));
    super.dispose();
  }
}
