import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Building, Mail, Nfc, Pencil, Phone, Power, StickyNote, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ActiveBadge, Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Menu } from '@/components/ui/Menu'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { num, relativeTime } from '@/lib/format'
import type { CardTap } from '../api/types'
import { customersApi } from '../api/people'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, useCustomer, useTaps } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { Avatar, DetailRow, KpiCard, PageSkeleton } from '../components/bits'
import { BizErrorState } from '../components/BizError'
import { CustomerFormModal } from '../components/CustomerFormModal'
import { HeldCards } from '../components/HeldCards'
import { TapDetailDrawer, TapsTable } from '../components/Taps'

export default function CustomerDetailPage() {
  const { customerId } = useParams()
  const { business, base } = useBusiness()
  const can = useCan()
  const navigate = useNavigate()
  const toast = useToast()
  const onError = useErrorToast()
  const { data: c, error, isLoading, refetch } = useCustomer(business.id, customerId)
  useDocumentTitle(c?.full_name ?? 'Customer')
  const taps = useTaps(business.id, { customer_id: customerId, page_size: 10 })
  const [tap, setTap] = useState<CardTap | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<'status' | 'delete' | null>(null)
  const setStatus = useBizMutation(business.id, (status: 'active' | 'inactive') => customersApi.update(business.id, customerId!, { status }))
  const del = useBizMutation(business.id, () => customersApi.remove(business.id, customerId!))
  const manage = can('people.manage')

  const back = (
    <Link to={`${base}/customers`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
      <ArrowLeft className="h-3.5 w-3.5" /> Customers
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
  if (isLoading || !c)
    return (
      <>
        {back}
        <PageSkeleton />
      </>
    )
  const active = c.status === 'active'
  return (
    <>
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={c.full_name} size={44} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                {c.full_name} <ActiveBadge active={active} />
              </span>
              <span className="block text-[13.5px] font-normal text-muted">{c.company ?? 'Customer'}</span>
            </span>
          </span>
        }
        actions={
          manage && (
            <>
              <Button leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Menu
                items={[
                  { label: active ? 'Deactivate' : 'Reactivate', icon: <Power className="h-4 w-4 text-subtle" />, onSelect: () => setConfirm('status') },
                  { label: 'Delete customer', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setConfirm('delete') },
                ]}
              />
            </>
          )
        }
      />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Total taps" value={c.total_taps} />
          <KpiCard label="Last tap" value={c.last_tap_at ? relativeTime(c.last_tap_at) : 'Never'} />
          <KpiCard label="Cards" value={num(c.cards.length)} />
          <KpiCard label="Customer since" value={new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Details" />
            <CardBody className="py-1">
              <dl className="divide-y divide-border">
                <DetailRow label="Email">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 break-all hover:text-accent">
                      <Mail className="h-3.5 w-3.5 text-subtle" /> {c.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </DetailRow>
                <DetailRow label="Phone">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                      <Phone className="h-3.5 w-3.5 text-subtle" /> {c.phone}
                    </a>
                  ) : (
                    '—'
                  )}
                </DetailRow>
                <DetailRow label="Company">
                  <span className="inline-flex items-center gap-1.5">
                    <Building className="h-3.5 w-3.5 text-subtle" /> {c.company ?? '—'}
                  </span>
                </DetailRow>
                <DetailRow label="Tags">
                  <span className="flex flex-wrap gap-1">{c.tags.length ? c.tags.map((t) => <Badge key={t}>{t}</Badge>) : '—'}</span>
                </DetailRow>
                <DetailRow label="Notes">
                  {c.notes ? (
                    <span className="flex gap-1.5 whitespace-pre-wrap text-muted">
                      <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" />
                      {c.notes}
                    </span>
                  ) : (
                    '—'
                  )}
                </DetailRow>
              </dl>
            </CardBody>
          </Card>
          <HeldCards cards={c.cards} assignee={{ type: 'customer', id: c.id, name: c.full_name }} />
        </div>
        <Card>
          <CardHeader title="Recent taps" />
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
      {editing && <CustomerFormModal customer={c} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={confirm === 'status'}
        onClose={() => setConfirm(null)}
        danger={active}
        title={active ? `Deactivate ${c.full_name}?` : `Reactivate ${c.full_name}?`}
        description={active ? 'They stay in your list but are marked inactive. Their cards keep their own status.' : 'Mark this customer as active again.'}
        confirmLabel={active ? 'Deactivate' : 'Reactivate'}
        loading={setStatus.isPending}
        onConfirm={async () => {
          try {
            await setStatus.mutateAsync(active ? 'inactive' : 'active')
            toast.success(active ? 'Customer deactivated' : 'Customer reactivated')
            setConfirm(null)
          } catch (e) {
            onError(e)
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={`Delete ${c.full_name}?`}
        description="Their cards become unassigned. This can’t be undone."
        confirmLabel="Delete customer"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(undefined)
            toast.success(`${c.full_name} deleted`)
            navigate(`${base}/customers`, { replace: true })
          } catch (e) {
            onError(e)
          }
        }}
      />
      <TapDetailDrawer tap={tap} onClose={() => setTap(null)} />
    </>
  )
}
