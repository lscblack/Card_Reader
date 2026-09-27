import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/app_error.dart';
import '../../data/models/personal.dart';
import '../../services/personal_state.dart';
import '../theme.dart';
import '../widgets/error_ref.dart';

/// 6-digit code input (numeric keyboard, SMS/email one-time-code autofill); calls [onCompleted] at 6 digits.
class OtpField extends StatelessWidget {
  const OtpField({super.key, required this.controller, required this.onCompleted, this.enabled = true});

  final TextEditingController controller;
  final ValueChanged<String> onCompleted;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      autofocus: true,
      keyboardType: TextInputType.number,
      autofillHints: const [AutofillHints.oneTimeCode],
      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
      textAlign: TextAlign.center,
      style: Theme.of(context).textTheme.headlineSmall?.copyWith(letterSpacing: 10, fontWeight: FontWeight.w600),
      decoration: const InputDecoration(hintText: '••••••', counterText: ''),
      onChanged: (v) {
        if (v.length == 6) onCompleted(v);
      },
    );
  }
}

/// "Resend code" with a cooldown (the code was just sent when this appears).
class ResendCodeButton extends StatefulWidget {
  const ResendCodeButton({super.key, required this.onResend, this.cooldown = const Duration(seconds: 30)});

  /// Returns true when a new code was sent (restarts the cooldown).
  final Future<bool> Function() onResend;
  final Duration cooldown;

  @override
  State<ResendCodeButton> createState() => _ResendCodeButtonState();
}

class _ResendCodeButtonState extends State<ResendCodeButton> {
  Timer? _timer;
  int _left = 0;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  void _start() {
    _timer?.cancel();
    _left = widget.cooldown.inSeconds;
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _left--);
      if (_left <= 0) t.cancel();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      key: const Key('resendCode'),
      onPressed: _left > 0 || _busy
          ? null
          : () async {
              setState(() => _busy = true);
              final ok = await widget.onResend();
              if (!mounted) return;
              setState(() {
                _busy = false;
                if (ok) _start();
              });
            },
      icon: const Icon(Icons.refresh, size: 18),
      label: Text(_left > 0 ? 'Resend code in ${_left}s' : 'Resend code'),
    );
  }
}

/// Second sign-in step: the emailed code (passwordless or required on password sign-in) and/or the
/// "this signs out your other phone" warning. Reads the pending step from [PersonalState].
class SignInCodeStep extends StatefulWidget {
  const SignInCodeStep({super.key, required this.onSignedIn, required this.onRestart});

  final VoidCallback onSignedIn;

  /// The step ended (expired / too many tries): back to the first screen with this message.
  final ValueChanged<AppError> onRestart;

  @override
  State<SignInCodeStep> createState() => _SignInCodeStepState();
}

class _SignInCodeStepState extends State<SignInCodeStep> {
  final _code = TextEditingController();
  bool _busy = false;
  AppError? _error;
  String? _info;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final p = context.read<PersonalState>();
    final c = p.challenge;
    final needsCode = c == null || c.otpRequired;
    if (_busy || (needsCode && _code.text.length != 6)) return;
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    final err = c != null ? await p.confirmSignIn(code: needsCode ? _code.text : null) : await p.signInWithEmailCode(_code.text);
    if (!mounted) return;
    if (err == null) {
      if (p.signedIn) return widget.onSignedIn();
      setState(() => _busy = false); // one more step (confirmation)
      return;
    }
    if (p.challenge == null && p.emailCode == null) return widget.onRestart(err);
    setState(() {
      _busy = false;
      _error = err;
      _code.clear();
    });
  }

  Future<bool> _resend() async {
    final err = await context.read<PersonalState>().resendSignInCode();
    if (!mounted) return false;
    final p = context.read<PersonalState>();
    if (err != null && p.challenge == null && p.emailCode == null) {
      widget.onRestart(err);
      return false;
    }
    setState(() {
      _error = err;
      _info = err == null ? 'A new code is on its way.' : null;
    });
    return err == null;
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<PersonalState>();
    final t = Theme.of(context).textTheme;
    final SignInChallenge? c = p.challenge;
    final EmailCodeChallenge? ec = p.emailCode;
    final needsCode = c == null || c.otpRequired;
    final sentTo = c?.otpSentTo ?? ec?.sentTo;
    final devCode = c?.devCode ?? ec?.devCode;
    final existing = c?.existingSession;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(needsCode ? Icons.mark_email_read_outlined : Icons.phonelink_lock_outlined,
            size: 48, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 12),
        Text(needsCode ? 'Enter your sign-in code' : 'Confirm sign-in',
            style: t.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        if (needsCode) ...[
          Text(
            sentTo == null || sentTo.isEmpty ? 'We emailed you a 6-digit code.' : 'We emailed a code to $sentTo',
            key: const Key('codeSentTo'),
            style: t.bodyMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          OtpField(key: const Key('otpField'), controller: _code, enabled: !_busy, onCompleted: (_) => _submit()),
          if (kDebugMode && devCode != null) ...[
            const SizedBox(height: 6),
            Text('Dev code: $devCode', key: const Key('devCode'), style: t.labelSmall, textAlign: TextAlign.center),
          ],
          Align(child: ResendCodeButton(onResend: _resend)),
        ],
        if (existing != null) ...[
          const SizedBox(height: 8),
          Container(
            key: const Key('replaceWarning'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: StatusColors.warning(context).withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.warning_amber_rounded, color: StatusColors.warning(context)),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('Continuing will sign you out of ${existing.deviceName ?? 'your other phone'}. '
                      'Your account can be signed in on one phone at a time.'),
                ),
              ],
            ),
          ),
        ],
        if (_info != null) ...[const SizedBox(height: 8), Text(_info!, style: t.bodySmall, textAlign: TextAlign.center)],
        if (_error != null) ...[const SizedBox(height: 12), ErrorMessage(_error!, key: const Key('codeError'))],
        const SizedBox(height: 20),
        FilledButton(
          key: const Key('confirmSignIn'),
          onPressed: _busy ? null : _submit,
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          child: Text(_busy ? 'Please wait…' : (existing != null ? 'Continue' : 'Sign in')),
        ),
        const SizedBox(height: 8),
        TextButton(
          key: const Key('cancelSignInStep'),
          onPressed: _busy ? null : p.cancelSignIn,
          child: const Text('Back'),
        ),
      ],
    );
  }
}
