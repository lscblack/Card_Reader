import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  History,
  Nfc,
  Pencil,
  Power,
  Save,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import { Menu } from '@/components/ui/Menu'
import { Alert } from '@/components/ui/Alert'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { dateTime, num, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Action, AnalyticsRange, Assignee, Card as NfcCard, CardTap } from '../api/types'
import { cardsApi } from '../api/cards'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, useCard, useCardHistory, useCardStats, useCardTaps } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { fieldErrorsOf } from '../lib/errors'
import { CHART } from '../lib/chart'
import { DEVICE_TYPE_LABEL, EFFECTIVE_STATUS, countryName, describeHistory, maskUid } from '../lib/format'
import { Avatar, CardStatusBadge, DetailRow, KindBadge, PageSkeleton } from '../components/bits'
import { BizErrorState, FormError } from '../components/BizError'
import { ActionConfigurator, ActionSummary } from '../components/ActionConfigurator'
import { AssigneePickerModal, ProfileSelect } from '../components/Pickers'
import { RangePicker, UrlQrPanel } from '../components/inputs'
import { BarList, TimelineChart } from '../components/charts'
import { TapDetailDrawer, TapsTable } from '../components/Taps'

type Tab = 'activity' | 'taps' | 'history'

/** Physical-card visual + the key facts from the product brief. */
function CardFace({ card }: { card: NfcCard }) {
  const { business } = useBusiness()
  const now = useNow()
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[minmax(0,300px)_1fr]">
        <div className="flex items-center justify-center bg-surface-2/60 p-5 md:border-r md:border-border">
          <div
            className="relative aspect-[1.586] w-full max-w-[280px] overflow-hidden rounded-2xl bg-gradient-to-br from-[#7f1d1d] via-[#b91c1c] to-[#450a0a] p-4 text-white shadow-lg ring-1 ring-black/10"
            aria-label="Card preview"
          >
            <div className="absolute -top-10 -right-10 h-36 w-36 rounded-full bg-white/10" aria-hidden="true" />
            <div className="flex items-start justify-between">
              <span className="max-w-[70%] truncate text-[12px] font-semibold tracking-wide uppercase opacity-90">{business.name}</span>
              <Nfc className="h-6 w-6 opacity-90" aria-hidden="true" />
            </div>
            <div className="absolute inset-x-4 bottom-4">
              <p className="truncate text-[15px] font-semibold">{card.assignee?.name ?? card.name}</p>
              <p className="mt-0.5 font-mono text-[11px] tracking-widest opacity-80">{card.uid_masked ?? maskUid(card.uid)}</p>
            </div>
          </div>
        </div>
        <dl className="divide-y divide-border px-4 py-1 sm:px-5">
          <DetailRow label="Name">{card.name}</DetailRow>
          <DetailRow label="Card ID">
            <span className="font-mono text-[12.5px]">{card.uid_masked ?? maskUid(card.uid)}</span>
            {!card.uid && <span className="ml-2 text-xs text-subtle">captured when programmed</span>}
          </DetailRow>
          <DetailRow label={card.kind === 'tag' ? 'Assigned to' : 'Owner'}>
            {card.assignee ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={card.assignee.name} src={card.assignee.photo_url} size={22} />
                {card.assignee.name}
                <span className="text-xs text-subtle capitalize">· {card.assignee.type}</span>
              </span>
            ) : (
              <span className="text-subtle">Unassigned</span>
            )}
          </DetailRow>
          <DetailRow label="Status">
            <span className="inline-flex flex-wrap items-center gap-2">
              <CardStatusBadge status={card.effective_status} />
              {card.effective_status !== 'active' && <span className="text-xs text-subtle">{EFFECTIVE_STATUS[card.effective_status]?.hint}</span>}
            </span>
          </DetailRow>
          <DetailRow label="Action">
            <ActionSummary action={card.action} fallback="Business default" />
          </DetailRow>
          <DetailRow label="Last tap">
            <span title={dateTime(card.last_tap_at)}>{card.last_tap_at ? relativeTime(card.last_tap_at, now) : 'Never'}</span>
          </DetailRow>
          <DetailRow label="Total taps">
            <span className="font-semibold tabular-nums">{num(card.total_taps)}</span>
            <span className="ml-2 text-xs text-subtle">{num(card.unique_visitors)} unique visitors</span>
          </DetailRow>
        </dl>
      </div>
    </Card>
  )
}

