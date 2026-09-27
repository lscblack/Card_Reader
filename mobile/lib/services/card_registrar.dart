import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../core/app_error.dart';
import '../core/logger.dart';
import '../data/api_client.dart';
import '../data/models/api_models.dart';
import '../data/models/business.dart';
import '../data/models/card_read.dart';
import 'card_programmer.dart';
import 'nfc_service.dart';
import 'reader_controller.dart';

enum RegisterPhase {
  /// "Tap a card to register it" (reader active).
  waiting,

  /// A new UID was tapped: the registration sheet is open ([CardRegistrar.pendingUid]).
  sheet,
  saving,

  /// Registered ([CardRegistrar.last]); "Tap the next card".
  success,

  /// The tapped card is already registered ([CardRegistrar.alreadyName]).
  already,

  /// Writing the tap link (hold the card / hold it again).
  writing,

  /// Something to show (e.g. a digital card or a failed write); taps continue.
  notice,
}

class RegisteredCard {
  RegisteredCard({required this.item, required this.uid, this.programmed = false, this.writeError});
  final BusinessCardItem item;
  final String uid;
  bool programmed;
  AppError? writeError;
}

/// Masks a UID like the server's `uid_masked` (all but the last 4 hex digits → •).
String maskUid(String uid) => uid.length <= 4 ? uid : '${'•' * (uid.length - 4)}${uid.substring(uid.length - 4)}';

/// "Register cards" mode for business devices (`cards.register`): a continuous reader session where
/// every new tap opens the registration sheet. Normal event delivery is paused meanwhile (the
/// terminal reader is put in its programming state, which also ignores dispatched tags).
class CardRegistrar extends ChangeNotifier {
  CardRegistrar({
    required this.api,
    required this.nfc,
    required this.reader,
    this.programmer,
    this.businessName,
    UidDebouncer? debouncer,
    Future<void> Function()? haptic,
  }) : _debouncer = debouncer ?? UidDebouncer(),
       _haptic = haptic ?? HapticFeedback.mediumImpact;

  final DeviceApi api;
  final NfcService nfc;
  final ReaderController reader;

  /// Null when the device can't program cards (`cards.program`): no "write the link" option.
  final CardProgrammer? programmer;

  /// For the "Company (<name>)" owner choice.
  final String? businessName;
  final UidDebouncer _debouncer;
  final Future<void> Function() _haptic;

  // Choices remembered between taps.
  String kind = 'card';
  bool assignToBusiness = true;
  bool writeLink = false;
  int _nextCard = 1, _nextTag = 1;

  RegisterPhase phase = RegisterPhase.waiting;
  String? pendingUid;
  String? alreadyName;
  String? notice;
  RegisteredCard? last;
  final registered = <RegisteredCard>[];
  final _known = <String, String>{};
  bool _active = false, _listening = false, _disposed = false;

  bool get canProgram => programmer != null;

  /// iOS: the scan sheet is closed (it covers the registration form, times out, can be cancelled), so
  /// the screen offers "Scan a card" ([scan]).
  bool get needsScanButton => nfc.sessionBased && _active && !_listening && !_busy;

  String suggestedName(String k) => k == 'tag' ? 'Tag $_nextTag' : 'Card $_nextCard';

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// Enters the mode: pauses event delivery and starts reading ([listen] false: not yet, e.g. a card read
  /// on the Reader opens its form first).
  Future<void> start({bool listen = true}) async {
    if (_active) return;
    _active = true;
    await reader.pauseForProgramming();
    if (listen) await _listen();
    _notify();
  }

  /// iOS "Scan a card": opens the scan sheet again.
  Future<void> scan() async {
    if (!_active || _busy) return;
    await _listen();
    _notify();
  }

  /// Opens the sheet for a UID read before entering the mode (the reader's unknown-card result).
  void registerUid(String uid) {
    final known = _known[uid];
    if (known != null) {
      alreadyName = known.isEmpty ? null : known;
      phase = RegisterPhase.already;
    } else {
      pendingUid = uid;
      phase = RegisterPhase.sheet;
    }
    _notify();
  }

  /// Leaves the mode: stops reading and resumes normal delivery.
  Future<void> stop() async {
    if (!_active) return;
    _active = false;
    await _unlisten();
    await reader.resumeAfterProgramming();
  }

  /// App paused/resumed (reader mode only works in the foreground). The iOS sheet is not reopened.
  Future<void> onPaused() => _unlisten();
  Future<void> onResumed() async {
    if (_active && phase != RegisterPhase.writing && !nfc.sessionBased) await _listen();
  }

  Future<void> _listen() async {
    if (_listening) return;
    _listening = true;
    try {
      await nfc.startReading(
        onCard: (c) => unawaited(onTap(c)),
        onError: (e) => Log.e('register', 'read failed', e),
        onSessionEnd: () {
          if (!_listening) return;
          _listening = false;
          _notify();
        },
      );
    } catch (e) {
      _listening = false;
      notice = 'Could not start the NFC reader';
      phase = RegisterPhase.notice;
      _notify();
    }
  }

