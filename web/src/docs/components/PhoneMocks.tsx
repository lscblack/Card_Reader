import type { ReactNode } from 'react'
import { Bell, Check, CircleHelp, ExternalLink, Plus, Radio, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

/*
 * Illustrations of what the nexTap app shows after a read (mobile-style mockups, not screenshots of
 * the Flutter app). Always rendered on a dark "phone" surface, independent of the site theme.
 */

function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="mx-auto w-full max-w-[220px]" role="img" aria-label={label}>
      <div className="rounded-[28px] border-[3px] border-[#3a3132] bg-[#1c1819] p-1.5 shadow-lg">
        <div className="relative flex min-h-[340px] flex-col overflow-hidden rounded-[22px] bg-[#0c0a0a] px-3 pt-6 pb-3 text-[#f5f1f1]">
          <div aria-hidden="true" className="absolute top-2 left-1/2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-[#3a3132]" />
          {children}
        </div>
      </div>
    </div>
  )
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between text-[10px] text-[#b3acac]">
      <span className="font-semibold text-[#f5f1f1]">{title}</span>
      <Radio className="h-3.5 w-3.5 text-[#e5484d]" aria-hidden="true" />
    </div>
  )
}

const tones = {
  green: { ring: 'border-emerald-400 text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300' },
  amber: { ring: 'border-amber-400 text-amber-400', chip: 'bg-amber-500/15 text-amber-300' },
  neutral: { ring: 'border-[#8f8888] text-[#b3acac]', chip: 'bg-white/10 text-[#b3acac]' },
}

export function DeveloperResultMock() {
  return (
    <Phone label="Developer device after a read: status Delivered, card UID, UID only badge">
      <Header title="nexTap" />
      <div className="mt-6 flex flex-col items-center">
        <span className={cn('flex h-20 w-20 items-center justify-center rounded-full border-4', tones.green.ring)}>
          <Check className="h-9 w-9" aria-hidden="true" />
        </span>
        <p className="mt-3 text-[15px] font-semibold">Delivered</p>
        <p className="text-[10.5px] text-[#b3acac]">200 · 184 ms · relay</p>
      </div>
      <div className="mt-auto rounded-xl bg-white/5 p-2.5 text-[10.5px]">
        <p className="text-[#8f8888]">Last card</p>
        <p className="font-mono text-[12px]">04A1B2C3D4E5</p>
        <p className="mt-1 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[9.5px] text-[#b3acac]">Card detected · UID only (not authenticated)</p>
      </div>
    </Phone>
  )
}

export function BusinessResultMock({ state }: { state: 'recognized' | 'inactive' | 'unknown' }) {
  const t = state === 'recognized' ? tones.green : state === 'inactive' ? tones.amber : tones.neutral
  const Icon = state === 'recognized' ? Check : state === 'inactive' ? TriangleAlert : CircleHelp
  const label =
    state === 'recognized'
      ? 'Business device: recognized card with assignee Jane Doe, Sales Manager, and an Open button'
      : state === 'inactive'
        ? 'Business device: inactive card shown in amber'
        : 'Business device: unknown card with a Register this card button'
  return (
    <Phone label={label}>
      <Header title="Acme Café" />
      <div className="mt-5 flex flex-col items-center text-center">
        <span className={cn('flex h-16 w-16 items-center justify-center rounded-full border-4', t.ring)}>
          <Icon className="h-7 w-7" aria-hidden="true" />
        </span>
        <span className={cn('mt-3 rounded-full px-2 py-0.5 text-[10px] font-semibold', t.chip)}>
          {state === 'recognized' ? 'Recognized' : state === 'inactive' ? 'Inactive card' : 'Unknown card'}
        </span>
        {state === 'unknown' ? (
          <>
            <p className="mt-2 text-[14px] font-semibold">Not registered</p>
            <p className="font-mono text-[10.5px] text-[#b3acac]">04C9D1E27F10</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-[14px] font-semibold">{state === 'recognized' ? 'Jane Doe' : 'Loyalty card · Mateo'}</p>
            <p className="text-[10.5px] text-[#b3acac]">{state === 'recognized' ? 'Sales Manager · Front desk card' : 'Deactivated by an admin'}</p>
          </>
        )}
      </div>
      <div className="mt-auto space-y-1.5">
        {state === 'recognized' && (
          <span className="flex items-center justify-center gap-1.5 rounded-lg bg-[#dc2626] py-2 text-[11.5px] font-semibold">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open profile
          </span>
        )}
        {state === 'unknown' && (
          <span className="flex items-center justify-center gap-1.5 rounded-lg bg-[#dc2626] py-2 text-[11.5px] font-semibold">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Register this card
          </span>
        )}
        <p className="text-center text-[9.5px] text-[#8f8888]">UID only · not proof of identity</p>
      </div>
    </Phone>
  )
}

export function BackgroundNotificationMock() {
  return (
    <Phone label="Unlocked phone with another app open: a Card delivered notification appears after a background read">
      <div className="rounded-2xl bg-white/10 p-2.5 shadow-lg ring-1 ring-white/10">
        <p className="flex items-center gap-1.5 text-[9.5px] text-[#b3acac]">
          <Bell className="h-3 w-3" aria-hidden="true" /> nexTap · Card reads · now
        </p>
        <p className="mt-1 text-[11.5px] font-semibold">Card delivered</p>
        <p className="text-[10.5px] text-[#d6d0d0]">04A1B2C3D4E5 · Front desk check-in</p>
      </div>
      <p className="mt-4 text-center text-[10px] text-[#8f8888]">You stay in the app you were using</p>
      <div aria-hidden="true" className="mt-3 grid grid-cols-4 gap-2 opacity-40">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="aspect-square rounded-xl bg-white/15" />
        ))}
      </div>
      <p className="mt-auto text-center text-[9.5px] text-[#8f8888]">Screen must be on and unlocked to read</p>
    </Phone>
  )
}
