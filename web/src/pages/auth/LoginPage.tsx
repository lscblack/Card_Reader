import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, Fingerprint, KeyRound, Mail } from 'lucide-react'
import { startAuthentication } from '@simplewebauthn/browser'
import { useAuth } from '@/auth/context'
import { authApi } from '@/api/auth'
import { ApiError, errorMessage, USE_MOCKS } from '@/api/client'
import type { LoginConfirm, LoginOut } from '@/api/types'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Field, Input, PasswordInput } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { CodeInput } from '@/components/auth/CodeInput'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { relativeTime } from '@/lib/format'
import { passkeyErrorMessage, passkeySupport } from '@/lib/passkeys'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESEND_COOLDOWN = 30

/** The second screen of a sign-in: an emailed code (password or email-code sign-in) or a "sign out the other browser" confirmation. */
type Step =
  | { kind: 'confirm'; data: LoginConfirm }
  | { kind: 'email-code'; challengeId: string; sentTo: string; devCode?: string | null }

function useCooldown(): [number, () => void] {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return [left, () => setLeft(RESEND_COOLDOWN)]
}

function loginErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'invalid_credentials') return 'Incorrect email or password.'
    if (err.code === 'account_disabled') return 'This account has been deactivated. Contact support if you think this is a mistake.'
    if (err.code === 'invalid_login_code') return 'That code isn’t right. Check the latest email and try again.'
    if (err.code === 'passkey_unknown') return 'This passkey isn’t linked to an account here. Sign in another way, then add it in Settings.'
    if (err.code === 'passkey_invalid') return 'The passkey couldn’t be verified. Try again.'
  }
  return errorMessage(err)
}

