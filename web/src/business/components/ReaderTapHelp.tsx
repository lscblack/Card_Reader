import { useState } from 'react'
import { ChevronDown, CircleHelp, ExternalLink, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'

const RESULTS = [
  {
    key: 'recognized',
    label: 'Recognized',
    ring: 'ring-emerald-500/40',
    dot: 'bg-emerald-500',
    title: 'John Doe · Sales Manager',
    body: 'A card from this business. The phone shows who holds it and which action it runs.',
    button: 'Open',
    buttonHint: 'Opens the card’s action (e.g. the employee’s profile or your website) on the phone.',
  },
  {
    key: 'inactive',
    label: 'Inactive',
    ring: 'ring-amber-500/40',
    dot: 'bg-amber-500',
    title: 'Table 4 · inactive',
    body: 'The card or tag is deactivated, or its holder is. Nothing runs; the tap is still logged.',
    button: null,
    buttonHint: null,
  },
  {
    key: 'unknown',
    label: 'Unknown card',
    ring: 'ring-border-strong',
    dot: 'bg-zinc-400',
    title: 'Unknown card',
    body: 'A card that isn’t registered in this business yet.',
    button: 'Register this card',
    buttonHint: 'Creates a new card with this UID straight from the phone (needs “Devices can register cards” in Business Settings).',
  },
]

/** Explains what staff see on the phone when a card is read by a business device. */
export function ReaderTapHelp({ canRegister }: { canRegister: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5">
        <CircleHelp className="h-5 w-5 shrink-0 text-subtle" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">What happens when a device reads a card?</span>
          <span className="block text-[13px] text-muted">The nexTap app shows a result card for every tap — here’s how to read it.</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-4 py-4 sm:px-5">
          <div className="grid gap-3 md:grid-cols-3">
            {RESULTS.map((r) => (
              <div key={r.key} className="flex flex-col rounded-xl border border-border bg-surface-2/50 p-3">
                <div className={cn('rounded-lg bg-surface p-3 ring-2', r.ring)}>
                  <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                    <span className={cn('h-2 w-2 rounded-full', r.dot)} aria-hidden="true" /> {r.label}
                  </p>
                  <p className="mt-1 text-[14px] font-semibold">{r.title}</p>
                  {r.button && (
                    <span
                      className={cn(
                        'mt-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium',
                        r.key === 'unknown' ? 'border border-border-strong text-fg' : 'bg-accent-solid text-accent-fg',
                        r.key === 'unknown' && !canRegister && 'opacity-50',
                      )}
                    >
                      {r.key === 'unknown' ? <Plus className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />} {r.button}
                    </span>
                  )}
                </div>
                <p className="mt-2.5 text-[13px] text-muted">{r.body}</p>
                {r.buttonHint && (
                  <p className="mt-1 text-xs text-subtle">
                    <span className="font-medium text-fg">{r.button}:</span> {r.buttonHint}
                    {r.key === 'unknown' && !canRegister && ' Currently turned off.'}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-subtle">
            Every read is recorded in NFC Events with a “Reader” badge. If the card’s action is a developer webhook, a signed <code className="font-mono">card.tapped</code> event is also
            sent to your application.
          </p>
        </div>
      )}
    </Card>
  )
}
