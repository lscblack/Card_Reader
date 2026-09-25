import { Building2, Check, Lock, X } from 'lucide-react'
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
import { useInvites, usePCards, usePMutation, useTemplates } from '../hooks/queries'
import { layoutFor } from '../lib/card'
import { DEFAULT_DESIGN } from '../lib/design'
import { CardThumb } from '../components/DigitalCardRender'

function InviteCard({ inv }: { inv: BusinessInvite }) {
  const toast = useToast()
  const onError = useErrorToast()
  const navigate = useNavigate()
  const templates = useTemplates()
  const cards = usePCards()
  const me = cards.data?.find((c) => c.is_primary) ?? cards.data?.[0]
  const accept = usePMutation(() => invitesApi.accept(inv.id))
  const decline = usePMutation(() => invitesApi.decline(inv.id))
  const tpl = templates.data?.find((t) => t.id === inv.template_id)
  const pending = inv.status === 'pending'
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        <div className="bg-surface-2/60 p-4">
          <CardThumb
            layout={layoutFor(inv.template_id, templates.data)}
            card={{ design: { ...(tpl?.default_design ?? DEFAULT_DESIGN), ...(inv.design ?? {}) }, fields: { ...(me?.fields ?? { full_name: inv.employee_name ?? 'You', phones: [], emails: [], websites: [], socials: [], custom_links: [] }), company: inv.business_name }, photo_url: me?.photo_url, business: { name: inv.business_name, logo_url: inv.business_logo_url ?? null, verified: true } }}
            audience="all"
            maxHeight={260}
          />
        </div>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-5 w-5 text-subtle" />
            <p className="text-[15px] font-semibold">{inv.business_name}</p>
            <Badge tone={pending ? 'info' : inv.status === 'accepted' ? 'success' : 'neutral'} className="capitalize">
              {inv.status}
            </Badge>
          </div>
          <p className="text-[13px] text-muted">
            {inv.business_name} invited you to carry a company digital card. It lives in your account next to your own cards; your company keeps its branding up to date.
          </p>
          {inv.locked_fields.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-subtle">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Managed by the company: {inv.locked_fields.map((f) => f.replace(/_/g, ' ')).join(', ')}.
            </p>
          )}
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
                    toast.success(`Your ${inv.business_name} card is ready`)
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

export default function InvitesPage() {
  useDocumentTitle('Business invites')
  const { data, error, isLoading, refetch } = useInvites()
  return (
    <>
      <PageHeader title="Business invites" description="Companies can issue you an employee digital card. Accept to add it to your account." />
      {error ? (
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
