import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:uuid/uuid.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/logger.dart';
import '../data/event_repository.dart';
import '../data/models/business.dart';
import '../data/models/card_read.dart';
import '../data/models/device_config.dart';
import '../data/models/endpoint_reply.dart';
import '../data/models/api_models.dart' show GeoFix;
import '../data/models/event_record.dart';
import 'background_reading.dart' show backgroundResultText;
import 'delivery_service.dart';
import 'domain_allowlist.dart';
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
    this.locationProvider,
    Future<bool> Function(Uri url)? openLink,
  }) : _openLink = openLink ?? _launchExternally,
       _debouncer = debouncer ?? UidDebouncer(),
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

  /// Location sharing (opt-in per application): a fix for the tap, or null. Only asked when the config has it on.
  final Future<GeoFix?> Function()? locationProvider;
  final Future<bool> Function(Uri url) _openLink;

  static Future<bool> _launchExternally(Uri url) async {
    try {
      return await launchUrl(url, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }

  NfcState nfcState = NfcState.enabled;
  ReaderPhase phase = ReaderPhase.checking;

  /// User wants the reader running (survives pause/resume). With a session-based reader (iOS) it is only
  /// true while the scan sheet is open: the sheet is never reopened without the user asking.
  bool active = false;

  /// iOS: cards are read in a scan sheet the user opens with "Scan cards" ([NfcService.sessionBased]).
  bool get sessionBased => nfc.sessionBased;
  CardRead? lastCard;
  EventRecord? lastEvent;
  String? lastMessage;

  /// What the endpoint answered to the last tap (`display` is shown instead of only "Delivered").
  EndpointReply? lastReply;

  /// Small notice when the endpoint's link was refused (not https, or its host is not on the application's list).
  String? linkNotice;

  /// The last tap opened the endpoint's link (a dispatched tap must then not send the app to the back).
  bool openedLink = false;

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
    // "active" is the user's intent; reader mode only runs while NFC is on. The iOS sheet would cover the
    // app right at launch: it waits for "Scan cards".
    active = autoStart && !nfc.sessionBased;
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

  /// "Start reader" / iOS "Scan cards" (user action).
  Future<void> start() async {
    active = true;
    await _enable(user: true);
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

  /// Starts reading. The iOS scan sheet only opens on a user action ([user]); resume, unsuspend etc.
  /// never reopen it.
  Future<void> _enable({bool user = false}) async {
    if (nfcState != NfcState.enabled || !_foreground || programming || suspended) return;
    if (nfc.sessionBased && !user) return;
    try {
      await nfc.startReading(onCard: _onCard, onError: _onReadError, onSessionEnd: _onSessionEnd);
      await platform.keepScreenOn(true);
      phase = ReaderPhase.ready;
      lastMessage = null;
    } catch (e) {
      Log.e('reader', 'cannot start reader mode', e);
      if (nfc.sessionBased) active = false;
      phase = ReaderPhase.failed;
      lastMessage = 'Could not start the NFC reader';
    }
    _notify();
  }

  /// iOS: the scan sheet closed (Cancel, timeout, app backgrounded, or stopped here). The last result
  /// stays on screen; "Scan cards" opens a new sheet.
  void _onSessionEnd() {
    if (!active) return;
    active = false;
    unawaited(platform.keepScreenOn(false));
    if (phase == ReaderPhase.ready || phase == ReaderPhase.reading) phase = ReaderPhase.stopped;
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
    _sheetError('Card read failed.');
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
    lastReply = null;
    linkNotice = null;
    openedLink = false;
    phase = ReaderPhase.reading;
    lastMessage = null;
    _notify();

    final config = configProvider();
    // Opt-in: no location is asked for, stored or sent unless the application has sharing on.
    GeoFix? fix;
    if (config?.shareLocation == true) {
      try {
        fix = await locationProvider?.call();
      } catch (e) {
        Log.d('reader', 'no location for this tap: ${e.runtimeType}');
      }
    }
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
      locationJson: fix == null ? null : jsonEncode(fix.toJson()),
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
    if (nfc.sessionBased) unawaited(nfc.setSessionMessage('Sending…'));
    final result = await delivery.deliver(record, config) ?? record;
    if (lastEvent?.eventId == record.eventId) lastReply = result.reply;
    // A newer card may have been read meanwhile; only show the latest.
    if (lastEvent?.eventId == record.eventId) {
      _showResult(result);
      // iOS: the sheet covers the reader screen, so the result goes on the sheet too.
      if (nfc.sessionBased) {
        final text = backgroundResultText(card.uid, result);
        unawaited(nfc.setSessionMessage('${text.title}\nHold the next card near the top of the iPhone.'));
      }
    }
    await _handleReplyLink(result.reply, config);
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

  /// Opens the endpoint's `action_url` only when it is https and on this application's link domains
  /// ([isActionUrlAllowed]). Anything else is dropped; with a domain list set, a small notice says so.
  Future<void> _handleReplyLink(EndpointReply? reply, DeviceConfig config) async {
    final url = reply?.actionUrl;
    if (url == null) return;
    if (!isActionUrlAllowed(url, config.linkDomains)) {
      if (config.linkDomains.isNotEmpty) {
        linkNotice = 'A link from the endpoint was not opened: its address is not on this application\'s allowed list.';
        Log.d('reader', 'reply link refused (host ${Uri.tryParse(url.trim())?.host})');
        _notify();
      }
      return;
    }
    try {
      openedLink = await _openLink(Uri.parse(url.trim()));
    } catch (e) {
      Log.d('reader', 'reply link not opened: ${e.runtimeType}');
    }
    if (!openedLink) {
      linkNotice = 'The link from the endpoint could not be opened.';
      _notify();
    }
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

  /// Text for the iOS sheet after a failed read.
  void _sheetError(String message) {
    if (nfc.sessionBased) unawaited(nfc.setSessionMessage('$message\nHold the next card near the top of the iPhone.'));
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
