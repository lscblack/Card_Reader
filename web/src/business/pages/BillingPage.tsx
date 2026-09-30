import { Check, CreditCard } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Spinner'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { money, num } from '@/lib/format'
import type { BusinessPlan } from '../api/types'
import { useBusiness, useCan } from '../hooks/context'
import { useBilling, useBizPlans } from '../hooks/queries'
import { BizErrorState } from '../components/BizError'
import { FreeOfferBanner } from '@/components/FreeOfferBanner'
import { ManageBillingButton, PaymentsOffNote, UpgradeButton } from '@/components/BillingActions'
import { usePaymentsState } from '@/hooks/usePaymentsState'

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const ratio = limit ? Math.min(1, used / limit) : 0
  const tone = !limit ? 'bg-emerald-500' : ratio >= 0.9 ? 'bg-red-500' : ratio >= 0.75 ? 'bg-amber-500' : 'bg-accent-solid'
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">
          <span className="font-semibold text-fg">{num(used)}</span> / {limit == null ? 'Unlimited' : num(limit)}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-border ring-inset"
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={used}
      >
        <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width: limit ? `${Math.max(2, ratio * 100)}%` : '4%' }} />
      </div>
      {limit != null && ratio >= 0.9 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Almost at your limit — upgrade to keep adding more.</p>}
    </div>
  )
}

const lim = (v: number | null | undefined, unit: string) => (v == null ? `Unlimited ${unit}` : `${num(v)} ${unit}`)

export default function BillingPage() {
  const { business } = useBusiness()
  const can = useCan()
  useDocumentTitle('Billing')
  const billing = useBilling(business.id)
  const plans = useBizPlans()
  const current = billing.data?.plan.code
  const owner = can('billing.manage')
  const payments = usePaymentsState(business.id, owner)
  const currentPrice = billing.data?.plan.price_monthly_cents ?? 0
  const bizPlans = (plans.data ?? []).filter((p): p is BusinessPlan => (p as BusinessPlan).audience === 'business' || p.code.startsWith('biz_'))

  return (
    <>
      <PageHeader title="Billing" description="Your plan, usage this month and available upgrades." />
      <FreeOfferBanner businessId={business.id} className="mb-6" />
      <div className="space-y-6">
        {billing.error ? (
          <Card>
            <BizErrorState error={billing.error} onRetry={() => billing.refetch()} />
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="overflow-hidden">
              <div className="bg-gradient-to-br from-accent-soft to-transparent p-5">
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-subtle uppercase">
                  <CreditCard className="h-3.5 w-3.5" /> Current plan
                </p>
                {billing.data ? (
                  <>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{billing.data.plan.name}</p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {billing.data.plan.price_monthly_cents ? `${money(billing.data.plan.price_monthly_cents, billing.data.plan.currency)} / month` : 'Free'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge tone={billing.data.status === 'active' ? 'success' : 'warning'} dot className="capitalize">
                        {billing.data.status}
                      </Badge>
                      {payments.data?.paid_online && <Badge tone="neutral">Paid by card</Badge>}
                    </div>
                    {payments.data?.can_manage && <ManageBillingButton businessId={business.id} size="sm" className="mt-4" />}
                  </>
                ) : (
                  <Skeleton className="mt-3 h-14 w-40" />
                )}
              </div>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Usage this month" />
              <CardBody className="grid gap-5 sm:grid-cols-2">
                {billing.data ? (
                  <>
                    <UsageBar label="Cards & tags" used={billing.data.usage.cards} limit={billing.data.limits.cards} />
                    <UsageBar label="Devices" used={billing.data.usage.devices} limit={billing.data.limits.devices} />
                    <UsageBar label="Team members" used={billing.data.usage.members} limit={billing.data.limits.members} />
                    <UsageBar label="Taps this month" used={billing.data.usage.taps_this_month} limit={billing.data.limits.taps_per_month} />
                  </>
                ) : (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)
                )}
              </CardBody>
            </Card>
          </div>
        )}

        <div>
          <h2 className="mb-3 text-[15px] font-semibold">Plans</h2>
          {plans.error ? (
            <Card>
              <BizErrorState error={plans.error} onRetry={() => plans.refetch()} />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {(plans.isLoading ? [] : bizPlans).map((p) => {
                const isCurrent = p.code === current
                const featured = p.code === 'biz_growth'
                return (
                  <Card key={p.code} className={cn('flex flex-col p-5', featured && 'ring-2 ring-accent/60', isCurrent && 'bg-surface-2/40')}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[15px] font-semibold">{p.name}</p>
                      {isCurrent ? <Badge tone="success">Current</Badge> : featured ? <Badge tone="accent">Popular</Badge> : null}
                    </div>
                    <p className="mt-2 text-3xl font-semibold tracking-tight">
                      {p.price_monthly_cents ? money(p.price_monthly_cents, p.currency) : 'Free'}
                      {p.price_monthly_cents > 0 && <span className="text-sm font-normal text-muted"> / month</span>}
                    </p>
                    <ul className="mt-4 flex-1 space-y-2 text-[13px]">
                      <li className="flex gap-2 text-muted">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {lim(p.max_cards, 'cards & tags')}
                      </li>
                      <li className="flex gap-2 text-muted">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {lim(p.max_devices, 'devices')}
                      </li>
                      <li className="flex gap-2 text-muted">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {lim(p.max_members, 'team members')}
                      </li>
                      <li className="flex gap-2 text-muted">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {lim(p.taps_per_month ?? p.events_per_month, 'taps / month')}
                      </li>
                      {p.features
                        .filter((f) => !/^\d|unlimited/i.test(f))
                        .map((f) => (
                          <li key={f} className="flex gap-2 text-muted">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                          </li>
                        ))}
                    </ul>
                    {isCurrent || !p.price_monthly_cents ? (
                      <Button className="mt-5 w-full" disabled title={!isCurrent ? 'Cancel your subscription from Manage billing to go back to the free plan' : undefined}>
                        {isCurrent ? 'Your plan' : 'Free forever'}
                      </Button>
                    ) : !owner ? (
                      <Button className="mt-5 w-full" disabled title="Only owners can change the plan">
                        Upgrade
                      </Button>
                    ) : (
                      <div className="mt-5">
                        <UpgradeButton planCode={p.code} businessId={business.id} enabled={!!payments.data?.enabled} className="w-full" variant={featured ? 'primary' : 'secondary'}>
                          {p.price_monthly_cents > currentPrice ? 'Upgrade' : 'Switch plan'}
                        </UpgradeButton>
                      </div>
                    )}
                  </Card>
                )
              })}
              {plans.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-80" />)}
            </div>
          )}
          <p className="mt-3 text-xs text-subtle">
            {payments.data?.enabled === false
              ? <PaymentsOffNote />
              : 'Payments are processed securely by Stripe. Upgrades apply instantly; cancel anytime from Manage billing.'}
          </p>
        </div>
      </div>
    </>
  )
}
