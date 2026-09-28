import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Nfc, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { num, relativeTime } from '@/lib/format'
import { BizErrorState } from '@/business/components/BizError'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import type { DigitalCard, PhysicalCard } from '../api/types'
import { chipsApi } from '../api/personal'
import { usePCards, usePChips, usePMutation } from '../hooks/queries'

const formatUid = (uid: string) => uid.match(/.{1,2}/g)?.join(':') ?? uid

/** The person's registered NFC cards: which digital card each one opens, rename, unregister. */
export default function PhysicalCardsPage() {
  useDocumentTitle('Physical cards')
  const chips = usePChips()
  const cards = usePCards()
  const now = useNow()
  const toast = useToast()
  const onError = useErrorToast()
  const update = usePMutation((v: { id: string; card_id?: string; label?: string | null }) => chipsApi.update(v.id, v))
  const remove = usePMutation((id: string) => chipsApi.remove(id))
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<PhysicalCard | null>(null)
  const [removing, setRemoving] = useState<PhysicalCard | null>(null)
  const digital = cards.data ?? []

  return (
    <>
      <PageHeader
        title="Physical cards"
        description="NFC cards you registered. Anyone who taps one with the nexTap app sees the digital card it's linked to."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)} disabled={!digital.length}>
            Add card
          </Button>
        }
      />
      <Card>
        {chips.error ? (
          <BizErrorState error={chips.error} onRetry={() => chips.refetch()} />
        ) : chips.isLoading ? (
          <SkeletonRows rows={3} />
        ) : !chips.data?.length ? (
          <EmptyState
            icon={Nfc}
            title="No physical cards yet"
            description="Tap a blank NFC card with the nexTap app while signed in to My Card, then press “Register as my card”. You can also add one here by its card ID."
          />
        ) : (
          <ul className="divide-y divide-border">
            {chips.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate font-medium">{c.label ?? 'Card'}</p>
                  <p className="font-mono text-[12px] text-muted">{formatUid(c.uid)}</p>
                  <p className="mt-0.5 text-[12px] text-subtle">
                    {num(c.taps)} tap{c.taps === 1 ? '' : 's'} · {c.last_tap_at ? `last ${relativeTime(c.last_tap_at, now)}` : 'never tapped'}
                  </p>
                </div>
                <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
                  <span className="shrink-0 text-[13px] text-muted">Opens</span>
                  <Select
                    aria-label={`Digital card opened by ${c.label ?? 'this card'}`}
                    value={c.digital_card_id}
                    disabled={update.isPending}
                    onChange={(e) =>
                      update
                        .mutateAsync({ id: c.id, card_id: e.target.value })
                        .then((r) => toast.success(`${r.label ?? 'Card'} now opens “${r.digital_card_label ?? 'your card'}”.`))
                        .catch(onError)
                    }
                  >
                    {digital.map((d: DigitalCard) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                        {d.is_primary ? ' (primary)' : ''}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon-sm" variant="ghost" aria-label={`Rename ${c.label ?? 'card'}`} title="Rename" onClick={() => setRenaming(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.label ?? 'card'}`} title="Delete" onClick={() => setRemoving(c)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!cards.isLoading && !digital.length && (
        <p className="mt-3 text-[13px] text-muted">
          Create a <Link to="/me/cards" className="font-medium text-accent hover:underline">digital card</Link> first — a physical card opens one of them.
        </p>
      )}

      <AddCardModal
        open={adding}
        cards={digital}
        onClose={() => setAdding(false)}
        onDone={(c) => toast.success(`${c.label ?? 'Card'} registered.`)}
      />
      <RenameModal
        chip={renaming}
        onClose={() => setRenaming(null)}
        onSave={(label) => update.mutateAsync({ id: renaming!.id, label: label || null }).then(() => setRenaming(null))}
      />
      <ConfirmDialog
        open={removing != null}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          remove
            .mutateAsync(removing.id)
            .then(() => {
              toast.success('Card deleted.')
              setRemoving(null)
            })
            .catch(onError)
        }
        loading={remove.isPending}
        danger
        title="Delete this physical card?"
        description="Tapping it will no longer open your digital card. You can register it again later from the app or here."
        confirmLabel="Delete"
      />
    </>
  )
}

function AddCardModal({ open, cards, onClose, onDone }: { open: boolean; cards: DigitalCard[]; onClose: () => void; onDone: (c: PhysicalCard) => void }) {
  const onError = useErrorToast()
  const create = usePMutation((v: { uid: string; card_id?: string; label?: string }) => chipsApi.create(v))
  const [uid, setUid] = useState('')
  const [label, setLabel] = useState('')
  const [cardId, setCardId] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setUid('')
      setLabel('')
      setCardId((cards.find((c) => c.is_primary) ?? cards[0])?.id ?? '')
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create
      .mutateAsync({ uid: uid.trim(), card_id: cardId || undefined, label: label.trim() || undefined })
      .then((c) => {
        onDone(c)
        onClose()
      })
      .catch(onError)
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a physical card"
      description="Easiest from the app: tap the card and press “Register as my card”. Here you type its card ID."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-chip-form" loading={create.isPending} disabled={!uid.trim()}>
            Add card
          </Button>
        </>
      }
    >
      <form id="add-chip-form" onSubmit={submit} className="space-y-4">
        <Field label="Card ID" hint="Shown by the app when you tap the card, e.g. 04:A1:B2:C3:D4:E5">
          {(p) => <Input {...p} value={uid} onChange={(e) => setUid(e.target.value)} placeholder="04:A1:B2:C3:D4:E5" className="font-mono" autoFocus />}
        </Field>
        <Field label="Opens">
          {(p) => (
            <Select {...p} value={cardId} onChange={(e) => setCardId(e.target.value)}>
              {cards.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                  {d.is_primary ? ' (primary)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name" optional hint="e.g. Keyring, Wallet card">
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />}
        </Field>
      </form>
    </Modal>
  )
}

function RenameModal({ chip, onClose, onSave }: { chip: PhysicalCard | null; onClose: () => void; onSave: (label: string) => Promise<unknown> }) {
  const onError = useErrorToast()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [shownFor, setShownFor] = useState<string | null>(null)
  if ((chip?.id ?? null) !== shownFor) {
    setShownFor(chip?.id ?? null)
    setLabel(chip?.label ?? '')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    onSave(label.trim())
      .catch(onError)
      .finally(() => setBusy(false))
  }
  return (
    <Modal
      open={chip != null}
      onClose={onClose}
      title="Rename card"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rename-chip-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="rename-chip-form" onSubmit={submit}>
        <Field label="Name">
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} autoFocus />}
        </Field>
      </form>
    </Modal>
  )
}
