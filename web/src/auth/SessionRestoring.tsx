import { useEffect, useState } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { useAuth } from './context'

/** Shown while the stored session is being restored; explains and retries transient failures. */
export function SessionRestoring() {
  const { restoreProblem, retryRestore, logout } = useAuth()
  const [left, setLeft] = useState(restoreProblem?.retryIn ?? 0)
  const [key, setKey] = useState(restoreProblem)
  if (restoreProblem !== key) {
    setKey(restoreProblem)
    setLeft(restoreProblem?.retryIn ?? 0)
  }
  useEffect(() => {
    if (!restoreProblem) return
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [restoreProblem])

  if (!restoreProblem) return <FullPageSpinner />
  return (
    <div className="flex min-h-screen items-center justify-center px-4" role="alert">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
          <WifiOff className="h-5 w-5" />
        </div>
        <p className="font-semibold">Reconnecting…</p>
        <p className="mt-1 text-[13px] text-muted">
          {restoreProblem.message} You&apos;re still signed in — retrying {left > 0 ? `in ${left}s` : 'now'}.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={retryRestore}>
            Retry now
          </Button>
          <Button variant="ghost" onClick={logout}>
            Sign out
          </Button>
        </div>
        {restoreProblem.attempt > 1 && <p className="mt-3 text-xs text-subtle">Attempt {restoreProblem.attempt}</p>}
      </div>
    </div>
  )
}
