import { useState } from 'react'
import { Check, UserRound, Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { useDebounced } from '@/hooks/useDebounce'
import { cn } from '@/lib/cn'
import type { Assignee, AssigneeType, ProfileType } from '../api/types'
import { useBusiness } from '../hooks/context'
import { useBizApps, useCustomers, useEmployees, useProfiles } from '../hooks/queries'
import { Avatar, SearchInput } from './bits'
import { BizErrorState } from './BizError'

export function EmployeeSelect({
  value,
  onChange,
  id,
  emptyLabel = 'None',
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (id: string) => void
  id?: string
  emptyLabel?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
}) {
  const { business } = useBusiness()
  const { data, isLoading } = useEmployees(business.id, { page_size: 100 })
  return (
    <Select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} disabled={isLoading || disabled} className={className}>
      <option value="">{emptyLabel}</option>
      {data?.items.map((e) => (
        <option key={e.id} value={e.id}>
          {e.full_name}
          {e.position ? ` · ${e.position}` : ''}
          {e.status === 'inactive' ? ' (inactive)' : ''}
        </option>
      ))}
    </Select>
  )
}

export function ProfileSelect({
  value,
  onChange,
  types,
  id,
  className,
  emptyLabel = 'Select a page…',
}: {
  value: string
  onChange: (id: string) => void
  types?: ProfileType[] | null
  id?: string
  className?: string
  emptyLabel?: string
}) {
  const { business } = useBusiness()
  const { data, isLoading } = useProfiles(business.id)
  const list = (data ?? []).filter((p) => !types?.length || types.includes(p.type))
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={isLoading} className={className}>
      <option value="">{emptyLabel}</option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title} ({p.type}){!p.published ? ' — unpublished' : ''}
        </option>
      ))}
    </Select>
  )
}

export function BizAppSelect({ value, onChange, id, className }: { value: string; onChange: (id: string) => void; id?: string; className?: string }) {
  const { business } = useBusiness()
  const { data, isLoading } = useBizApps(business.id)
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={isLoading} className={className}>
      <option value="">Select an application…</option>
      {data?.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {!a.endpoint.url ? ' (no endpoint)' : ''}
        </option>
      ))}
    </Select>
  )
}

function PeopleList({ type, current, onPick }: { type: AssigneeType; current: Assignee | null; onPick: (a: Assignee) => void }) {
  const { business } = useBusiness()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 250)
  const emp = useEmployees(business.id, { q: dq, page_size: 50 }, type === 'employee')
  const cus = useCustomers(business.id, { q: dq, page_size: 50 }, type === 'customer')
  const query = type === 'employee' ? emp : cus
  const rows: { id: string; name: string; sub: string | null; photo: string | null; inactive: boolean }[] =
    type === 'employee'
      ? (emp.data?.items ?? []).map((e) => ({ id: e.id, name: e.full_name, sub: [e.position, e.department].filter(Boolean).join(' · ') || e.email, photo: e.photo_url, inactive: e.status === 'inactive' }))
      : (cus.data?.items ?? []).map((c) => ({ id: c.id, name: c.full_name, sub: [c.company, c.email].filter(Boolean).join(' · ') || null, photo: null, inactive: c.status === 'inactive' }))

  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder={type === 'employee' ? 'Search employees by name, email, position…' : 'Search customers by name, email, company…'} />
      <div className="max-h-[50vh] min-h-[200px] overflow-y-auto rounded-lg border border-border">
        {query.error ? (
          <BizErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.isLoading ? (
          <SkeletonRows rows={4} cols={2} />
        ) : !rows.length ? (
          <EmptyState icon={type === 'employee' ? UserRound : Users} title={dq ? 'No matches' : type === 'employee' ? 'No employees yet' : 'No customers yet'} />
        ) : (
          <ul className="divide-y divide-border" role="listbox" aria-label={type === 'employee' ? 'Employees' : 'Customers'}>
            {rows.map((r) => {
              const selected = current?.type === type && current.id === r.id
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onPick({ type, id: r.id, name: r.name, photo_url: r.photo })}
                    className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2', selected && 'bg-accent-soft')}
                  >
                    <Avatar name={r.name} src={r.photo} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[13.5px] font-medium">
                        <span className="truncate">{r.name}</span>
                        {r.inactive && <Badge>Inactive</Badge>}
                      </span>
                      {r.sub && <span className="block truncate text-xs text-subtle">{r.sub}</span>}
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Searchable employee/customer picker used to assign or reassign a card. */
export function AssigneePickerModal({
  open,
  onClose,
  onPick,
  current,
  loading,
  defaultType = 'employee',
}: {
  open: boolean
  onClose: () => void
  onPick: (a: Assignee) => void
  current: Assignee | null
  loading?: boolean
  defaultType?: AssigneeType
}) {
  const [type, setType] = useState<AssigneeType>(current?.type ?? defaultType)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={current ? 'Reassign card' : 'Assign card'}
      description="Pick who holds this card. Taps are attributed to them and “employee profile” actions open their page."
      footer={
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
      }
    >
      <Tabs<AssigneeType>
        className="mb-3"
        value={type}
        onChange={setType}
        tabs={[
          { value: 'employee', label: 'Employees' },
          { value: 'customer', label: 'Customers' },
        ]}
      />
      <PeopleList key={type} type={type} current={current} onPick={onPick} />
    </Modal>
  )
}