function ActionCard({ card }: { card: NfcCard }) {
  const { business } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Action | null>(card.action)
  const save = useBizMutation(business.id, (a: Action | null) => cardsApi.update(business.id, card.id, { action: a }))
  const errs = fieldErrorsOf(save.error)
  return (
    <Card>
      <CardHeader
        title="What happens on tap"
        description="Change it any time — the card never needs reprogramming."
        actions={
          can('cards.manage') &&
          !editing && (
            <Button
              size="sm"
              leftIcon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                setDraft(card.action)
                save.reset()
                setEditing(true)
              }}
            >
              Change
            </Button>
          )
        }
      />
      <CardBody>
        {editing ? (
          <div className="space-y-3">
            <FormError error={save.error && !Object.keys(errs).length ? save.error : null} />
            <ActionConfigurator value={draft} onChange={setDraft} allowDefault cardId={card.id} errors={errs} />
          </div>
        ) : (
          <div className="space-y-2">
            <ActionSummary action={card.action} fallback="Business default (set in Actions)" className="text-[14px] font-medium" />
          </div>
        )}
      </CardBody>
      {editing && (
        <CardFooter>
          <Button onClick={() => setEditing(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            leftIcon={<Save className="h-4 w-4" />}
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync(draft)
                toast.success('Action saved. It applies to the next tap.')
                setEditing(false)
              } catch {
                /* inline */
              }
            }}
          >
            Save action
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function AssignmentCard({ card }: { card: NfcCard }) {
  const { business, base } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const onError = useErrorToast()
  const [picking, setPicking] = useState(false)
  const assign = useBizMutation(business.id, (a: Assignee) => cardsApi.assign(business.id, card.id, a.type, a.id))
  const unassign = useBizMutation(business.id, () => cardsApi.unassign(business.id, card.id))
  const setProfile = useBizMutation(business.id, (pid: string | null) => cardsApi.update(business.id, card.id, { profile_id: pid }))
  const manage = can('cards.manage')
  return (
    <Card>
      <CardHeader title="Assignment" description={card.kind === 'tag' ? 'Optionally link this tag to a person.' : 'Who holds this card.'} />
      <CardBody className="space-y-4">
        {card.assignee ? (
          <div className="flex items-center gap-3">
            <Avatar name={card.assignee.name} src={card.assignee.photo_url} size={40} />
            <div className="min-w-0 flex-1">
              <Link to={`${base}/${card.assignee.type === 'employee' ? 'employees' : 'customers'}/${card.assignee.id}`} className="block truncate font-medium hover:text-accent hover:underline">
                {card.assignee.name}
              </Link>
              <p className="text-xs text-subtle capitalize">{card.assignee.type}</p>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted">Not assigned. Taps run the card’s action (or the business default).</p>
        )}
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={card.assignee ? 'secondary' : 'primary'} leftIcon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setPicking(true)}>
              {card.assignee ? 'Reassign' : 'Assign'}
            </Button>
            {card.assignee && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<UserMinus className="h-3.5 w-3.5" />}
                loading={unassign.isPending}
                onClick={async () => {
                  try {
                    await unassign.mutateAsync(undefined)
                    toast.success('Card unassigned')
                  } catch (e) {
                    onError(e)
                  }
                }}
              >
                Unassign
              </Button>
            )}
          </div>
        )}
        <div className="border-t border-border pt-4">
          <Field label="Linked profile" optional hint="Used by profile-based actions when no specific page is chosen.">
            {(p) => (
              <ProfileSelect
                id={p.id}
                value={card.profile_id ?? ''}
                emptyLabel="None (business profile)"
                onChange={async (v) => {
                  if (!manage) return
                  try {
                    await setProfile.mutateAsync(v || null)
                    toast.success('Linked profile updated')
                  } catch (e) {
                    onError(e)
                  }
                }}
              />
            )}
          </Field>
        </div>
      </CardBody>
      <AssigneePickerModal
        open={picking}
        onClose={() => setPicking(false)}
        current={card.assignee}
        loading={assign.isPending}
        onPick={async (a) => {
          try {
            await assign.mutateAsync(a)
            toast.success(`Assigned to ${a.name}`)
            setPicking(false)
          } catch (e) {
            onError(e)
          }
        }}
      />
    </Card>
  )
}

