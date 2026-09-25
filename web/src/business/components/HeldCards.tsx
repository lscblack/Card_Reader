import { useState } from 'react'
import { Link } from 'react-router'
import { Nfc, Plus } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import type { Assignee, CardSummary } from '../api/types'
import { cardsApi } from '../api/cards'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, useCards } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { CardStatusBadge } from './bits'
import { BizErrorState } from './BizError'

/** List of cards held by a person + an "assign an unassigned card" picker. Shared with customers. */
export function HeldCards({ cards, assignee, kindPath = 'cards' }: { cards: CardSummary[]; assignee: Assignee; kindPath?: string }) {
  const { business, base } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const onError = useErrorToast()
  const [picking, setPicking] = useState(false)
  const free = useCards(business.id, { kind: 'card', assignee_type: 'none', page_size: 50 }, picking)
  const assign = useBizMutation(business.id, (cid: string) => cardsApi.assign(business.id, cid, assignee.type, assignee.id))
  return (
    <Card>
      <CardHeader
        title="Cards"
        description={`${cards.length} assigned`}
        actions={
          can('cards.manage') && (
            <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setPicking(true)}>
              Assign card
            </Button>
          )
        }
      />
      {cards.length === 0 ? (
        <EmptyState icon={Nfc} title="No cards yet" description="Assign an unassigned card, or create one from NFC Cards." />
      ) : (
        <ul className="divide-y divide-border">
          {cards.map((c) => (
            <li key={c.id}>
              <Link to={`${base}/${c.kind === 'tag' ? 'tags' : kindPath}/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/70 sm:px-5">
                <Nfc className="h-4 w-4 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{c.name}</span>
                  <span className="block font-mono text-[11.5px] text-subtle">{c.uid_masked ?? 'Not programmed'}</span>
                </span>
                <CardStatusBadge status={c.effective_status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Modal open={picking} onClose={() => setPicking(false)} title={`Assign a card to ${assignee.name}`} description="Pick one of your unassigned cards.">
        {free.error ? (
          <BizErrorState error={free.error} onRetry={() => free.refetch()} />
        ) : free.isLoading ? (
          <SkeletonRows rows={4} cols={2} />
        ) : !free.data?.items.length ? (
          <EmptyState
            icon={Nfc}
            title="No unassigned cards"
            description="Create a new card (or a bulk batch) first."
            action={
              <Link to={`${base}/cards?new=1`}>
                <Button size="sm" variant="primary">
                  New card
                </Button>
              </Link>
            }
          />
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {free.data.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={assign.isPending}
                  onClick={async () => {
                    try {
                      await assign.mutateAsync(c.id)
                      toast.success(`${c.name} assigned to ${assignee.name}`)
                      setPicking(false)
                    } catch (e) {
                      onError(e)
                    }
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-60"
                >
                  <Nfc className="h-4 w-4 text-subtle" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{c.name}</span>
                  <span className="text-xs text-subtle">{c.programmed ? 'Programmed' : 'Not programmed'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </Card>
  )
}
