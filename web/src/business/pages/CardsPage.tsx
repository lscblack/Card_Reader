import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { CheckCircle2, CircleDashed, Layers, Nfc, Plus, Tag } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Input'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/toastContext'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { dateTime, num, relativeTime } from '@/lib/format'
import type { Action, AssigneeType, Card as NfcCard, CardKind, CardStatus } from '../api/types'
import { cardsApi } from '../api/cards'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, useCards } from '../hooks/queries'
import { fieldErrorsOf, formLevelError } from '../lib/errors'
import { maskUid } from '../lib/format'
import { Avatar, CardStatusBadge, FilterBar, FilterSelect, SearchInput } from '../components/bits'
import { BizErrorState, FormError } from '../components/BizError'
import { ActionConfigurator, ActionSummary } from '../components/ActionConfigurator'

const PAGE_SIZE = 20

function CreateCardModal({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: CardKind }) {
  const { business, base } = useBusiness()
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [uid, setUid] = useState('')
  const [action, setAction] = useState<Action | null>(null)
  const create = useBizMutation(business.id, () =>
    cardsApi.create(business.id, { kind, name: name.trim(), uid: uid.trim() || undefined, action }),
  )
  const errs = fieldErrorsOf(create.error)
  const noun = kind === 'tag' ? 'tag' : 'card'
  const close = () => {
    setName('')
    setUid('')
    setAction(null)
    create.reset()
    onClose()
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const c = await create.mutateAsync(undefined)
      toast.success(`“${c.name}” created. Program it with the NFC Terminal app.`, `${kind === 'tag' ? 'Tag' : 'Card'} created`)
      close()
      navigate(`${base}/${kind === 'tag' ? 'tags' : 'cards'}/${c.id}`)
    } catch {
      /* shown inline */
    }
  }
  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={`New NFC ${noun}`}
      description={kind === 'tag' ? 'A tag is placed on a thing — a table, poster, product or door.' : 'A card is held by a person — an employee or a customer.'}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-card" loading={create.isPending} disabled={!name.trim()}>
            Create {noun}
          </Button>
        </>
      }
    >
      <form id="create-card" onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={formLevelError(create.error, ['name', 'uid'])} />
        <Field label="Name" error={errs.name} hint={kind === 'tag' ? 'e.g. “Table 4” or “Front window poster”.' : 'e.g. “John’s card”.'}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-autofocus />}
        </Field>
        <Field
          label="Card UID"
          optional
          error={errs.uid}
          hint="Leave empty — the UID is captured automatically when you program the card with the app."
        >
          {(p) => <Input {...p} value={uid} onChange={(e) => setUid(e.target.value.toUpperCase())} placeholder="04A1B2C3D4E5" className="font-mono" maxLength={80} />}
        </Field>
        <div className="space-y-2">
          <p className="text-[13px] font-medium">What happens when someone taps it</p>
          <ActionConfigurator value={action} onChange={setAction} allowDefault errors={errs} />
        </div>
      </form>
    </Modal>
  )
}

function BulkModal({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: CardKind }) {
  const { business } = useBusiness()
  const toast = useToast()
  const [count, setCount] = useState('25')
  const [prefix, setPrefix] = useState(kind === 'tag' ? 'Tag' : 'Card')
  const n = Number(count)
  const valid = Number.isInteger(n) && n >= 1 && n <= 500
  const bulk = useBizMutation(business.id, () => cardsApi.bulk(business.id, { count: n, kind, name_prefix: prefix.trim() || (kind === 'tag' ? 'Tag' : 'Card') }))
  const close = () => {
    bulk.reset()
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title={`Bulk create ${kind === 'tag' ? 'tags' : 'cards'}`}
      description="Creates unprogrammed, unassigned items for a printing batch. Program each with the app, then assign them."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            loading={bulk.isPending}
            disabled={!valid}
            onClick={async () => {
              try {
                await bulk.mutateAsync(undefined)
                toast.success(`${n} ${kind === 'tag' ? 'tags' : 'cards'} created.`)
                close()
              } catch {
                /* inline */
              }
            }}
          >
            Create {valid ? n : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={bulk.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How many" hint="1 to 500." error={count && !valid ? 'Enter a number between 1 and 500.' : null}>
            {(p) => <Input {...p} type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} data-autofocus />}
          </Field>
          <Field label="Name prefix" hint={`Named “${prefix || 'Card'} 001”, “${prefix || 'Card'} 002”…`}>
            {(p) => <Input {...p} value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={60} />}
          </Field>
        </div>
      </div>
    </Modal>
  )
}

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
                <span className="mt-0.5 flex items-center gap-1 text-xs text-subtle">
                  {c.programmed ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Programmed
                    </>
                  ) : (
                    <>
                      <CircleDashed className="h-3 w-3" /> Not programmed
                    </>
                  )}
                </span>
              </TD>
              <TD className="font-mono text-[12px] whitespace-nowrap text-muted">{c.uid_masked ?? maskUid(c.uid)}</TD>
              <TD className="max-w-[200px]">
                {c.assignee ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={c.assignee.name} src={c.assignee.photo_url} size={24} />
                    <span className="min-w-0">
                      <span className="block truncate">{c.assignee.name}</span>
                      <span className="block text-[11.5px] text-subtle capitalize">{c.assignee.type}</span>
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
  const [bulkOpen, setBulkOpen] = useState(false)
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
            : 'Cards are held by people. Assign them to employees or customers and choose what a tap does.'
        }
        actions={
          manage && (
            <>
              <Button leftIcon={<Layers className="h-4 w-4" />} onClick={() => setBulkOpen(true)}>
                Bulk create
              </Button>
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                New {noun}
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
          {!isTag && (
            <FilterSelect
              label="Holder"
              value={assignee}
              onChange={(v) => {
                setAssignee(v)
                setPage(1)
              }}
              options={[
                { value: '', label: 'All holders' },
                { value: 'employee', label: 'Employees' },
                { value: 'customer', label: 'Customers' },
                { value: 'none', label: 'Unassigned' },
              ]}
            />
          )}
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
                  ? 'Create a tag for a table, poster or product, then program it with the NFC Terminal app.'
                  : 'Create a card, program it with the NFC Terminal app, and hand it to an employee or customer.'
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
                  <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>
                    New {noun}
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
      {manage && <CreateCardModal key={kind} open={createOpen} onClose={() => setCreateOpen(false)} kind={kind} />}
      {manage && bulkOpen && <BulkModal open onClose={() => setBulkOpen(false)} kind={kind} />}
    </>
  )
}
