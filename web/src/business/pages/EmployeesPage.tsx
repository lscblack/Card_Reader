import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Pencil, Plus, Power, UserPlus, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Menu } from '@/components/ui/Menu'
import { ActiveBadge } from '@/components/ui/Badge'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { num, relativeTime } from '@/lib/format'
import type { Employee, PersonStatus } from '../api/types'
import { useBusiness, useCan } from '../hooks/context'
import { useEmployees } from '../hooks/queries'
import { Avatar, FilterBar, FilterSelect, SearchInput } from '../components/bits'
import { BizErrorState } from '../components/BizError'
import { EmployeeFormModal, EmployeeStatusDialog } from '../components/EmployeeDialogs'

export default function EmployeesPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const navigate = useNavigate()
  const now = useNow()
  useDocumentTitle('Employees')
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const [status, setStatus] = useState<PersonStatus | ''>('')
  const [department, setDepartment] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [statusTarget, setStatusTarget] = useState<Employee | null>(null)
  const creating = params.get('new') === '1'
  const setCreating = (v: boolean) => setParams(v ? { new: '1' } : {}, { replace: true })
  const { data, error, isLoading, refetch } = useEmployees(business.id, { q: dq || undefined, status, department: department || undefined, page, page_size: 20 })
  const all = useEmployees(business.id, { page_size: 100 })
  const departments = [...new Set((all.data?.items ?? []).map((e) => e.department).filter(Boolean))].sort() as string[]
  const manage = can('people.manage')
  const filtered = !!(dq || status || department)
  const reset = (fn: () => void) => {
    fn()
    setPage(1)
  }

  return (
    <>
      <PageHeader
        title="Employees"
        description="Your team’s digital business cards. Deactivating someone disables their cards and profile instantly."
        actions={
          manage && (
            <Button variant="primary" leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Add employee
            </Button>
          )
        }
      />
      <Card>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => reset(() => setQ(v))} placeholder="Search name, email, phone, position…" className="sm:w-72" />
          <FilterSelect
            label="Department"
            value={department}
            onChange={(v) => reset(() => setDepartment(v))}
            options={[{ value: '', label: 'All departments' }, ...departments.map((d) => ({ value: d, label: d }))]}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => reset(() => setStatus(v))}
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
            icon={Users}
            title={filtered ? 'No employees match your filters' : 'No employees yet'}
            description={filtered ? 'Try a different search or clear the filters.' : 'Add your team so each person gets a digital business card and an NFC card.'}
            action={
              filtered ? (
                <Button size="sm" onClick={() => reset(() => (setQ(''), setStatus(''), setDepartment('')))}>
                  Clear filters
                </Button>
              ) : (
                manage && (
                  <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
                    Add employee
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
                    <TH>Employee</TH>
                    <TH>Position</TH>
                    <TH>Department</TH>
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
                  {data.items.map((e) => (
                    <TR key={e.id} onClick={() => navigate(`${base}/employees/${e.id}`)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && navigate(`${base}/employees/${e.id}`)}>
                      <TD className="max-w-[260px]">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={e.full_name} src={e.photo_url} size={32} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{e.full_name}</span>
                            <span className="block truncate text-xs text-subtle">{e.email ?? e.phone ?? '—'}</span>
                          </span>
                        </span>
                      </TD>
                      <TD className="text-muted">{e.position ?? '—'}</TD>
                      <TD className="text-muted">{e.department ?? '—'}</TD>
                      <TD className="tabular-nums">{e.cards.length}</TD>
                      <TD>
                        <ActiveBadge active={e.status === 'active'} />
                      </TD>
                      <TD className="text-right font-medium tabular-nums">{num(e.total_taps)}</TD>
                      <TD className="whitespace-nowrap text-muted">{e.last_tap_at ? relativeTime(e.last_tap_at, now) : 'Never'}</TD>
                      <TD className="text-right" onClick={(ev) => ev.stopPropagation()}>
                        {manage && (
                          <Menu
                            label={`Actions for ${e.full_name}`}
                            items={[
                              { label: 'Edit', icon: <Pencil className="h-4 w-4 text-subtle" />, onSelect: () => setEditing(e) },
                              { label: e.status === 'active' ? 'Deactivate' : 'Reactivate', icon: <Power className="h-4 w-4" />, danger: e.status === 'active', onSelect: () => setStatusTarget(e) },
                            ]}
                          />
                        )}
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
      {creating && <EmployeeFormModal open employee={null} onClose={() => setCreating(false)} onCreated={(e) => navigate(`${base}/employees/${e.id}`)} />}
      {editing && <EmployeeFormModal open employee={editing} onClose={() => setEditing(null)} />}
      <EmployeeStatusDialog employee={statusTarget} onClose={() => setStatusTarget(null)} />
    </>
  )
}
