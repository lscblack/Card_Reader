import { useState } from 'react'
import { Building2, Check, MailWarning, X } from 'lucide-react'
import { authApi } from '@/api/auth'
import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { relativeTime } from '@/lib/format'
import { BizErrorState } from '@/business/components/BizError'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import { useNavigate } from 'react-router'
import type { BusinessInvite } from '../api/types'
import { invitesApi } from '../api/personal'
import { useInvites, usePCards, usePMutation } from '../hooks/queries'
import { DEFAULT_DESIGN } from '../lib/design'
import { CardThumb } from '../components/DigitalCardRender'

function InviteCard({ inv }: { inv: BusinessInvite }) {
  const toast = useToast()
  const onError = useErrorToast()
  const navigate = useNavigate()
  const cards = usePCards()
  const me = cards.data?.find((c) => c.is_primary) ?? cards.data?.[0]
  const accept = usePMutation(() => invitesApi.accept(inv.id))
  const decline = usePMutation(() => invitesApi.decline(inv.id))
  const pending = inv.status === 'pending'
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        <div className="bg-surface-2/60 p-4">
          <CardThumb
            layout="centered"
            card={{ design: DEFAULT_DESIGN, fields: { ...(me?.fields ?? { full_name: 'You', phones: [], emails: [], websites: [], socials: [], custom_links: [] }), company: inv.business.name }, photo_url: me?.photo_url, business: { name: inv.business.name, logo_url: inv.business.logo_url, verified: inv.business.verified } }}
            audience="all"
            maxHeight={260}
          />
        </div>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-5 w-5 text-subtle" />
            <p className="text-[15px] font-semibold">{inv.business.name}</p>
            <Badge tone={pending ? 'info' : inv.status === 'accepted' ? 'success' : 'neutral'} className="capitalize">
              {inv.status}
            </Badge>
          </div>
          <p className="text-[13px] text-muted">
            {inv.business.name} invited you to carry a company digital card. It lives in your account next to your own cards; your company keeps its branding up to date
            and may lock some fields (like the company name).
          </p>
          <p className="text-xs text-subtle">Received {relativeTime(inv.created_at)}</p>
          {pending && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="primary"
                leftIcon={<Check className="h-4 w-4" />}
                loading={accept.isPending}
                onClick={async () => {
                  try {
                    const c = await accept.mutateAsync(undefined)
                    toast.success(`Your ${inv.business.name} card is ready`)
                    if (c && 'id' in c) navigate(`/me/cards/${c.id}`)
                  } catch (e) {
                    onError(e)
                  }
                }}
              >
                Accept
              </Button>
              <Button
                leftIcon={<X className="h-4 w-4" />}
                loading={decline.isPending}
                onClick={async () => {
                  try {
                    await decline.mutateAsync(undefined)
                    toast.info('Invitation declined')
                  } catch (e) {
                    onError(e)
                  }
                }}
              >
                Decline
              </Button>
            </div>
          )}
        </CardBody>
      </div>
    </Card>
  )
}

/** Invitations are matched on the account email, so they're only listed (and can only be answered) once it's verified. */
function VerifyToSeeInvites() {
  const { user, devVerificationUrl, setDevVerificationUrl } = useAuth()
  const toast = useToast()
  const [sending, setSending] = useState(false)
  async function resend() {
    setSending(true)
    try {
      const res = await authApi.resendVerification()
      if (res?.dev_verification_url) setDevVerificationUrl(res.dev_verification_url)
      toast.success(`We sent a new verification link to ${user?.email ?? 'your email'}.`)
    } catch (e) {
      toast.fromError(e, 'Could not resend')
    } finally {
      setSending(false)
    }
  }
  return (
    <Card>
      <EmptyState
        icon={MailWarning}
        title="Verify your email to see business card invites"
        description={`Companies invite you by email address. Verify ${user?.email ?? 'your email'} to see and accept the digital cards they issue you.`}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button variant="primary" loading={sending} onClick={resend}>
              Resend verification link
            </Button>
            {devVerificationUrl && (
              <a href={devVerificationUrl} className="text-xs break-all text-accent underline">
                Dev link: {devVerificationUrl}
              </a>
            )}
          </div>
        }
      />
    </Card>
  )
}

export default function InvitesPage() {
  useDocumentTitle('Business invites')
  const { user } = useAuth()
  const { data, error, isLoading, refetch } = useInvites()
  const unverified = user?.email_verified === false || (error instanceof ApiError && error.code === 'email_not_verified')
  return (
    <>
      <PageHeader title="Business invites" description="Companies can issue you an employee digital card. Accept to add it to your account." />
      {unverified ? (
        <VerifyToSeeInvites />
      ) : error ? (
        <Card>
          <BizErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-60" />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={Building2} title="No invitations" description="When your employer issues you a digital card, it shows up here." />
        </Card>
      ) : (
        <div className="space-y-4">
          {data.map((i) => (
            <InviteCard key={i.id} inv={i} />
          ))}
        </div>
      )}
    </>
  )
}
