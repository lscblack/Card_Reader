import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, Nfc, Pencil, Save, Tag } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'
import type { Action, Card as NfcCard } from '../api/types'
import { businessApi } from '../api/business'
import { cardsApi } from '../api/cards'
import { useBusiness, useCan } from '../hooks/context'
import { useActionTypes, useBizMutation, useCards } from '../hooks/queries'
import { fieldErrorsOf } from '../lib/errors'
import { actionLabel } from '../lib/format'
import { CUSTOMER_SEES, actionDetail } from '../lib/actionMeta'
import { ActionIcon, CardStatusBadge } from '../components/bits'
import { BizErrorState, FormError } from '../components/BizError'
import { ActionConfigurator, ActionSummary } from '../components/ActionConfigurator'

function DefaultActionCard() {
  const { business } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const current = business.settings.default_card_action
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Action | null>(current)
  const save = useBizMutation(business.id, (a: Action | null) => businessApi.update(business.id, { settings: { default_card_action: a } }))
  const errs = fieldErrorsOf(save.error)
  return (
    <Card>
      <CardHeader
        title="Business default action"
        description="Used by every card and tag that doesn’t have its own action."
        actions={
          can('settings.manage') &&
          !editing && (
            <Button
              size="sm"
              leftIcon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                setDraft(current)
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
            <ActionConfigurator value={draft} onChange={setDraft} allowDefault defaultLabel="Business profile (platform default)" errors={errs} />
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <ActionIcon type={current?.type ?? null} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">{current ? current.label || actionLabel(current.type) : 'Business profile'}</p>
              {actionDetail(current) && <p className="truncate text-[13px] text-muted">{actionDetail(current)}</p>}
              <p className="mt-1 text-[13px] text-muted">{CUSTOMER_SEES[current?.type ?? 'business_profile']}</p>
            </div>
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
                toast.success('Default action saved')
                setEditing(false)
              } catch {
                /* inline */
              }
            }}
          >
            Save default
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function QuickEdit({ card, onClose }: { card: NfcCard; onClose: () => void }) {
  const { business } = useBusiness()
  const toast = useToast()
  const [draft, setDraft] = useState<Action | null>(card.action)
  const save = useBizMutation(business.id, (a: Action | null) => cardsApi.update(business.id, card.id, { action: a }))
  const errs = fieldErrorsOf(save.error)
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Action for ${card.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync(draft)
                toast.success('Action saved')
                onClose()
              } catch {
                /* inline */
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError error={save.error && !Object.keys(errs).length ? save.error : null} />
        <ActionConfigurator value={draft} onChange={setDraft} allowDefault cardId={card.id} errors={errs} />
      </div>
    </Modal>
  )
}

function Group({ type, cards, onEdit, canEdit }: { type: string | null; cards: NfcCard[]; onEdit: (c: NfcCard) => void; canEdit: boolean }) {
  const { base } = useBusiness()
  const types = useActionTypes()
  const [open, setOpen] = useState(cards.length <= 6)
  const def = types.data?.find((t) => t.type === type)
  return (
    <Card>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
          <ActionIcon type={type} className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">{type ? (def?.label ?? actionLabel(type)) : 'Business default'}</span>
          <span className="block truncate text-xs text-subtle">{type ? def?.description : 'Cards and tags without their own action.'}</span>
        </span>
        <Badge>{num(cards.length)}</Badge>
        <ChevronDown className={cn('h-4 w-4 text-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {cards.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              {c.kind === 'tag' ? <Tag className="h-4 w-4 shrink-0 text-subtle" /> : <Nfc className="h-4 w-4 shrink-0 text-subtle" />}
              <div className="min-w-0 flex-1">
                <Link to={`${base}/${c.kind === 'tag' ? 'tags' : 'cards'}/${c.id}`} className="block truncate text-[13.5px] font-medium hover:text-accent hover:underline">
                  {c.name}
                </Link>
                <ActionSummary action={c.action} className="text-xs text-muted" />
              </div>
              <span className="hidden sm:block">
                <CardStatusBadge status={c.effective_status} />
              </span>
              {canEdit && (
                <Button size="sm" variant="ghost" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(c)}>
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function ActionsPage() {
  const { business } = useBusiness()
  const can = useCan()
  useDocumentTitle('Actions')
  const { data, error, isLoading, refetch } = useCards(business.id, { page_size: 100 })
  const [editing, setEditing] = useState<NfcCard | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, NfcCard[]>()
    for (const c of data?.items ?? []) {
      const k = c.action?.type ?? ''
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [data])

  return (
    <>
      <PageHeader
        title="Actions"
        description="What happens when someone taps. No code needed — and changes apply to the next tap without reprogramming any card."
      />
      <div className="space-y-6">
        <DefaultActionCard key={JSON.stringify(business.settings.default_card_action)} />
        <div>
          <h2 className="mb-1 text-[15px] font-semibold">Actions in use</h2>
          <p className="mb-3 text-[13px] text-muted">
            Your cards and tags grouped by what they do{data && data.total > data.items.length ? ` (first ${data.items.length} of ${data.total})` : ''}.
          </p>
          {error ? (
            <Card>
              <BizErrorState error={error} onRetry={() => refetch()} />
            </Card>
          ) : isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Card>
                <SkeletonRows rows={3} cols={3} />
              </Card>
            </div>
          ) : !groups.length ? (
            <Card>
              <EmptyState icon={Nfc} title="No cards or tags yet" description="Create a card or tag and choose what a tap does." />
            </Card>
          ) : (
            <div className="space-y-3">
              {groups.map(([type, cards]) => (
                <Group key={type || 'default'} type={type || null} cards={cards} onEdit={setEditing} canEdit={can('cards.manage')} />
              ))}
            </div>
          )}
        </div>
      </div>
      {editing && <QuickEdit card={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
