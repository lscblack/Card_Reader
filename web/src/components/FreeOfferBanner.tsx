import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, PartyPopper } from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/auth/context'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toastContext'
import { cn } from '@/lib/cn'
import { freePeriodLabel } from '@/marketing/plans'

interface FreeOffer {
  promotion_id: string
  name: string
  description: string | null
  banner_text: string | null
  months: number
  ends_at: string | null
  plan: { code: string; name: string; price_monthly_cents: number; currency: string }
  eligible: boolean
  reason: string | null
}

interface FreeOffers {
  offers: FreeOffer[]
  active: { plan_code: string; plan_name: string | null; ends_at: string; business_id: string | null } | null
  business_id: string | null
}

const longDate = (iso: string) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))

function endDate(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return longDate(d.toISOString())
}

/**
 * "1 year free" offers (free-period promotions) for accounts on a free plan: a claim card, or — once claimed — a
 * slim note saying until when the paid plan is free. Renders nothing when there's nothing to show.
 */
export function FreeOfferBanner({ businessId, className }: { businessId?: string; className?: string }) {
  const qc = useQueryClient()
  const { refreshUser } = useAuth()
  const toast = useToast()
  const [confirm, setConfirm] = useState<FreeOffer | null>(null)
  const q = useQuery({
    queryKey: ['free-offers', businessId ?? null],
    queryFn: () => api.get<FreeOffers>('/billing/free-offers', businessId ? { business_id: businessId } : undefined),
    staleTime: 60_000,
  })
  const claim = useMutation({
    mutationFn: (o: FreeOffer) => api.post<FreeOffers>(`/billing/free-offers/${o.promotion_id}/claim`, businessId ? { business_id: businessId } : {}),
    onSuccess: (_, o) => {
      toast.success(`${o.plan.name} is yours free until ${endDate(o.months)}`)
      setConfirm(null)
      void qc.invalidateQueries()
      void refreshUser()  // the plan shown in the sidebar comes from the signed-in user
    },
    onError: (e) => toast.fromError(e, 'Could not claim the offer'),
  })

  const data = q.data
  if (!data) return null
  if (data.active) {
    return (
      <div className={cn('flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 text-[13px]', className)} role="status">
        <PartyPopper className="h-4.5 w-4.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="min-w-0">
          <b>{data.active.plan_name ?? data.active.plan_code}</b> is free until <b>{longDate(data.active.ends_at)}</b>. After that you’ll go back to the free
          plan automatically — nothing is deleted.
        </p>
      </div>
    )
  }
  const offer = data.offers.find((o) => o.eligible)
  if (!offer) return null
  const title = offer.banner_text || `${freePeriodLabel(offer.months)} of ${offer.plan.name}`
  return (
    <>
      <div className={cn('flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3.5 sm:flex-row sm:items-center', className)}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-solid text-accent-fg">
          <Gift className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{title}</p>
          <p className="text-[13px] text-muted">
            {offer.description || `Get ${offer.plan.name} free for ${offer.months} months — no card needed.`}
            {offer.ends_at && <> Claim by {longDate(offer.ends_at)}.</>}
          </p>
        </div>
        <Button variant="primary" onClick={() => setConfirm(offer)} className="shrink-0">
          Claim {freePeriodLabel(offer.months)}
        </Button>
      </div>
      <Modal
        open={confirm != null}
        onClose={() => setConfirm(null)}
        title={confirm ? `Claim ${freePeriodLabel(confirm.months)} of ${confirm.plan.name}?` : ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Not now</Button>
            <Button variant="primary" loading={claim.isPending} onClick={() => confirm && claim.mutate(confirm)}>
              Claim now
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-2 text-[13.5px] text-muted">
            <p>
              Your {businessId ? 'business' : 'account'} moves to <b className="text-fg">{confirm.plan.name}</b> right away, free until{' '}
              <b className="text-fg">{endDate(confirm.months)}</b>.
            </p>
            <p>After that it goes back to the free plan automatically. We’ll remind you 14 days before. Each account can claim this once.</p>
          </div>
        )}
      </Modal>
    </>
  )
}
