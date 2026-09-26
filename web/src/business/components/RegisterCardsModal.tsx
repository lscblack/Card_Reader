import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, CheckCircle2, Nfc, PenLine, QrCode as QrIcon, ScanLine, Smartphone, UserPlus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Field, Input } from '@/components/ui/Input'
import { PairPhoneModal } from '@/components/PairPhoneModal'
import { DownloadAppCard } from '@/components/DownloadApp'
import { useToast } from '@/components/ui/toastContext'
import { cn } from '@/lib/cn'
import type { Action, Assignee, Card, CardKind } from '../api/types'
import { cardsApi } from '../api/cards'
import { useBusiness, useCan } from '../hooks/context'
import { useBizApps, useBizDevices, useBizMutation } from '../hooks/queries'
import { assigneeTypeLabel } from '../lib/format'
import { fieldErrorsOf, formLevelError } from '../lib/errors'
import { ActionConfigurator } from './ActionConfigurator'
import { AssigneePickerModal } from './Pickers'
import { Avatar } from './bits'
import { FormError } from './BizError'

const STEPS = [
  { icon: Smartphone, title: 'Open nexTap on a business phone', body: 'Any phone paired with this business (Devices).' },
  { icon: ScanLine, title: 'Reader → “Register cards”', body: 'Switch the reader to Register cards mode.' },
  { icon: Nfc, title: 'Tap each card', body: 'Each new card is added here with its UID and linked — name it, assign it, done.' },
]

function PhoneFlow({ kind, onPrepare, onClose }: { kind: CardKind; onPrepare: () => void; onClose: () => void }) {
  const { business, base } = useBusiness()
  const can = useCan()
  const devices = useBizDevices(business.id)
  const apps = useBizApps(business.id)
  const terminal = apps.data?.find((a) => a.name === 'Business Terminal') ?? apps.data?.[0]
  const [pairing, setPairing] = useState(false)
  const active = (devices.data ?? []).filter((d) => d.status === 'active')
  const noun = kind === 'tag' ? 'tags' : 'cards'
  return (
    <div className="space-y-5">
      <p className="text-[13.5px] text-muted">
        NFC {noun} are registered with a phone so the platform learns each chip’s unique ID — there’s nothing to type. Hold a {kind} to the phone and it appears
        here instantly.
      </p>
      <ol className="grid gap-3 sm:grid-cols-3" aria-label="How to register cards">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative rounded-xl border border-border bg-surface-2/50 p-3.5">
            <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent-solid text-[11px] font-bold text-accent-fg">{i + 1}</span>
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <s.icon className="h-5 w-5" />
            </span>
            <p className="text-[13px] font-semibold">{s.title}</p>
            <p className="mt-0.5 text-xs text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <p className="text-xs text-subtle">
        Tip: a reader that taps an unknown card also offers <strong className="text-fg">“Register this card”</strong>. While registering, the phone can
        assign each {kind} to a person or mark it as a <strong className="text-fg">company {kind}</strong> ({business.name}) — handy for counters, tables and
        shared devices.
      </p>
      {!business.settings.devices_can_register_cards && (
        <Alert tone="warning" title="Registering from phones is turned off">
          Turn on “Devices can register and program cards” in{' '}
          <Link to={`${base}/settings#devices`} onClick={onClose} className="font-medium underline">
            Business Settings
          </Link>
          .
        </Alert>
      )}
      {!devices.isLoading && active.length === 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-3.5 sm:flex-row sm:items-center">
          <Smartphone className="h-5 w-5 shrink-0 text-subtle" />
          <p className="min-w-0 flex-1 text-[13px] text-muted">No business phone is paired yet. Install nexTap on an NFC-capable Android phone, then pair it by scanning a QR code.</p>
          {can('devices.manage') && terminal && (
            <Button size="sm" variant="primary" leftIcon={<QrIcon className="h-3.5 w-3.5" />} onClick={() => setPairing(true)}>
              Pair a phone
            </Button>
          )}
        </div>
      )}
      <DownloadAppCard compact />
      <div className="border-t border-border pt-4">
        <button type="button" onClick={onPrepare} className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-surface-2">
          <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
          <span>
            <span className="block text-[13px] font-medium">Prepare a {kind} here, link it on the phone</span>
            <span className="block text-xs text-subtle">Create the record now (name, holder, action). The phone binds the chip later with Program card.</span>
          </span>
        </button>
      </div>
      {terminal && <PairPhoneModal open={pairing} onClose={() => setPairing(false)} applicationId={terminal.id} />}
    </div>
  )
}

