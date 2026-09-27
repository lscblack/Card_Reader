import { useState } from 'react'
import { Link } from 'react-router'
import { Download, Activity, AppWindow, ArrowRight, CalendarDays, Check, CircleGauge, KeyRound, Plus, Smartphone } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { useApplications, useOverview } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatBytes, num, percent } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/StatCard'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { EventDetailDrawer, EventsTable } from '@/components/Events'
import { CreateApplicationModal, NewApplicationButton } from '@/components/CreateApplicationModal'
import { PairPhoneButton } from '@/components/PairPhoneModal'
import { ServerUrlCard } from '@/components/ServerUrlCard'
import { DownloadAppCard } from '@/components/DownloadApp'
import { useAppRelease } from '@/hooks/useAppRelease'
import { useTour, developerDashboardTour } from '@/tours'
import { FreeOfferBanner } from '@/components/FreeOfferBanner'

const steps = [
  { title: 'Create an application', body: 'Groups your devices, API keys and endpoint.' },
  { title: 'Copy your API key', body: 'Shown once when the application is created — store it safely.' },
  { title: 'Install the app & register a phone', body: 'Install nexTap on an NFC-capable Android phone and scan the pairing QR code (or paste the API key).' },
  { title: 'Configure your endpoint', body: 'Set the HTTPS URL that should receive signed card events.' },
  { title: 'Tap a card', body: 'Hold an NFC card to the phone — the event shows up here in seconds.' },
]

/** Download link shown under the "install the app" onboarding step (hidden when no release is published). */
function DownloadAppInlineRow() {
  const { data: r } = useAppRelease()
  if (!r) return null
  return (
    <a href={r.download_url} download className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
      <Download className="h-3.5 w-3.5" /> Download the Android app (v{r.version_name}, {formatBytes(r.file_size)})
    </a>
  )
}

function OnboardingChecklist({ onCreate, hasApp }: { onCreate: () => void; hasApp: boolean }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-gradient-to-br from-accent-soft to-transparent px-5 py-5">
        <h2 className="text-base font-semibold tracking-tight">Get started in 5 steps</h2>
        <p className="mt-1 text-[13px] text-muted">From zero to your first card event in about five minutes.</p>
      </div>
      <ol className="divide-y divide-border">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3.5 px-5 py-3.5">
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                i === 0 && hasApp
                  ? 'bg-emerald-500 text-white'
                  : i === (hasApp ? 2 : 0)
                    ? 'bg-accent-solid text-accent-fg'
                    : 'bg-surface-2 text-muted ring-1 ring-border',
              )}
            >
              {i === 0 && hasApp ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">{s.title}</p>
              <p className="text-[13px] text-muted">{s.body}</p>
              {i === 2 && <DownloadAppInlineRow />}
            </div>
            {i === 0 && !hasApp && (
              <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={onCreate}>
                Create
              </Button>
            )}
            {i === 2 && (
              <div className="flex shrink-0 flex-col items-end gap-1">
                <PairPhoneButton size="sm" variant={hasApp ? 'primary' : 'secondary'} disabled={!hasApp} />
                <Link to="/docs#pairing" className="text-xs text-accent hover:underline">
                  How it works
                </Link>
              </div>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}

function SetupProgress({ hasApp, hasDevice, hasEndpoint, hasEvent }: { hasApp: boolean; hasDevice: boolean; hasEndpoint: boolean; hasEvent: boolean }) {
  const items = [
    { done: hasApp, label: 'Application created', to: '/dashboard/applications' },
    { done: hasDevice, label: 'Device registered', to: '/dashboard/devices' },
    { done: hasEndpoint, label: 'Endpoint configured', to: '/dashboard/endpoints' },
    { done: hasEvent, label: 'First card event', to: '/dashboard/events' },
  ]
  if (items.every((i) => i.done)) return null
  return (
    <Card className="p-4">
      <p className="mb-3 text-[13px] font-semibold">Finish setting up</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it) => (
          <Link
            key={it.label}
            to={it.to}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors',
              it.done ? 'border-border text-muted' : 'border-accent/30 bg-accent-soft/50 font-medium hover:bg-accent-soft',
            )}
          >
            <span
              className={cn(
                'flex h-4.5 w-4.5 items-center justify-center rounded-full',
                it.done ? 'bg-emerald-500 text-white' : 'ring-1 ring-accent/50',
              )}
            >
              {it.done && <Check className="h-3 w-3" />}
            </span>
            {it.label}
            {!it.done && <ArrowRight className="ml-auto h-3.5 w-3.5 text-accent" />}
          </Link>
        ))}
      </div>
    </Card>
  )
}

