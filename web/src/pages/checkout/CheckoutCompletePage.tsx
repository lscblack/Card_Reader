import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ArrowRight, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { billingApi, type CheckoutResult } from '@/api/billing'
import { errorMessage } from '@/api/client'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { money } from '@/lib/format'

/** Return page after paying: confirms the session with the API (which activates the plan) and celebrates. */
export default function CheckoutCompletePage() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id') ?? ''
  const qc = useQueryClient()
  const [result, setResult] = useState<CheckoutResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useDocumentTitle('Payment complete')

  useEffect(() => {
    if (!sessionId) return
    let stop = false
    let tries = 0
    // A payment can take a moment to settle (e.g. after 3-D Secure): poll briefly while it's still open.
    const check = async () => {
      try {
        const r = await billingApi.result(sessionId)
        if (stop) return
        setResult(r)
        if (r.status === 'complete') {
          qc.invalidateQueries()
        } else if (r.status === 'open' && ++tries < 10) {
          setTimeout(check, 1500)
        }
      } catch (e) {
        if (!stop) setError(errorMessage(e))
      }
    }
    check()
    return () => {
      stop = true
    }
  }, [sessionId, qc])

  const done = result?.status === 'complete'
  const failed = !!error || !sessionId || result?.status === 'expired'
  const back = result?.billing_link ?? '/'

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-bg px-4 py-16">
      <div aria-hidden className="pointer-events-none absolute top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-accent-solid/10 blur-3xl" />
      <Logo className="relative mb-10" />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative w-full max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-sm"
      >
        {failed ? (
          <>
            <XCircle className="mx-auto h-14 w-14 text-red-500" />
            <h1 className="mt-4 text-xl font-semibold tracking-tight">We couldn’t confirm this payment</h1>
            <p className="mt-2 text-[14px] text-muted">{error ?? 'This checkout has expired. No money was taken — you can start again from your billing page.'}</p>
          </>
        ) : !result ? (
          <div className="py-8">
            <Spinner />
            <p className="mt-4 text-[14px] text-muted">Confirming your payment…</p>
          </div>
        ) : done ? (
          <>
            <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }}>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-8 ring-emerald-500/5">
                <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
              </div>
            </motion.div>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">You’re on {result.plan_name}!</h1>
            <p className="mt-2 text-[14px] text-muted">Your payment went through and your new limits are active right away. A receipt is on its way to your inbox.</p>
            <dl className="mt-6 space-y-2 rounded-2xl bg-surface-2 p-4 text-left text-[14px]">
              <div className="flex justify-between">
                <dt className="text-muted">Plan</dt>
                <dd className="font-medium">{result.plan_name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Billing</dt>
                <dd className="font-medium tabular-nums">
                  {money(result.amount_cents, result.currency)} / {result.interval}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <Clock className="mx-auto h-14 w-14 text-amber-500" />
            <h1 className="mt-4 text-xl font-semibold tracking-tight">Payment processing</h1>
            <p className="mt-2 text-[14px] text-muted">Your bank is still confirming the payment. Your plan switches as soon as it’s through — you can leave this page.</p>
          </>
        )}
        {(failed || result) && (
          <Link to={back} className="mt-6 block">
            <Button variant="primary" size="lg" className="w-full" rightIcon={<ArrowRight className="h-4 w-4" />}>
              {done ? 'Go to billing' : 'Back to billing'}
            </Button>
          </Link>
        )}
      </motion.div>
    </div>
  )
}
