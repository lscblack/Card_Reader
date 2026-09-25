import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CheckCircle2, MailWarning } from 'lucide-react'
import { authApi, homePathFor } from '@/api/auth'
import { useAuth } from '@/auth/context'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/Button'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

type State = { kind: 'verifying' } | { kind: 'done' } | { kind: 'error'; error: unknown } | { kind: 'missing' }

export default function VerifyEmailPage() {
  useDocumentTitle('Verify email')
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { status, user, refreshUser, setDevVerificationUrl } = useAuth()
  const toast = useToast()
  const [state, setState] = useState<State>(() => (token ? { kind: 'verifying' } : { kind: 'missing' }))
  const [resending, setResending] = useState(false)
  // Tokens are single-use: guard against React StrictMode's double effect run.
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    authApi
      .verifyEmail(token)
      .then(async () => {
        setState({ kind: 'done' })
        setDevVerificationUrl(null)
        if (status !== 'anonymous') await refreshUser().catch(() => undefined)
      })
      .catch((error: unknown) => setState({ kind: 'error', error }))
  }, [token, status, refreshUser, setDevVerificationUrl])

  async function resend() {
    setResending(true)
    try {
      const res = await authApi.resendVerification()
      if (res?.dev_verification_url) setDevVerificationUrl(res.dev_verification_url)
      toast.success('A new verification link is on its way.')
    } catch (e) {
      toast.fromError(e)
    } finally {
      setResending(false)
    }
  }

  const home = status === 'authenticated' ? homePathFor(user) : '/login'

  return (
    <AuthLayout title="Email verification">
      {state.kind === 'verifying' && (
        <div className="flex flex-col items-center gap-3 py-6 text-muted" role="status">
          <Spinner className="h-6 w-6" /> Verifying your email…
        </div>
      )}
      {state.kind === 'done' && (
        <div className="flex flex-col items-center py-4 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <p className="font-semibold">Your email is verified</p>
          <p className="mt-1 text-[13px] text-muted">Thanks — your account is fully set up.</p>
          <Link to={home} className="mt-5 w-full">
            <span className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent-solid text-sm font-medium text-accent-fg hover:bg-accent-solid-hover">
              {status === 'authenticated' ? 'Continue' : 'Sign in'}
            </span>
          </Link>
        </div>
      )}
      {(state.kind === 'error' || state.kind === 'missing') && (
        <div className="space-y-4">
          {state.kind === 'error' ? (
            <ErrorAlert error={state.error} title="This link can’t be used" />
          ) : (
            <div className="flex gap-2.5 text-[13px] text-muted">
              <MailWarning className="h-5 w-5 shrink-0 text-amber-500" />
              This verification link is missing its token.
            </div>
          )}
          <p className="text-[13px] text-muted">Verification links are single-use and expire after 48 hours.</p>
          {status === 'authenticated' ? (
            <Button variant="primary" className="w-full" loading={resending} onClick={resend}>
              Send a new link
            </Button>
          ) : (
            <p className="text-[13px] text-muted">
              <Link to={`/login?next=${encodeURIComponent('/verify-email')}`} className="font-medium text-accent hover:underline">
                Sign in
              </Link>{' '}
              to request a new link.
            </p>
          )}
        </div>
      )}
    </AuthLayout>
  )
}