export default function OverviewPage() {
  useDocumentTitle('Overview')
  const { user } = useAuth()
  const overview = useOverview()
  const apps = useApplications()
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const o = overview.data
  const firstName = user?.full_name?.split(' ')[0]
  const noApps = apps.data?.length === 0
  useTour('developer.dashboard', developerDashboardTour, { ready: !!o && !!apps.data })
  // The API reports 0.0 when there were no deliveries at all; show "—" instead of a misleading 0%.
  const noDeliveries = !o || o.delivery_success_rate == null || (o.delivery_success_rate === 0 && o.events_this_month === 0)

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Overview'}
        description="What your NFC readers have been up to."
        actions={
          <>
            <span data-tour="pair-phone">
              <PairPhoneButton variant="secondary" disabled={!apps.data?.length} />
            </span>
            <NewApplicationButton onCreate={() => setCreating(true)} data-tour="new-app" />
          </>
        }
      />
      <FreeOfferBanner className="mb-6" />

      {overview.error ? (
        <Card>
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6" data-tour="overview-stats">
            <StatCard label="Applications" value={num(o?.applications)} icon={AppWindow} loading={!o} />
            <StatCard label="Active devices" value={num(o?.active_devices)} icon={Smartphone} loading={!o} />
            <StatCard label="Active API keys" value={num(o?.active_api_keys)} icon={KeyRound} loading={!o} />
            <StatCard label="Events today" value={num(o?.events_today)} icon={Activity} loading={!o} />
            <StatCard label="Events this month" value={num(o?.events_this_month)} icon={CalendarDays} loading={!o} />
            <StatCard
              label="Delivery success"
              value={noDeliveries ? '—' : percent(o.delivery_success_rate)}
              icon={CircleGauge}
              loading={!o}
              hint={noDeliveries ? 'No deliveries yet' : 'This month'}
            />
          </div>

          {noApps || (o && o.active_devices === 0) ? (
            <OnboardingChecklist onCreate={() => setCreating(true)} hasApp={!noApps && !!apps.data} />
          ) : (
            o &&
            apps.data && (
              <SetupProgress
                hasApp={apps.data.length > 0}
                hasDevice={o.active_devices > 0}
                hasEndpoint={apps.data.some((a) => !!a.endpoint.url)}
                hasEvent={o.recent_events.length > 0 || o.events_this_month > 0}
              />
            )
          )}

          <ServerUrlCard />
          <DownloadAppCard />

          <Card>
            <CardHeader
              title="Recent events"
              description="The last 10 card taps across all applications."
              actions={
                <Link to="/dashboard/events" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            {!o ? (
              <SkeletonRows rows={5} cols={4} />
            ) : o.recent_events.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No card events yet"
                description="Register a phone with the nexTap app and tap a card. Events appear here in real time."
              />
            ) : (
              <EventsTable events={o.recent_events} compact onSelect={(e) => setSelected(e.id)} />
            )}
          </Card>
        </div>
      )}

      <CreateApplicationModal open={creating} onClose={() => setCreating(false)} />
      <EventDetailDrawer eventId={selected} onClose={() => setSelected(null)} />
    </>
  )
}