function ActivityTab({ card }: { card: NfcCard }) {
  const { business } = useBusiness()
  const [range, setRange] = useState<AnalyticsRange>('30d')
  const { data, error, isLoading, refetch, isFetching } = useCardStats(business.id, card.id, range)
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Usage"
          description={data ? `${num(data.total_taps)} taps · ${num(data.unique_visitors)} unique visitors` : 'Taps over time'}
          actions={<RangePicker value={range} onChange={setRange} />}
        />
        <CardBody className={cn(isFetching && !isLoading && 'opacity-70 transition-opacity')}>
          {error ? (
            <BizErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading || !data ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <TimelineChart
              data={data.timeline}
              label={`Daily taps and unique visitors for ${card.name}`}
              series={[
                { key: 'taps', label: 'Taps', color: CHART.primary },
                { key: 'unique_visitors', label: 'Unique visitors', color: CHART.secondary },
              ]}
            />
          )}
        </CardBody>
      </Card>
      {data && (
        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader title="By source" />
            <CardBody>
              <BarList items={data.by_source.map((s) => ({ key: s.source, label: s.source === 'web' ? 'Customer phones (web)' : 'Readers', value: s.taps }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Device types" />
            <CardBody>
              <BarList items={data.by_device_type.filter((s) => s.device_type).map((s) => ({ key: s.device_type, label: DEVICE_TYPE_LABEL[s.device_type] ?? s.device_type, value: s.taps }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Countries" />
            <CardBody>
              <BarList items={data.by_country.filter((s) => s.country).map((s) => ({ key: s.country, label: countryName(s.country), value: s.taps }))} empty="No country data (only recorded behind a trusted proxy)." />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}

function TapsTab({ card }: { card: NfcCard }) {
  const { business } = useBusiness()
  const [page, setPage] = useState(1)
  const [tap, setTap] = useState<CardTap | null>(null)
  const { data, error, isLoading, refetch } = useCardTaps(business.id, card.id, page)
  return (
    <Card>
      {error ? (
        <BizErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={6} cols={5} />
      ) : !data?.items.length ? (
        <EmptyState icon={Nfc} title="No taps yet" description="Taps from customer phones and your readers will appear here." />
      ) : (
        <>
          <TapsTable taps={data.items} showCard={false} onOpen={setTap} />
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
      <TapDetailDrawer tap={tap} onClose={() => setTap(null)} />
    </Card>
  )
}

function HistoryTab({ card }: { card: NfcCard }) {
  const { business } = useBusiness()
  const { data, error, isLoading, refetch } = useCardHistory(business.id, card.id)
  return (
    <Card>
      <CardBody>
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={4} cols={2} />
        ) : !data?.length ? (
          <EmptyState icon={History} title="No history yet" />
        ) : (
          <ol className="relative space-y-5 border-l border-border pl-5">
            {data.map((h) => (
              <li key={h.id} className="relative">
                <span className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full bg-accent-solid ring-4 ring-surface" aria-hidden="true" />
                <p className="text-[13.5px] font-medium">{describeHistory(h)}</p>
                <p className="text-xs text-subtle">
                  {h.actor ? `${h.actor.name ?? (h.actor.type === 'device' ? 'A device' : 'Someone')}${h.actor.type === 'device' && h.actor.name ? ' (device)' : ''} · ` : ''}
                  {dateTime(h.created_at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}

export default function CardDetailPage() {
  const { cardId } = useParams()
  const { business, base } = useBusiness()
  const loc = useLocation()
  const isTagRoute = loc.pathname.includes('/tags/')
  const listPath = `${base}/${isTagRoute ? 'tags' : 'cards'}`
  const can = useCan()
  const navigate = useNavigate()
  const toast = useToast()
  const onError = useErrorToast()
  const { data: card, error, isLoading, refetch } = useCard(business.id, cardId)
  useDocumentTitle(card?.name ?? 'Card')
  const [tab, setTab] = useState<Tab>('activity')
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const toggle = useBizMutation(business.id, (activate: boolean) => (activate ? cardsApi.activate(business.id, cardId!) : cardsApi.deactivate(business.id, cardId!)))
  const del = useBizMutation(business.id, () => cardsApi.remove(business.id, cardId!))
  const rename = useBizMutation(business.id, (n: string) => cardsApi.update(business.id, cardId!, { name: n }))
  const manage = can('cards.manage')

  const back = (
    <Link to={listPath} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
      <ArrowLeft className="h-3.5 w-3.5" /> {isTagRoute ? 'NFC Tags' : 'NFC Cards'}
    </Link>
  )
  if (error) {
    return (
      <>
        {back}
        <Card>
          <BizErrorState error={error} onRetry={() => refetch()} />
        </Card>
      </>
    )
  }
  if (isLoading || !card) {
    return (
      <>
        {back}
        <PageSkeleton />
      </>
    )
  }

  const noun = card.kind === 'tag' ? 'tag' : 'card'
  return (
    <>
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="min-w-0 break-words">{card.name}</span>
            <KindBadge kind={card.kind} />
            <CardStatusBadge status={card.effective_status} />
          </span>
        }
        description={
          <span className="inline-flex items-center gap-1.5">
            {card.programmed ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Programmed {card.programmed_at ? relativeTime(card.programmed_at) : ''}
              </>
            ) : (
              <>
                <CircleDashed className="h-3.5 w-3.5" /> Not programmed yet
              </>
            )}
            <span className="text-subtle">· created {dateTime(card.created_at)}</span>
          </span>
        }
        actions={
          manage && (
            <>
              <Button
                leftIcon={<Power className="h-4 w-4" />}
                variant={card.status === 'active' ? 'danger-soft' : 'primary'}
                loading={toggle.isPending}
                onClick={async () => {
                  if (card.status === 'active') return setConfirm('deactivate')
                  try {
                    await toggle.mutateAsync(true)
                    toast.success(`${card.name} activated`)
                  } catch (e) {
                    onError(e)
                  }
                }}
              >
                {card.status === 'active' ? 'Deactivate' : 'Activate'}
              </Button>
              <Menu
                items={[
                  {
                    label: 'Rename',
                    icon: <Pencil className="h-4 w-4 text-subtle" />,
                    onSelect: () => {
                      setName(card.name)
                      setRenaming(true)
                    },
                  },
                  { label: `Delete ${noun}`, icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setConfirm('delete') },
                ]}
              />
            </>
          )
        }
      />

      <div className="space-y-6">
        {card.effective_status === 'inactive_owner' && (
          <Alert tone="warning" title="Disabled because the holder is inactive">
            {card.assignee?.name} is deactivated, so this card shows a neutral page. Reactivate the employee or reassign the card.
          </Alert>
        )}
        {!card.programmed && (
          <Alert tone="info" title="Program this card with the NFC Terminal app">
            On a paired business phone open <strong>Program card</strong>, search for “{card.name}” and hold the card to the phone. The app writes the
            tap link below to the chip and records its UID.
          </Alert>
        )}
        <CardFace card={card} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Tap link" description="Written to the chip. Customers’ phones open it when they tap." />
            <CardBody>
              <UrlQrPanel url={card.tap_url} label={card.name} filename={`${card.name.replace(/[^\w-]+/g, '-')}-qr`} hint="The QR code opens the same link — handy for printing next to a tag." />
            </CardBody>
          </Card>
          <AssignmentCard card={card} />
        </div>
        <ActionCard key={JSON.stringify(card.action)} card={card} />

        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'activity', label: 'Usage' },
            { value: 'taps', label: 'Taps', count: card.total_taps },
            { value: 'history', label: 'History' },
          ]}
        />
        {tab === 'activity' && <ActivityTab card={card} />}
        {tab === 'taps' && <TapsTab card={card} />}
        {tab === 'history' && <HistoryTab card={card} />}
      </div>

      <ConfirmDialog
        open={confirm === 'deactivate'}
        onClose={() => setConfirm(null)}
        title={`Deactivate ${card.name}?`}
        description={`Taps will immediately show a neutral “not available” page instead of running the action. You can reactivate the ${noun} at any time.`}
        confirmLabel="Deactivate"
        loading={toggle.isPending}
        onConfirm={async () => {
          try {
            await toggle.mutateAsync(false)
            toast.success(`${card.name} deactivated`)
            setConfirm(null)
          } catch (e) {
            onError(e)
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={`Delete ${card.name}?`}
        description={`The ${noun} stops working immediately and its tap history is kept only in aggregate analytics. This can’t be undone.`}
        confirmLabel={`Delete ${noun}`}
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(undefined)
            toast.success(`${card.name} deleted`)
            navigate(listPath, { replace: true })
          } catch (e) {
            onError(e)
          }
        }}
      />
      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title={`Rename ${noun}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button
              variant="primary"
              type="submit"
              form="rename-card"
              loading={rename.isPending}
              disabled={!name.trim() || name.trim() === card.name}
            >
              Save
            </Button>
          </>
        }
      >
        <form
          id="rename-card"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await rename.mutateAsync(name.trim())
              toast.success('Renamed')
              setRenaming(false)
            } catch (err) {
              onError(err)
            }
          }}
        >
          <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-autofocus />}</Field>
        </form>
      </Modal>
    </>
  )
}
