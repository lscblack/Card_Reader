import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../data/models/api_models.dart';
import '../../data/models/personal.dart';
import '../../services/personal_state.dart';
import '../digital_card/any_card_view.dart';
import '../digital_card/card_view.dart';
import '../theme.dart';
import '../widgets/error_ref.dart';
import '../widgets/motion.dart';
import 'contact_detail_screen.dart';

/// Maps an exchange failure to a user message.
AppError exchangeError(Object e) => switch (e) {
  ApiException(code: 'self_exchange') => AppError.api(e, 'That\'s your own card.'),
  ApiException(code: 'card_token_expired') => AppError.api(e, 'The card code expired. Ask them to tap again.'),
  ApiException(code: 'invalid_card_token') => AppError.api(e, 'This card code isn\'t valid.'),
  ApiException(code: 'card_unavailable') => AppError.api(e, 'This card is no longer shared.'),
  ApiException() => AppError.api(e),
  NetworkException() => AppError.network(e, 'Offline — can\'t exchange right now: '),
  _ => AppError(e.toString()),
};

/// POST /personal/exchanges then show the success sheet. Returns the result or null.
Future<ExchangeResult?> runExchange(BuildContext context, String token, {String? via}) async {
  final p = context.read<PersonalState>();
  final api = p.api;
  if (api == null) return null;
  try {
    final r = await api.exchange(token, via: via);
    if (context.mounted) await showExchangeResult(context, r, p);
    return r;
  } catch (e) {
    if (context.mounted) {
      final err = exchangeError(e);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text([err.message, ?err.referenceLine].join('\n')),
      ));
    }
    return null;
  }
}

Future<void> showExchangeResult(BuildContext context, ExchangeResult r, PersonalState p) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (c) => ExchangeResultSheet(result: r, layout: r.contact.templateLayout ?? p.templateFor(r.contact.card.templateId).layout,
      template: p.templateFor(r.contact.card.templateId)),
);

class ExchangeResultSheet extends StatelessWidget {
  const ExchangeResultSheet({super.key, required this.result, required this.layout, this.template});
  final ExchangeResult result;
  final String layout;

  /// Their template (v2 shape templates render with the v2 engine).
  final CardTemplate? template;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final ok = StatusColors.success(context);
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (context, controller) => ListView(
        key: const Key('exchangeResult'),
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        children: [
          Row(children: [
            SuccessCheck(size: 40, color: ok),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                result.alreadyConnected ? 'Contact updated' : 'Card received',
                style: t.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
          ]),
          const SizedBox(height: 6),
          Row(children: [
            Icon(result.mutual ? Icons.sync_alt : Icons.arrow_forward, size: 16, color: result.mutual ? ok : null),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                result.mutual ? 'Mutual ✓ — they received your card too' : 'One-way — they only share their public card',
                key: const Key('exchangeMutual'),
                style: t.bodyMedium?.copyWith(color: result.mutual ? ok : null),
              ),
            ),
          ]),
          const SizedBox(height: 16),
          template?.isV2 ?? false
              ? AnyCardView(card: result.contact.card, template: template!, hideHiddenFields: false)
              : DigitalCardView(card: result.contact.card, layout: layout, hideHiddenFields: false),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () {
              Navigator.of(context).pop();
              Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => ContactDetailScreen(contact: result.contact),
              ));
            },
            icon: const Icon(Icons.person_outline),
            label: const Text('Open contact'),
          ),
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
        ],
      ),
    );
  }
}

/// Small error box used by personal screens.
class InlineError extends StatelessWidget {
  const InlineError(this.error, {super.key});
  final AppError? error;

  @override
  Widget build(BuildContext context) =>
      error == null ? const SizedBox.shrink() : Padding(padding: const EdgeInsets.all(12), child: ErrorMessage(error!));
}
