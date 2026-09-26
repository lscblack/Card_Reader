import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Building2, CheckCircle2, Clock } from 'lucide-react'
import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/context'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Skeleton } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { dateTime } from '@/lib/format'
import { useMutation } from '@tanstack/react-query'
import { inviteApi } from '../api/team'
import { businessApi } from '../api/business'
import { bk } from '../hooks/queries'
import { formatError } from '../lib/errors'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../lib/permissions'
import { ErrorMeta } from '../components/BizError'

/** `/invite/:token` — public invitation info; accept when signed in with the invited email, or register. */
export default function InviteAcceptPage() {
  const { token = '' } = useParams()
  const { user, status, logout } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  useDocumentTitle('Join a business')
  const inv = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => inviteApi.get(token),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
  })
  const accept = useMutation({
    mutationFn: () => inviteApi.accept(token),
    onSuccess: async () => {
      // The accept response is the new membership (no business id): find the business just joined by name.
      const list = await qc.fetchQuery({ queryKey: bk.list, queryFn: businessApi.list, staleTime: 0 }).catch(() => [])
      const joined = list.filter((b) => b.name === inv.data?.business_name)
      toast.success(`Welcome to ${inv.data?.business_name ?? 'the team'}!`)
      navigate(joined.length === 1 ? `/business/${joined[0].id}` : '/business', { replace: true })
    },
  })
  const next = encodeURIComponent(`/invite/${token}`)
  const d = inv.data
  const emailMatches = !!user && !!d && user.email.toLowerCase() === d.email.toLowerCase()
  const mismatch = accept.error instanceof ApiError && accept.error.code === 'invitation_email_mismatch'

  let body
  if (inv.isLoading || status === 'loading') {
    body = (
      <div className="space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-4 h-10 w-full" />
      </div>
    )
  } else if (inv.error || !d) {
    body = (
      <div className="text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <p className="mt-3 text-[15px] font-semibold">This invitation link isn’t valid</p>
        <p className="mt-1 text-[13px] text-muted">It may have been mistyped or revoked. Ask the person who invited you to send a new one.</p>
        <ErrorMeta error={inv.error} className="mt-2" />
      </div>
    )
  } else if (d.status !== 'pending') {
    body = (
      <div className="text-center">
        {d.status === 'accepted' ? <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" /> : <Clock className="mx-auto h-8 w-8 text-subtle" />}
        <p className="mt-3 text-[15px] font-semibold">
          {d.status === 'accepted' ? 'This invitation was already accepted' : d.status === 'expired' ? 'This invitation has expired' : 'This invitation was revoked'}
        </p>
        <p className="mt-1 text-[13px] text-muted">
          {d.status === 'accepted' ? 'Sign in to open the business dashboard.' : `Ask ${d.business_name} to send you a new invitation.`}
        </p>
        {d.status === 'accepted' && (
          <Link to={user ? '/business' : `/login?next=${encodeURIComponent('/business')}`} className="mt-4 inline-block">
            <Button variant="primary">{user ? 'Open dashboard' : 'Sign in'}</Button>
          </Link>
        )}
      </div>
    )
  } else {
    body = (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/60 p-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 text-[13px]">
            <p className="text-[15px] font-semibold text-fg">{d.business_name}</p>
            <p className="text-muted">
              Role: <span className="font-medium text-fg">{ROLE_LABELS[d.role] ?? d.role}</span> — {ROLE_DESCRIPTIONS[d.role]}
            </p>
            <p className="mt-1 text-subtle">
              For <span className="font-medium">{d.email}</span> · expires {dateTime(d.expires_at)}
            </p>
          </div>
        </div>
        {accept.error != null && !mismatch && <Alert tone="danger">{formatError(accept.error)}</Alert>}
        {status === 'authenticated' && user ? (
          emailMatches && !mismatch ? (
            <Button variant="primary" className="w-full" size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>
              Accept & join {d.business_name}
            </Button>
          ) : (
            <div className="space-y-3">
              <Alert tone="warning" title="Different account">
                You’re signed in as <strong>{user.email}</strong>, but this invitation is for <strong>{d.email}</strong>. Sign in with the invited email to accept.
              </Alert>
              <Button className="w-full" onClick={logout}>
                Sign out and switch account
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-2">
            <Link to={`/register?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(d.email)}`} className="block">
              <Button variant="primary" className="w-full" size="lg">
                Create an account & join
              </Button>
            </Link>
            <Link to={`/login?next=${next}`} className="block">
              <Button className="w-full" size="lg">
                I already have an account
              </Button>
            </Link>
          </div>
        )}
      </div>
    )
  }

  return (
    <AuthLayout title="You’re invited" subtitle={d && d.status === 'pending' ? `Join ${d.business_name} on NFC Platform` : undefined}>
      {body}
    </AuthLayout>
  )
}