function PrepareForm({ kind: initialKind, onCreated, onPending }: { kind: CardKind; onCreated: (c: Card) => void; onPending: (p: boolean) => void }) {
  const { business } = useBusiness()
  const [kind, setKind] = useState<CardKind>(initialKind)
  const [name, setName] = useState('')
  const [assignee, setAssignee] = useState<Assignee | null>(null)
  const [picking, setPicking] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const create = useBizMutation(business.id, () =>
    cardsApi.create(business.id, { kind, name: name.trim(), action, ...(assignee ? { assignee_type: assignee.type, assignee_id: assignee.id } : {}) }),
  )
  const errs = fieldErrorsOf(create.error)
  async function submit(e: FormEvent) {
    e.preventDefault()
    onPending(true)
    try {
      onCreated(await create.mutateAsync(undefined))
    } catch {
      /* inline */
    } finally {
      onPending(false)
    }
  }
  return (
    <form id="prepare-card" onSubmit={submit} className="space-y-4" noValidate>
      <FormError error={formLevelError(create.error, ['name'])} />
      <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="Kind">
        {(['card', 'tag'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn('h-8 rounded-md px-3 text-[13px] font-medium', kind === k ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg')}
          >
            {k === 'card' ? 'Card (held by a person)' : 'Tag (on a thing)'}
          </button>
        ))}
      </div>
      <Field label="Name" error={errs.name} hint={kind === 'tag' ? 'e.g. “Table 4” or “Front window poster”.' : 'e.g. “John’s card”.'}>
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-autofocus />}
      </Field>
      <div>
        <p className="mb-1.5 text-[13px] font-medium">
          Holder <span className="font-normal text-subtle">(optional)</span>
        </p>
        {assignee ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
            <Avatar name={assignee.name} src={assignee.photo_url} size={28} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
              {assignee.name} <span className="text-xs font-normal text-subtle">· {assigneeTypeLabel(assignee.type)}</span>
            </span>
            <Button size="icon-sm" variant="ghost" aria-label="Remove holder" onClick={() => setAssignee(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button size="sm" leftIcon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setPicking(true)}>
            Choose company, employee or customer
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-medium">What happens when someone taps it</p>
        <ActionConfigurator value={action} onChange={setAction} allowDefault errors={errs} />
      </div>
      <AssigneePickerModal
        open={picking}
        onClose={() => setPicking(false)}
        current={assignee}
        onPick={(a) => {
          setAssignee(a)
          setPicking(false)
        }}
      />
    </form>
  )
}

/**
 * "Register cards": explains registering chips with the nexTap app on a business phone (the platform needs each
 * chip's UID), with pairing/download shortcuts; secondary path prepares a card record without a UID.
 */
export function RegisterCardsModal({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: CardKind }) {
  const { base } = useBusiness()
  const navigate = useNavigate()
  const toast = useToast()
  const [view, setView] = useState<'phone' | 'prepare' | 'done'>('phone')
  const [created, setCreated] = useState<Card | null>(null)
  const [pending, setPending] = useState(false)
  const close = () => {
    setView('phone')
    setCreated(null)
    onClose()
  }
  const noun = kind === 'tag' ? 'tags' : 'cards'
  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={view === 'prepare' ? `Prepare a ${kind}` : view === 'done' ? 'Now link it on the phone' : `Register ${noun}`}
      description={view === 'phone' ? 'Use the nexTap app on a business phone — the fastest, error-free way.' : undefined}
      footer={
        view === 'prepare' ? (
          <>
            <Button leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => setView('phone')}>
              Back
            </Button>
            <Button variant="primary" type="submit" form="prepare-card" loading={pending}>
              Create {kind}
            </Button>
          </>
        ) : view === 'done' ? (
          <>
            <Button onClick={close}>Done</Button>
            {created && (
              <Button
                variant="primary"
                onClick={() => {
                  const c = created
                  close()
                  navigate(`${base}/${c.kind === 'tag' ? 'tags' : 'cards'}/${c.id}`)
                }}
              >
                Open {created.kind}
              </Button>
            )}
          </>
        ) : (
          <Button onClick={close}>Close</Button>
        )
      }
    >
      {view === 'phone' && <PhoneFlow kind={kind} onPrepare={() => setView('prepare')} onClose={close} />}
      {view === 'prepare' && (
        <PrepareForm
          kind={kind}
          onPending={setPending}
          onCreated={(c) => {
            setCreated(c)
            setView('done')
            toast.success(`“${c.name}” created — link it with the phone next.`)
          }}
        />
      )}
      {view === 'done' && created && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-[13.5px]">
              <strong>“{created.name}”</strong> is ready but <strong>not linked</strong> to a chip yet.
            </p>
          </div>
          <ol className="space-y-2 text-[13.5px]">
            {[
              <>Open <strong>nexTap</strong> on a business phone.</>,
              <>Go to <strong>Program card</strong> and search for “{created.name}”.</>,
              <>Hold the physical {created.kind} to the phone — the app links its UID and writes the tap link.</>,
            ].map((t, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-solid text-[11px] font-bold text-accent-fg">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-subtle">Until then it shows a “Not linked” badge. Taps can’t reach it because no chip carries its link yet.</p>
        </div>
      )}
    </Modal>
  )
}
