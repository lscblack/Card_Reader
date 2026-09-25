import '../core/app_error.dart';
import '../core/error_catalog.dart';
import '../data/api_client.dart';
import '../data/models/api_models.dart';
import '../data/models/business.dart';
import 'nfc_writer.dart';
import 'reader_controller.dart';

class ProgramOutcome {
  const ProgramOutcome.success(this.uid) : error = null;
  const ProgramOutcome.failure(this.error, {this.uid});

  final String? uid;
  final AppError? error;
  bool get ok => error == null;
}

/// Programs a business card: pause reader → write tap_url → report programmed → resume.
class CardProgrammer {
  CardProgrammer({required this.writer, required this.api, required this.reader});

  final NfcWriter writer;
  final DeviceApi api;
  final ReaderController reader;

  Future<ProgramOutcome> program(BusinessCardItem card, {Duration timeout = const Duration(seconds: 60)}) async {
    if (card.tapUrl.isEmpty) {
      return const ProgramOutcome.failure(AppError('This card has no tap URL yet.', ref: 'MOB-1018'));
    }
    await reader.pauseForProgramming();
    String? uid;
    try {
      uid = await writer.writeUri(card.tapUrl, timeout: timeout);
      await api.markCardProgrammed(cardId: card.id, uid: uid);
      return ProgramOutcome.success(uid);
    } on NfcWriteException catch (e) {
      return ProgramOutcome.failure(AppError.mob(e.error, '${e.error.title}. ${e.error.fix}'), uid: uid);
    } on ApiException catch (e) {
      final msg = switch (e.code) {
        'card_uid_exists' =>
          'The link was written, but this card is already registered as another card in your business.',
        'card_uid_mismatch' =>
          'The link was written, but this entry is already bound to a different physical card.',
        'device_capability_missing' => 'This device is no longer allowed to program cards.',
        _ => 'The link was written, but the server did not confirm: ${e.message}',
      };
      return ProgramOutcome.failure(AppError.api(e, msg), uid: uid);
    } on NetworkException catch (e) {
      return ProgramOutcome.failure(
        AppError.network(e, 'The link was written, but the server could not be reached: '),
        uid: uid,
      );
    } finally {
      await reader.resumeAfterProgramming();
    }
  }

  Future<void> cancel() => writer.cancel();
}

/// Maps a card-registration failure to a user message.
AppError registerCardError(Object e) => switch (e) {
  ApiException(code: 'card_uid_exists') =>
    AppError.api(e, 'This card is already registered in your business.'),
  ApiException(code: 'insufficient_permissions' || 'device_capability_missing' || 'device_not_business') =>
    AppError.api(e, 'This device is not allowed to register cards.'),
  ApiException() => AppError.api(e),
  NetworkException() => AppError.network(e, 'Server unreachable: '),
  _ => AppError.mob(MobError.invalidServerResponse),
};