function Divider() {
  return (
    <div className="flex items-center gap-3 py-1 text-[12px] text-subtle" role="separator">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function DevCode({ code }: { code?: string | null }) {
  if (!import.meta.env.DEV || !code) return null
  return (
    <p className="text-center text-xs text-subtle">
      Dev code: <span className="font-mono font-medium text-fg">{code}</span>
    </p>
  )
}

export default function LoginPage() {
  useDocumentTitle('Sign in')
  const { login, completeLogin } = useAuth()
  const [params] = useSearchParams()
  const [email, setEmail] = useState(USE_MOCKS ? 'dev@example.com' : '')
  const [password, setPassword] = useState(USE_MOCKS ? 'password1234' : '')
  const [mode, setMode] = useState<'password' | 'email'>('password')
  const [step, setStep] = useState<Step | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState<'password' | 'email' | 'passkey' | 'verify' | 'resend' | null>(null)
  const [cooldown, startCooldown] = useCooldown()
  const passkeys = passkeySupport()
  const resetDone = params.get('reset') === '1'
  const reason = params.get('reason')

  function restart(message: string | null) {
    setStep(null)
    setCode('')
    setLoading(null)
    setError(message)
  }

  /** Any sign-in answer: `ok` → signed in (<GuestOnly> redirects), `confirm` → show the second step. */
  function handle(res: LoginOut) {
    const confirm = completeLogin(res)
    if (!confirm) return
    setStep({ kind: 'confirm', data: confirm })
    setCode('')
    setLoading(null)
    if (confirm.otp_required) startCooldown()
  }

  function fail(err: unknown) {
    setLoading(null)
    if (err instanceof ApiError && err.code === 'login_challenge_expired') return restart('This sign-in step expired. Please sign in again.')
    if (err instanceof ApiError && err.code === 'too_many_attempts') return restart('Too many wrong codes. Sign in again to get a new code.')
    if (err instanceof ApiError && err.code === 'invalid_login_code') setCode('')
    setError(loginErrorText(err))
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading('password')
    try {
      const confirm = await login({ email: email.trim(), password })
      if (confirm) handle(confirm)
    } catch (err) {
      fail(err)
    }
  }

  async function sendEmailCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    setNotice(null)
    if (!EMAIL.test(email.trim())) return setError('Enter the email address of your account.')
    setLoading(step ? 'resend' : 'email')
    try {
      const res = await authApi.emailCode(email.trim())
      setStep({ kind: 'email-code', challengeId: res.challenge_id, sentTo: res.sent_to, devCode: res.dev_code })
      setCode('')
      startCooldown()
      if (step) setNotice('We sent a new code.')
    } catch (err) {
      setError(loginErrorText(err))
    } finally {
      setLoading(null)
    }
  }

  async function onPasskey() {
    setError(null)
    setNotice(null)
    setLoading('passkey')
    try {
      const { challenge_id, options } = await authApi.passkeyLoginOptions()
      const credential = await startAuthentication({ optionsJSON: options })
      handle(await authApi.passkeyLoginVerify(challenge_id, credential))
    } catch (err) {
      setLoading(null)
      if (err instanceof ApiError) return fail(err)
      const msg = passkeyErrorMessage(err)
      if (msg) setError(msg)
    }
  }

  async function verify(value = code) {
    if (!step) return
    setError(null)
    setNotice(null)
    setLoading('verify')
    try {
      if (step.kind === 'email-code') handle(await authApi.emailCodeVerify(step.challengeId, value))
      else handle(await authApi.loginConfirm(step.data.challenge_id, step.data.otp_required ? value : undefined))
    } catch (err) {
      fail(err)
    }
  }

  async function resend() {
    if (!step) return
    if (step.kind === 'email-code') return sendEmailCode()
    setError(null)
    setLoading('resend')
    try {
      const res = await authApi.loginResend(step.data.challenge_id)
      setStep({ kind: 'confirm', data: { ...step.data, dev_code: res.dev_code ?? null } })
      setCode('')
      setNotice('We sent a new code.')
      startCooldown()
    } catch (err) {
      fail(err)
    } finally {
      setLoading((l) => (l === 'resend' ? null : l))
    }
  }

  // ---------- Step 2: code and/or confirmation ----------
  if (step) {
    const needsCode = step.kind === 'email-code' || step.data.otp_required
    const existing = step.kind === 'confirm' ? step.data.existing_session : null
    const sentTo = step.kind === 'email-code' ? step.sentTo : step.data.otp_sent_to
    const devCode = step.kind === 'email-code' ? step.devCode : step.data.dev_code
    return (
      <AuthLayout
        title={needsCode ? 'Check your email' : 'Confirm sign-in'}
        subtitle={needsCode ? `We emailed a 6-digit code to ${sentTo ?? email}.` : 'One more step before you continue.'}
      >
        <button type="button" onClick={() => restart(null)} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Use a different account
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
          className="space-y-4"
          noValidate
        >
          {error && <Alert tone="danger">{error}</Alert>}
          {notice && !error && <Alert tone="success">{notice}</Alert>}
          {needsCode && (
            <Field label="Sign-in code" hint="The code expires in 10 minutes.">
              {(p) => <CodeInput {...p} value={code} onChange={setCode} onComplete={(c) => loading !== 'verify' && void verify(c)} disabled={loading === 'verify'} />}
            </Field>
          )}
          {existing && (
            <Alert tone="warning" title="You’ll be signed out elsewhere">
              Continuing will sign you out of <span className="font-medium">{existing.device_name}</span> (last active{' '}
              {relativeTime(existing.last_seen_at)}). Each account can be signed in on one browser at a time.
            </Alert>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading === 'verify'} disabled={needsCode && code.length !== 6}>
            {needsCode ? 'Verify and continue' : 'Continue'}
          </Button>
          {needsCode && (
            <p className="text-center text-[13px] text-muted">
              Didn&apos;t get it?{' '}
              {cooldown > 0 ? (
                <span className="text-subtle tabular-nums">Resend in {cooldown}s</span>
              ) : (
                <button type="button" onClick={() => void resend()} disabled={loading === 'resend'} className="font-medium text-accent hover:underline disabled:opacity-60">
                  {loading === 'resend' ? 'Sending…' : 'Resend code'}
                </button>
              )}
            </p>
          )}
          <DevCode code={devCode} />
        </form>
      </AuthLayout>
    )
  }

  const footer = (
    <>
      No account?{' '}
      <Link to="/register" className="font-medium text-accent hover:underline">
        Create one — it&apos;s free
      </Link>
    </>
  )

  const otherOptions = (
    <div className="space-y-2.5">
      <Divider />
      {mode === 'password' ? (
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          leftIcon={<Mail className="h-4 w-4" />}
          onClick={() => {
            setError(null)
            setMode('email')
          }}
        >
          Email me a sign-in code
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          leftIcon={<KeyRound className="h-4 w-4" />}
          onClick={() => {
            setError(null)
            setMode('password')
          }}
        >
          Sign in with a password
        </Button>
      )}
      {passkeys === 'ok' && (
        <Button variant="secondary" size="lg" className="w-full" leftIcon={<Fingerprint className="h-4 w-4" />} loading={loading === 'passkey'} onClick={() => void onPasskey()}>
          Sign in with a passkey
        </Button>
      )}
      {passkeys === 'insecure' && <p className="text-center text-xs text-subtle">Passkeys need https.</p>}
    </div>
  )

  // ---------- Step 1 ----------
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to manage your NFC applications" footer={footer}>
      {reason === 'replaced' && (
        <Alert tone="warning" title="Signed out">
          You were signed out because your account signed in on another browser.
        </Alert>
      )}
      {reason === 'revoked' && <Alert tone="warning">Your session ended. Please sign in again.</Alert>}
      {mode === 'password' ? (
        <form onSubmit={onPassword} className="space-y-4" noValidate>
          {resetDone && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email">
            {(p) => (
              <Input {...p} inputSize="lg" type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            )}
          </Field>
          <div className="space-y-1.5">
            <Field label="Password">
              {(p) => (
                <PasswordInput {...p} inputSize="lg" placeholder="Enter your password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
            <div className="text-right">
              <Link to="/forgot-password" className="text-[12.5px] text-muted hover:text-accent">
                Forgot password?
              </Link>
            </div>
          </div>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading === 'password'} disabled={!email || !password}>
            Sign in
          </Button>
          {USE_MOCKS && (
            <p className="text-center text-xs text-subtle">
              Mock mode: any 10+ char password. Emails containing “admin” open the admin console, “business” a business account, “personal” a personal account.
            </p>
          )}
        </form>
      ) : (
        <form onSubmit={sendEmailCode} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email" hint="We’ll email you a 6-digit code — no password needed.">
            {(p) => (
              <Input {...p} inputSize="lg" type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading === 'email'} disabled={!email}>
            Send me a code
          </Button>
        </form>
      )}
      {otherOptions}
    </AuthLayout>
  )
}
