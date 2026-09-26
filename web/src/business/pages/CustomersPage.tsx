import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Contact, Pencil, Plus, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Menu } from '@/components/ui/Menu'
import { ActiveBadge, Badge } from '@/components/ui/Badge'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { num, relativeTime } from '@/lib/format'
import type { Customer, PersonStatus } from '../api/types'
import { useBusiness, useCan } from '../hooks/context'
import { useCustomers } from '../hooks/queries'
import { Avatar, FilterBar, FilterSelect, SearchInput } from '../components/bits'
import { BizErrorState } from '../components/BizError'
import { CustomerFormModal } from '../components/CustomerFormModal'

export default function CustomersPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const navigate = useNavigate()
  const now = useNow()
  useDocumentTitle('Customers')
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const [status, setStatus] = useState<PersonStatus | ''>('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Customer | null>(null)
  const creating = params.get('new') === '1'
  const setCreating = (v: boolean) => setParams(v ? { new: '1' } : {}, { replace: true })
  const { data, error, isLoading, refetch } = useCustomers(business.id, { q: dq || undefined, status, page, page_size: 20 })
  const manage = can('people.manage')
  const filtered = !!(dq || status)

  return (
    <>
      <PageHeader
        title="Customers"
        description="People who hold loyalty, membership or VIP cards. Search by name, email, phone or company."
        actions={
          manage && (
            <Button variant="primary" leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Add customer
            </Button>
          )
        }
      />
      <Card>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Search name, email, phone, company…" className="sm:w-72" />
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => (setStatus(v), setPage(1))}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
        </FilterBar>
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={6} cols={5} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={Contact}
            title={filtered ? 'No customers match your filters' : 'No customers yet'}
            description={filtered ? 'Try a different search.' : 'Add customers to give them loyalty or membership cards and see who taps.'}
            action={
              filtered ? (
                <Button size="sm" onClick={() => (setQ(''), setStatus(''))}>
                  Clear filters
                </Button>
              ) : (
                manage && (
                  <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
                    Add customer
                  </Button>
                )
              )
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[860px]">
                <THead>
                  <tr>
                    <TH>Customer</TH>
                    <TH>Company</TH>
                    <TH>Tags</TH>
                    <TH>Cards</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Taps</TH>
                    <TH>Last tap</TH>
                    <TH className="text-right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {data.items.map((c) => (
                    <TR key={c.id} onClick={() => navigate(`${base}/customers/${c.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`${base}/customers/${c.id}`)}>
                      <TD className="max-w-[260px]">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={c.full_name} size={32} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{c.full_name}</span>
                            <span className="block truncate text-xs text-subtle">{c.email ?? c.phone ?? '—'}</span>
                          </span>
                        </span>
                      </TD>
                      <TD className="text-muted">{c.company ?? '—'}</TD>
                      <TD>
                        <span className="flex max-w-[220px] flex-wrap gap-1">
                          {c.tags.length ? c.tags.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-subtle">—</span>}
                        </span>
                      </TD>
                      <TD className="tabular-nums">{c.cards.length}</TD>
                      <TD>
                        <ActiveBadge active={c.status === 'active'} />
                      </TD>
                      <TD className="text-right font-medium tabular-nums">{num(c.total_taps)}</TD>
                      <TD className="whitespace-nowrap text-muted">{c.last_tap_at ? relativeTime(c.last_tap_at, now) : 'Never'}</TD>
                      <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                        {manage && <Menu label={`Actions for ${c.full_name}`} items={[{ label: 'Edit', icon: <Pencil className="h-4 w-4 text-subtle" />, onSelect: () => setEditing(c) }]} />}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <CustomerFormModal customer={null} onClose={() => setCreating(false)} onCreated={(c) => navigate(`${base}/customers/${c.id}`)} />}
      {editing && <CustomerFormModal customer={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
