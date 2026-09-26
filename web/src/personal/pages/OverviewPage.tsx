import { Link } from 'react-router'
import { ArrowRight, Building2, Eye, Handshake, Inbox, Nfc, Pencil } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { DownloadAppCard } from '@/components/DownloadApp'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { KpiCard } from '@/business/components/bits'
import { TimelineChart } from '@/business/components/charts'
import { UrlQrPanel } from '@/business/components/inputs'
import { BizErrorState } from '@/business/components/BizError'
import { delta } from '@/business/lib/format'
import { CHART } from '@/business/lib/chart'
import { useInvites, usePCards, usePStats, useTemplates } from '../hooks/queries'
import { renderableOf, templateFor } from '../lib/card'
import { DigitalCardRender } from '../components/DigitalCardRender'
import { ActivityList } from '../components/ActivityList'

export default function OverviewPage() {
  useDocumentTitle('My digital card')
  const { user } = useAuth()
  const cards = usePCards()
  const templates = useTemplates()
  const stats = usePStats('30d')
  const invites = useInvites()
  const primary = cards.data?.find((c) => c.is_primary) ?? cards.data?.[0]
  const s = stats.data
  const pending = invites.data?.filter((i) => i.status === 'pending') ?? []

  return (
    <>
      <PageHeader
        title={`Hi${user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}`}
        description="Share your card by tapping phones, a QR code or a link — and keep everyone you meet in one place."
        actions={
          primary && (
            <Link to={`/me/cards/${primary.id}`}>
              <Button variant="primary" leftIcon={<Pencil className="h-4 w-4" />}>
                Edit my card
              </Button>
            </Link>
          )
        }
      />
      <div className="space-y-6">
        {pending.length > 0 && (
          <Alert tone="info" title={`${pending[0].business.name} invited you to a company card`}>
            <Link to="/me/invites" className="font-medium text-accent hover:underline">
              Review the invitation →
            </Link>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Card views · 30d" value={s?.totals.views ?? 0} icon={Eye} loading={!s} delta={s ? delta(s.totals.views, s.previous_totals?.views) : undefined} />
          <KpiCard label="NFC taps" value={s?.totals.nfc_taps ?? 0} icon={Nfc} loading={!s} delta={s ? delta(s.totals.nfc_taps, s.previous_totals?.nfc_taps) : undefined} />
          <KpiCard label="Exchanges" value={s?.totals.exchanges ?? 0} icon={Handshake} loading={!s} delta={s ? delta(s.totals.exchanges, s.previous_totals?.exchanges) : undefined} />
          <KpiCard label="Leads" value={s?.totals.leads ?? 0} icon={Inbox} loading={!s} delta={s ? delta(s.totals.leads, s.previous_totals?.leads) : undefined} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
          <div className="space-y-3" data-tour="me-card-preview">
            {cards.error ? (
              <Card>
                <BizErrorState error={cards.error} onRetry={() => cards.refetch()} />
              </Card>
            ) : !primary ? (
              cards.isLoading ? (
                <Skeleton className="h-[480px] rounded-2xl" />
              ) : (
                <Card>
                  <EmptyState icon={Building2} title="No card yet" action={<Link to="/me/cards"><Button variant="primary" size="sm">Create a card</Button></Link>} />
                </Card>
              )
            ) : (
              <>
                <DigitalCardRender card={renderableOf(primary)} template={templateFor(primary.template_id, templates.data)} audience="public" qrValue={primary.public_url} />
                <p className="text-center text-xs text-subtle">Public view of your primary card “{primary.label}”.</p>
              </>
            )}
          </div>
          <div className="min-w-0 space-y-6">
            {primary && (
              <Card>
                <CardHeader
                  title="Share your card"
                  actions={
                    <Link to="/me/share" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                      More ways <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  }
                />
                <CardBody>
                  <UrlQrPanel url={primary.public_url} label="Your public link" filename={`${primary.slug}-qr`} qrSize={132} hint="Anyone can open it — no app needed. Your phone also shares it over NFC." />
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader title="Last 30 days" description={s ? `${s.totals.views} views · ${s.totals.exchanges} exchanges` : undefined} />
              <CardBody>
                {stats.error ? (
                  <BizErrorState error={stats.error} onRetry={() => stats.refetch()} />
                ) : !s ? (
                  <Skeleton className="h-56" />
                ) : (
                  <TimelineChart
                    data={s.timeline}
                    height={200}
                    label="Daily card views and exchanges over the last 30 days"
                    series={[
                      { key: 'views', label: 'Views', color: CHART.primary },
                      { key: 'exchanges', label: 'Exchanges', color: CHART.secondary },
                    ]}
                  />
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Recent activity"
              actions={
                <Link to="/me/activity" className="text-[13px] font-medium text-accent hover:underline">
                  View all
                </Link>
              }
            />
            <ActivityList limit={6} />
          </Card>
          <DownloadAppCard />
        </div>
      </div>
    </>
  )
}
