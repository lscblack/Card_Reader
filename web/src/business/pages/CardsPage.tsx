import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Building2, Nfc, Smartphone, Tag } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { dateTime, num, relativeTime } from '@/lib/format'
import type { AssigneeType, Card as NfcCard, CardKind, CardStatus } from '../api/types'
import { useBusiness, useCan } from '../hooks/context'
import { useCards } from '../hooks/queries'
import { assigneeTypeLabel, maskUid } from '../lib/format'
import { Avatar, CardStatusBadge, FilterBar, FilterSelect, LinkBadge, SearchInput } from '../components/bits'
import { BizErrorState } from '../components/BizError'
import { ActionSummary } from '../components/ActionConfigurator'
import { RegisterCardsModal } from '../components/RegisterCardsModal'

const PAGE_SIZE = 20

function CardsTable({ cards, kind }: { cards: NfcCard[]; kind: CardKind }) {
  const { base } = useBusiness()
  const navigate = useNavigate()
  const now = useNow()
  const open = (c: NfcCard) => navigate(`${base}/${kind === 'tag' ? 'tags' : 'cards'}/${c.id}`)
  return (
    <TableWrap>
      <Table className="min-w-[980px]">
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Card ID</TH>
            <TH>{kind === 'tag' ? 'Assigned to' : 'Owner'}</TH>
            <TH>Status</TH>
            <TH>Action</TH>
            <TH>Last tap</TH>
            <TH className="text-right">Total taps</TH>
          </tr>
        </THead>
        <TBody>
          {cards.map((c) => (
            <TR key={c.id} onClick={() => open(c)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(c)}>
              <TD className="max-w-[240px]">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="mt-1 flex">
                  <LinkBadge uid={c.uid} programmed={c.programmed} />
                </span>
              </TD>
              <TD className="font-mono text-[12px] whitespace-nowrap text-muted">{c.uid_masked ?? maskUid(c.uid)}</TD>
              <TD className="max-w-[200px]">
                {c.assignee ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={c.assignee.name} src={c.assignee.photo_url} size={24} />
                    <span className="min-w-0">
                      <span className="block truncate">{c.assignee.name}</span>
                      <span className="flex items-center gap-1 text-[11.5px] text-subtle">
                        {c.assignee.type === 'business' && <Building2 className="h-3 w-3" aria-hidden />}
                        {assigneeTypeLabel(c.assignee.type)}
                      </span>
                    </span>
                  </span>
                ) : (
                  <span className="text-subtle">{kind === 'tag' ? '—' : 'Unassigned'}</span>
                )}
              </TD>
              <TD>
                <CardStatusBadge status={c.effective_status} />
              </TD>
              <TD className="max-w-[220px] text-muted">
                <ActionSummary action={c.action} />
              </TD>
              <TD className="whitespace-nowrap text-muted" title={dateTime(c.last_tap_at)}>
                {c.last_tap_at ? relativeTime(c.last_tap_at, now) : 'Never'}
              </TD>
              <TD className="text-right font-medium tabular-nums">{num(c.total_taps)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  )
}

export default function CardsPage({ kind }: { kind: CardKind }) {
  const { business } = useBusiness()
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const isTag = kind === 'tag'
  useDocumentTitle(isTag ? 'NFC Tags' : 'NFC Cards')
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const [status, setStatus] = useState<CardStatus | ''>('')
  const [assignee, setAssignee] = useState<AssigneeType | 'none' | ''>('')
  const [page, setPage] = useState(1)
  const createOpen = params.get('new') === '1'
  const setCreateOpen = (v: boolean) => setParams(v ? { new: '1' } : {}, { replace: true })
  const filters = { kind, q: dq || undefined, status, assignee_type: assignee, page, page_size: PAGE_SIZE }
  const { data, error, isLoading, isFetching, refetch } = useCards(business.id, filters)
  const filtered = !!(dq || status || assignee)
  const manage = can('cards.manage')
  const noun = isTag ? 'tag' : 'card'

  return (
    <>
      <PageHeader
        title={isTag ? 'NFC Tags' : 'NFC Cards'}
        description={
          isTag
            ? 'Tags live on things — tables, posters, products, doors. Change what they do any time; no reprogramming needed.'
            : 'Cards are held by people or by the company. Register them with the nexTap app, assign them and choose what a tap does.'
        }
        actions={
          manage && (
            <>
              <Button variant="primary" leftIcon={<Smartphone className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                Register {noun}s
              </Button>
            </>
          )
        }
      />
      <Card>
        <FilterBar>
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v)
              setPage(1)
            }}
            placeholder={isTag ? 'Search tags by name or code…' : 'Search by name, holder or UID…'}
            className="sm:w-72"
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
          <FilterSelect
            label="Holder"
            value={assignee}
            onChange={(v) => {
              setAssignee(v)
              setPage(1)
            }}
            options={[
              { value: '', label: 'All holders' },
              { value: 'business', label: `${business.name} (company)` },
              { value: 'employee', label: 'Employees' },
              { value: 'customer', label: 'Customers' },
              { value: 'none', label: 'Unassigned' },
            ]}
          />
          {isFetching && !isLoading && <span className="text-xs text-subtle sm:ml-auto">Updating…</span>}
        </FilterBar>
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={isTag ? Tag : Nfc}
            title={filtered ? `No ${noun}s match your filters` : `No ${noun}s yet`}
            description={
              filtered
                ? 'Try a different search or clear the filters.'
                : isTag
                  ? 'Register tags by tapping them with the nexTap app on a business phone, then choose what they do.'
                  : 'Register cards by tapping them with the nexTap app on a business phone, then hand them to an employee, a customer or keep them as company cards.'
            }
            action={
              filtered ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setQ('')
                    setStatus('')
                    setAssignee('')
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                manage && (
                  <Button size="sm" variant="primary" leftIcon={<Smartphone className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>
                    Register {noun}s
                  </Button>
                )
              )
            }
          />
        ) : (
          <>
            <CardsTable cards={data.items} kind={kind} />
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {manage && <RegisterCardsModal key={kind} open={createOpen} onClose={() => setCreateOpen(false)} kind={kind} />}
    </>
  )
}
