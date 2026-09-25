import '../data/models/api_models.dart';
import 'error_catalog.dart';

/// A user-facing failure with its stable reference (`NFC-*` from the API or a
/// local `MOB-*`) and the server request id when there is one.
class AppError {
  const AppError(this.message, {this.ref, this.requestId, this.code});

  final String message;
  final String? ref;
  final String? requestId;
  final String? code;

  factory AppError.api(ApiException e, [String? message]) =>
      AppError(message ?? e.message, ref: e.ref, requestId: e.requestId, code: e.code);

  factory AppError.mob(MobError m, [String? message]) => AppError(message ?? m.title, ref: m.ref, code: m.code);

  factory AppError.network(NetworkException e, [String? prefix]) =>
      AppError('${prefix ?? ''}${e.message}', ref: e.ref, code: e.mob.code);

  /// "NFC-1003 · 3f9c…" (what the UI shows under a failure).
  String? get referenceLine => [?ref, ?requestId].join(' · ').ifNotEmpty;

  @override
  String toString() => referenceLine == null ? message : '$message ($referenceLine)';
}

extension on String {
  String? get ifNotEmpty => isEmpty ? null : this;
}