  Future<void> _unlisten() async {
    if (!_listening) return;
    _listening = false;
    await nfc.stopReading();
  }

  bool get _busy => phase == RegisterPhase.sheet || phase == RegisterPhase.saving || phase == RegisterPhase.writing;

  /// A tap while in the mode (never delivered as an event).
  Future<void> onTap(CardRead card) async {
    if (!_active || _busy) return;
    if (!_debouncer.accept(card.uid, card.detectedAt)) return;
    unawaited(_haptic());
    if (card.isDigitalCard) {
      notice = 'That\'s a phone sharing a digital card — only physical cards and tags can be registered.';
      phase = RegisterPhase.notice;
      if (nfc.sessionBased) unawaited(nfc.setSessionMessage('That\'s a phone, not a card.\nHold the next card.'));
      return _notify();
    }
    final known = _known[card.uid];
    if (known != null) {
      alreadyName = known.isEmpty ? null : known;
      phase = RegisterPhase.already;
      if (nfc.sessionBased) {
        unawaited(nfc.setSessionMessage('Already registered${known.isEmpty ? '' : ' as $known'}.\nHold the next card.'));
      }
      return _notify();
    }
    pendingUid = card.uid;
    phase = RegisterPhase.sheet;
    // iOS: the scan sheet would cover the registration form.
    if (nfc.sessionBased) await _unlisten();
    _notify();
  }

  /// The sheet was dismissed without registering.
  void cancelSheet() {
    if (phase != RegisterPhase.sheet) return;
    pendingUid = null;
    phase = RegisterPhase.waiting;
    _debouncer.reset(); // the same card may be tapped again right away
    _notify();
  }

  /// Registers [pendingUid]. Returns an error to show in the sheet, or null (done: success,
  /// already registered, or registered + written).
  Future<AppError?> submit({required String name, required String kind, required bool assignToBusiness, String? note}) async {
    final uid = pendingUid;
    if (uid == null) return null;
    this.kind = kind;
    this.assignToBusiness = assignToBusiness;
    phase = RegisterPhase.saving;
    _notify();
    final BusinessCardItem item;
    try {
      item = await api.registerBusinessCard(
        uid: uid,
        name: name.trim().isEmpty ? suggestedName(kind) : name.trim(),
        kind: kind,
        assignToBusiness: assignToBusiness,
        note: note,
      );
    } on ApiException catch (e) {
      if (e.code == 'card_uid_exists') {
        // The server names the existing card in the 409 details; older servers don't, so fall back to a lookup.
        final details = e.details;
        final named = details is Map && details['name'] is String ? details['name'] as String : null;
        final existing = named ?? await _lookupName(uid);
        _known[uid] = existing ?? '';
        alreadyName = existing;
        pendingUid = null;
        phase = RegisterPhase.already;
        _notify();
        return null;
      }
      phase = RegisterPhase.sheet;
      _notify();
      return registerCardError(e);
    } catch (e) {
      phase = RegisterPhase.sheet;
      _notify();
      return registerCardError(e);
    }
    if (kind == 'tag') {
      _nextTag++;
    } else {
      _nextCard++;
    }
    final entry = RegisteredCard(item: item, uid: uid);
    registered.insert(0, entry);
    _known[uid] = item.name;
    last = entry;
    pendingUid = null;
    unawaited(_haptic());
    if (writeLink && programmer != null) {
      await write(entry);
    } else {
      phase = RegisterPhase.success;
      _notify();
      // iOS: straight on to the next card (the user just saved this one).
      if (nfc.sessionBased && _active) {
        await _listen();
        unawaited(nfc.setSessionMessage('Registered · ${item.name} ✓\nHold the next card.'));
      }
    }
    return null;
  }

  /// Writes [entry]'s tap link: the same tap if the card is still there, else when it is held again.
  Future<void> write(RegisteredCard entry) async {
    final p = programmer;
    if (p == null) return;
    phase = RegisterPhase.writing;
    last = entry;
    _notify();
    await _unlisten();
    final out = await p.writeAndReport(entry.item, expectedUid: entry.uid, timeout: const Duration(seconds: 30));
    entry.programmed = out.ok;
    entry.writeError = out.error;
    phase = RegisterPhase.success;
    // iOS: after a failed write the error (and "Write the link again") must stay visible, not the sheet.
    if (_active && (out.ok || !nfc.sessionBased)) await _listen();
    _debouncer.reset();
    _notify();
  }

  /// Name of an already registered card: this session's list, else a unique `uid_masked` match.
  Future<String?> _lookupName(String uid) async {
    try {
      final masked = maskUid(uid);
      final hits = (await api.listBusinessCards()).where((c) => c.uidMasked == masked).toList();
      return hits.length == 1 ? hits.single.name : null;
    } catch (_) {
      return null;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
