import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ExternalLink, Mail, Nfc, Pencil, Phone, Power, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ActiveBadge, Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Menu } from '@/components/ui/Menu'
import { Alert } from '@/components/ui/Alert'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { num, relativeTime } from '@/lib/format'
import type { AnalyticsRange, CardTap } from '../api/types'
import { employeesApi } from '../api/people'
import { useBusiness, useCan } from '../hooks/context'
import { useAnalytics, useBizMutation, useEmployee, useProfiles, useTaps } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { CHART } from '../lib/chart'
import { delta } from '../lib/format'
import { Avatar, DetailRow, KpiCard, PageSkeleton } from '../components/bits'
import { BizErrorState } from '../components/BizError'
import { EmployeeFormModal, EmployeeStatusDialog } from '../components/EmployeeDialogs'
import { HeldCards } from '../components/HeldCards'
import { RangePicker, UrlQrPanel } from '../components/inputs'
import { BarList, TimelineChart } from '../components/charts'
import { TapDetailDrawer, TapsTable } from '../components/Taps'

export default function EmployeeDetailPage() {
  const { employeeId } = useParams()
  const { business, base } = useBusiness()
  const can = useCan()
  const navigate = useNavigate()
  const toast = useToast()
  const onError = useErrorToast()
  const { data: e, error, isLoading, refetch } = useEmployee(business.id, employeeId)
  useDocumentTitle(e?.full_name ?? 'Employee')
  const profiles = useProfiles(business.id)
  const profile = profiles.data?.find((p) => p.employee_id === employeeId)
  const [range, setRange] = useState<AnalyticsRange>('30d')
  const stats = useAnalytics(business.id, { range, employee_id: employeeId }, can('analytics.view') && !!employeeId)
  const taps = useTaps(business.id, { employee_id: employeeId, page_size: 10 })
  const [tap, setTap] = useState<CardTap | null>(null)
  const [editing, setEditing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const del = useBizMutation(business.id, () => employeesApi.remove(business.id, employeeId!))
  const manage = can('people.manage')

  const back = (
    <Link to={`${base}/employees`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
      <ArrowLeft className="h-3.5 w-3.5" /> Employees
    </Link>
  )
  if (error)
    return (
      <>
        {back}
        <Card>
          <BizErrorState error={error} onRetry={() => refetch()} />
        </Card>
      </>
    )
  if (isLoading || !e)
    return (
      <>
        {back}
        <PageSkeleton />
      </>
    )

  const a = stats.data
  return (
    <>
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={e.full_name} src={e.photo_url} size={44} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                {e.full_name} <ActiveBadge active={e.status === 'active'} />
              </span>
              <span className="block text-[13.5px] font-normal text-muted">{[e.position, e.department].filter(Boolean).join(' · ') || 'No position set'}</span>
            </span>
          </span>
        }
        actions={
          manage && (
            <>
              <Button leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant={e.status === 'active' ? 'danger-soft' : 'primary'} leftIcon={<Power className="h-4 w-4" />} onClick={() => setStatusOpen(true)}>
                {e.status === 'active' ? 'Deactivate' : 'Reactivate'}
              </Button>
              <Menu items={[{ label: 'Delete employee', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setDeleting(true) }]} />
            </>
          )
        }
      />

      <div className="space-y-6">
        {e.status === 'inactive' && (
          <Alert tone="warning" title="Deactivated">
            Their cards show a neutral page and their profile is unpublished. Reactivate to restore both.
          </Alert>
        )}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader title="Contact" />
            <CardBody className="py-1">
              <dl className="divide-y divide-border">
                <DetailRow label="Email">
                  {e.email ? (
                    <a href={`mailto:${e.email}`} className="inline-flex items-center gap-1.5 break-all hover:text-accent">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-subtle" /> {e.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </DetailRow>
                <DetailRow label="Phone">
                  {e.phone ? (
                    <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                      <Phone className="h-3.5 w-3.5 text-subtle" /> {e.phone}
                    </a>
                  ) : (
                    '—'
                  )}
                </DetailRow>
                <DetailRow label="Social">
                  {e.social_links.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {e.social_links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium capitalize ring-1 ring-border hover:text-accent">
                          {l.platform} <ExternalLink className="h-3 w-3" />
                        </a>
                      ))}
                    </span>
                  ) : (
                    '—'
                  )}
                </DetailRow>
                <DetailRow label="Added">{relativeTime(e.created_at)}</DetailRow>
              </dl>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader
              title="Digital business card"
              description={profile ? undefined : 'Their public profile page.'}
              actions={
                profile && (
                  <span className="flex items-center gap-2">
                    <Badge tone={profile.published ? 'success' : 'neutral'} dot>
                      {profile.published ? 'Published' : 'Unpublished'}
                    </Badge>
                    {can('profiles.manage') && (
                      <Link to={`${base}/profiles/${profile.id}`}>
                        <Button size="sm">Edit page</Button>
                      </Link>
                    )}
                  </span>
                )
              }
            />
            <CardBody>
              {profiles.isLoading ? (
                <Skeleton className="h-40" />
              ) : profile ? (
                <UrlQrPanel url={profile.public_url} label={`${e.full_name} — public profile`} filename={`${e.slug}-profile-qr`} qrSize={140} />
              ) : (
                <p className="text-[13px] text-muted">No profile page found for this employee.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <HeldCards cards={e.cards} assignee={{ type: 'employee', id: e.id, name: e.full_name, photo_url: e.photo_url }} />
          </div>
          {can('analytics.view') && (
            <Card className="lg:col-span-2">
              <CardHeader title="Tap activity" description="Taps on this employee’s cards." actions={<RangePicker value={range} onChange={setRange} />} />
              <CardBody className="space-y-5">
                {stats.error ? (
                  <BizErrorState error={stats.error} onRetry={() => stats.refetch()} />
                ) : !a ? (
                  <Skeleton className="h-64" />
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <KpiCard label="Taps" value={a.totals.taps} delta={delta(a.totals.taps, a.previous_period_totals?.taps)} />
                      <KpiCard label="Unique visitors" value={a.totals.unique_visitors} delta={delta(a.totals.unique_visitors, a.previous_period_totals?.unique_visitors)} />
                      <KpiCard label="All-time taps" value={num(e.total_taps)} className="col-span-2 sm:col-span-1" hint={e.last_tap_at ? `last ${relativeTime(e.last_tap_at)}` : 'never tapped'} />
                    </div>
                    <TimelineChart
                      data={a.timeline}
                      height={200}
                      label={`Daily taps for ${e.full_name}`}
                      series={[
                        { key: 'taps', label: 'Taps', color: CHART.primary },
                        { key: 'unique_visitors', label: 'Unique visitors', color: CHART.secondary },
                      ]}
                    />
                    {a.by_card.length > 1 && (
                      <div>
                        <p className="mb-2 text-[13px] font-medium">By card</p>
                        <BarList items={a.by_card.map((c) => ({ key: c.card_id, label: c.name, value: c.taps }))} />
                      </div>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader
            title="Recent taps"
            actions={
              <Link to={`${base}/events?employee_id=${e.id}`} className="text-[13px] font-medium text-accent hover:underline">
                View all
              </Link>
            }
          />
          {taps.error ? (
            <BizErrorState error={taps.error} onRetry={() => taps.refetch()} />
          ) : taps.isLoading ? (
            <SkeletonRows rows={4} cols={5} />
          ) : !taps.data?.items.length ? (
            <EmptyState icon={Nfc} title="No taps yet" />
          ) : (
            <TapsTable taps={taps.data.items} onOpen={setTap} />
          )}
        </Card>
      </div>

      {editing && <EmployeeFormModal open employee={e} onClose={() => setEditing(false)} />}
      <EmployeeStatusDialog employee={statusOpen ? e : null} onClose={() => setStatusOpen(false)} />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${e.full_name}?`}
        description="Their profile is removed and their cards become unassigned (they keep working with the business default action). This can’t be undone — deactivate instead if they might come back."
        confirmLabel="Delete employee"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(undefined)
            toast.success(`${e.full_name} deleted`)
            navigate(`${base}/employees`, { replace: true })
          } catch (err) {
            onError(err)
          }
        }}
      />
      <TapDetailDrawer tap={tap} onClose={() => setTap(null)} />
    </>
  )
}
