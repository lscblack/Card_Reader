import { useState } from 'react'
import { MailWarning, X } from 'lucide-react'
import { authApi } from '@/api/auth'
import { useAuth } from '@/auth/context'
import { Button } from './ui/Button'
import { useToast } from './ui/toastContext'

/** Non-blocking "verify your email" banner (Part 2 §A3). Shows a dev link when the server returns one. */
export function VerifyEmailBanner() {
  const { user, devVerificationUrl, setDevVerificationUrl } = useAuth()
  const toast = useToast()
  const [dismissed, setDismissed] = useState(false)
  const [sending, setSending] = useState(false)

  if (!user || user.email_verified !== false || dismissed) return null
  const business = user.account_type === 'business'

  async function resend() {
    setSending(true)
    try {
      const res = await authApi.resendVerification()
      if (res?.dev_verification_url) setDevVerificationUrl(res.dev_verification_url)
      toast.success(`We sent a new verification link to ${user!.email}.`)
    } catch (e) {
      toast.fromError(e, 'Could not resend')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 sm:flex-row sm:items-center dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
      role="status"
    >
      <MailWarning className="hidden h-5 w-5 shrink-0 sm:block" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Verify your email address</p>
        <p className="opacity-90">
          We sent a link to <span className="font-medium">{user.email}</span>.{' '}
          {business
            ? 'Until it’s verified, your public profile and tap pages show a neutral “not verified yet” page.'
            : 'Everything keeps working in the meantime.'}
        </p>
        {devVerificationUrl && (
          <p className="mt-1 break-all">
            Dev link:{' '}
            <a href={devVerificationUrl} className="font-medium underline">
              {devVerificationUrl}
            </a>
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={resend} loading={sending}>
          Resend link
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
