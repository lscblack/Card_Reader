import { useState } from 'react'
import { Link } from 'react-router'
import { Activity, ArrowRight, Check, Contact, MousePointerClick, Nfc, Smartphone, Tag, Users } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'
import type { BusinessOverview, CardTap } from '../api/types'
import { useBusiness, useCan } from '../hooks/context'
import { useAnalytics, useBizOverview } from '../hooks/queries'
import { CHART } from '../lib/chart'
import { delta } from '../lib/format'
import { KpiCard } from '../components/bits'
import { BizErrorState } from '../components/BizError'
import { TimelineChart } from '../components/charts'
import { RecentTapsList, TapDetailDrawer } from '../components/Taps'
import { DownloadAppInline } from '@/components/DownloadApp'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Checklist({ data }: { data: BusinessOverview }) {
  const { base } = useBusiness()
  const { user } = useAuth()
  const c = data.checklist
  const emailVerified = c.email_verified || user?.email_verified === true
  const steps = [
    { done: c.logo_uploaded && c.profile_published, title: 'Complete your business profile', body: 'Upload your logo and publish your business page — it’s what customers see.', to: c.logo_uploaded ? `${base}/profiles` : `${base}/settings`, cta: c.logo_uploaded ? 'Edit profile' : 'Upload logo' },
    { done: c.first_employee, title: 'Add an employee', body: 'Give your team digital business cards.', to: `${base}/employees?new=1`, cta: 'Add employee' },
    { done: c.device_paired, title: 'Pair a business phone', body: 'Install nexTap on an Android phone and pair it — it registers, programs and reads your cards.', to: `${base}/devices?pair=1`, cta: 'Pair device' },
    { done: c.first_card, app: true, title: 'Register your first card', body: 'Open nexTap on the business phone → Reader → Register cards, and tap a card.', to: `${base}/cards?new=1`, cta: 'Register cards' },
    { done: c.card_programmed, app: true, title: 'Program the card', body: 'In nexTap → Program card, hold the card to the phone to write its tap link.', to: `${base}/cards`, cta: 'View cards' },
    { done: emailVerified, title: 'Verify your email', body: 'Public pages go live once the business email is verified.', to: null, cta: null },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  return (
    <Card className="overflow-hidden" data-tour="biz-checklist">
      <div className="border-b border-border bg-gradient-to-br from-accent-soft to-transparent px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Set up your business</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {done} of {steps.length} done — finish these to go live.
            </p>
          </div>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
            <div className="h-full rounded-full bg-accent-solid" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
        </div>
      </div>
      <ol className="divide-y divide-border">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3.5 px-5 py-3">
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                s.done ? 'bg-emerald-500 text-white' : 'bg-surface-2 text-muted ring-1 ring-border',
              )}
              aria-label={s.done ? 'Done' : `Step ${i + 1}`}
            >
              {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-[13.5px] font-medium', s.done && 'text-muted line-through decoration-border-strong')}>{s.title}</p>
              {!s.done && <p className="text-[13px] text-muted">{s.body}</p>}
              {!s.done && s.app && (
                <div className="mt-2 max-w-md">
                  <DownloadAppInline />
                </div>
              )}
            </div>
            {!s.done && s.to && (
              <Link to={s.to} className="shrink-0">
                <Button size="sm">{s.cta}</Button>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}

export default function OverviewPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const { user } = useAuth()
  useDocumentTitle(`Overview · ${business.name}`)
  const overview = useBizOverview(business.id)
  const analytics = useAnalytics(business.id, { range: '30d' }, can('analytics.view'))
  const [tap, setTap] = useState<CardTap | null>(null)
  const d = overview.data
  const a = analytics.data

  return (
    <>
      <PageHeader
        title={`${greeting()}${user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}`}
        description={`Here’s what’s happening at ${business.name}.`}
        actions={
          can('cards.manage') && (
            <>
              <Link to={`${base}/tags?new=1`}>
                <Button leftIcon={<Tag className="h-4 w-4" />}>Register tags</Button>
              </Link>
              <Link to={`${base}/cards?new=1`}>
                <Button variant="primary" leftIcon={<Smartphone className="h-4 w-4" />}>
                  Register cards
                </Button>
              </Link>
            </>
          )
        }
      />

      {overview.error ? (
        <Card>
          <BizErrorState error={overview.error} onRetry={() => overview.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Taps today" value={d?.taps_today ?? 0} icon={MousePointerClick} loading={!d} />
            <KpiCard
              label={a || (can('analytics.view') && analytics.isLoading) ? 'Taps · 30 days' : 'Taps · 7 days'}
              value={a?.totals.taps ?? d?.taps_7d ?? 0}
              icon={Activity}
              loading={!d || (can('analytics.view') && analytics.isLoading)}
              delta={a ? delta(a.totals.taps, a.previous_period_totals?.taps) : undefined}
              hint={a ? `${num(d?.taps_7d)} in 7 days` : undefined}
            />
            <KpiCard label="Active cards" value={d ? `${num(d.cards.active)} / ${num(d.cards.total)}` : 0} icon={Nfc} loading={!d} />
            <KpiCard label="Active tags" value={d ? `${num(d.tags.active)} / ${num(d.tags.total)}` : 0} icon={Tag} loading={!d} />
            <KpiCard label="People" value={d ? num(d.employees.total + d.customers) : 0} icon={Users} loading={!d} hint={d ? `${d.employees.total} employees · ${d.customers} customers` : undefined} />
            <KpiCard
              label="Devices online"
              value={d ? `${num(d.devices.online)} / ${num(d.devices.total)}` : 0}
              icon={Smartphone}
              loading={!d}
            />
          </div>

          {d && <Checklist data={d} />}

          <div className="grid gap-6 xl:grid-cols-5">
            {can('analytics.view') && (
              <Card className="xl:col-span-3">
                <CardHeader
                  title="Taps · last 30 days"
                  description={a ? `${num(a.totals.taps)} taps from ${num(a.totals.unique_visitors)} unique visitors` : 'Web and reader taps across all cards and tags.'}
                  actions={
                    <Link to={`${base}/analytics`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                      Analytics <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  }
                />
                <CardBody>
                  {analytics.error ? (
                    <BizErrorState error={analytics.error} onRetry={() => analytics.refetch()} />
                  ) : !a ? (
                    <Skeleton className="h-60 w-full" />
                  ) : (
                    <TimelineChart
                      data={a.timeline}
                      label="Area chart of daily taps and unique visitors over the last 30 days"
                      series={[
                        { key: 'taps', label: 'Taps', color: CHART.primary },
                        { key: 'unique_visitors', label: 'Unique visitors', color: CHART.secondary },
                      ]}
                    />
                  )}
                </CardBody>
              </Card>
            )}

            <Card className={can('analytics.view') ? 'xl:col-span-2' : 'xl:col-span-5'}>
              <CardHeader
                title="Recent taps"
                description="Updates automatically."
                actions={
                  <Link to={`${base}/events`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                    All events <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                }
              />
              {!d ? (
                <SkeletonRows rows={5} cols={3} />
              ) : d.recent_taps.length === 0 ? (
                <EmptyState
                  icon={Contact}
                  title="No taps yet"
                  description="Once a customer taps one of your cards or tags, it shows up here in real time."
                  action={
                    can('cards.manage') && (
                      <Link to={`${base}/cards?new=1`}>
                        <Button size="sm" variant="primary" leftIcon={<Smartphone className="h-3.5 w-3.5" />}>
                          Register cards
                        </Button>
                      </Link>
                    )
                  }
                />
              ) : (
                <RecentTapsList taps={d.recent_taps} onOpen={setTap} />
              )}
            </Card>
          </div>
        </div>
      )}
      <TapDetailDrawer tap={tap} onClose={() => setTap(null)} />
    </>
  )
}
