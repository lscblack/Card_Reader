import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Pencil, Plus, Trash2 } from 'lucide-react'
import type { AppCard, Application } from '@/api/types'
import { applicationsApi } from '@/api/applications'
import { useNow } from '@/hooks/useNow'
import { num, relativeTime } from '@/lib/format'
import { Card, CardHeader } from './ui/Card'
import { Button } from './ui/Button'
import { Field, Input } from './ui/Input'
import { ConfirmDialog, Modal } from './ui/Modal'
import { EmptyState, ErrorState } from './ui/EmptyState'
import { SkeletonRows } from './ui/Spinner'
import { useToast } from './ui/toastContext'

const formatUid = (uid: string) => uid.match(/.{1,2}/g)?.join(':') ?? uid

/**
 * Cards registered to a developer application: from the phone ("Register this card" after a tap) or by UID here.
 * Taps of a registered card carry its name in the live view and on the phone.
 */
export function AppCardsTab({ app }: { app: Application }) {
  const qc = useQueryClient()
  const toast = useToast()
  const now = useNow()
  const key = ['app-cards', app.id]
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => applicationsApi.listCards(app.id) })
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<AppCard | null>(null)
  const [removing, setRemoving] = useState<AppCard | null>(null)

  const remove = useMutation({
    mutationFn: (c: AppCard) => applicationsApi.deleteCard(app.id, c.id),
    onSuccess: () => {
      toast.success('Card unregistered.')
      setRemoving(null)
      void refresh()
    },
    onError: (e) => toast.fromError(e),
  })

  return (
    <Card>
      <CardHeader
        title="Cards"
        description="Physical cards registered to this application. Register one from the phone after tapping it, or add it by its card ID."
        actions={
          <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
            Add card
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={3} />
      ) : !data?.length ? (
        <EmptyState
          icon={CreditCard}
          title="No cards yet"
          description="Tap a card on a phone paired with this application, then press “Register this card”."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border text-[12px] text-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Card ID</th>
                <th className="px-3 py-2 text-right font-medium">Taps</th>
                <th className="px-3 py-2 font-medium">Last tap</th>
                <th className="px-3 py-2 font-medium">Registered</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-2.5 font-medium">{c.label ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-muted">{formatUid(c.uid)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(c.taps)}</td>
                  <td className="px-3 py-2.5 text-muted">{c.last_tap_at ? relativeTime(c.last_tap_at, now) : 'Never'}</td>
                  <td className="px-3 py-2.5 text-muted">{relativeTime(c.created_at, now)}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label={`Rename ${c.label ?? 'card'}`} title="Rename" onClick={() => setEditing(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Unregister ${c.label ?? 'card'}`} title="Unregister" onClick={() => setRemoving(c)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CardFormModal
        open={adding}
        title="Add a card"
        withUid
        onClose={() => setAdding(false)}
        onSubmit={async ({ uid, label }) => {
          await applicationsApi.createCard(app.id, { uid, label: label || undefined })
          toast.success('Card registered.')
          void refresh()
        }}
      />
      <CardFormModal
        open={editing != null}
        title="Rename card"
        initialLabel={editing?.label ?? ''}
        onClose={() => setEditing(null)}
        onSubmit={async ({ label }) => {
          if (editing) await applicationsApi.updateCard(app.id, editing.id, { label: label || null })
          void refresh()
        }}
      />
      <ConfirmDialog
        open={removing != null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
        danger
        title="Unregister this card?"
        description="Its taps keep working and stay in the event log; the card just loses its name here. It can be registered again later."
        confirmLabel="Unregister"
      />
    </Card>
  )
}

function CardFormModal({
  open,
  title,
  withUid = false,
  initialLabel = '',
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  withUid?: boolean
  initialLabel?: string
  onClose: () => void
  onSubmit: (v: { uid: string; label: string }) => Promise<void>
}) {
  const toast = useToast()
  const [uid, setUid] = useState('')
  const [label, setLabel] = useState(initialLabel)
  const [busy, setBusy] = useState(false)
  const [shownFor, setShownFor] = useState<string | null>(null)
  // reset the fields each time the modal opens
  const openKey = open ? `${title}|${initialLabel}` : null
  if (openKey !== shownFor) {
    setShownFor(openKey)
    if (openKey) {
      setUid('')
      setLabel(initialLabel)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await onSubmit({ uid: uid.trim(), label: label.trim() })
      onClose()
    } catch (err) {
      toast.fromError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="app-card-form" loading={busy} disabled={withUid && !uid.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="app-card-form" onSubmit={submit} className="space-y-4">
        {withUid && (
          <Field label="Card ID" hint="The chip UID shown on the phone after a tap, e.g. 04:A1:B2:C3:D4:E5">
            {(p) => <Input {...p} value={uid} onChange={(e) => setUid(e.target.value)} placeholder="04:A1:B2:C3:D4:E5" className="font-mono" autoFocus />}
          </Field>
        )}
        <Field label="Name" optional hint="e.g. who carries it.">
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Alice badge" autoFocus={!withUid} />}
        </Field>
      </form>
    </Modal>
  )
}
