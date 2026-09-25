import {
  BadgeCheck,
  Boxes,
  CalendarCheck,
  ContactRound,
  DoorOpen,
  Gift,
  GraduationCap,
  Package,
  ParkingSquare,
  Star,
  Ticket,
  UtensilsCrossed,
  Wifi,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useReducedMotionPref } from '../lib'

type Item = { icon: LucideIcon; label: string }

const rowA: Item[] = [
  { icon: BadgeCheck, label: 'Attendance' },
  { icon: DoorOpen, label: 'Access check-in' },
  { icon: Gift, label: 'Loyalty stamps' },
  { icon: Ticket, label: 'Event ticketing' },
  { icon: ContactRound, label: 'Business cards' },
  { icon: UtensilsCrossed, label: 'Digital menus' },
  { icon: Boxes, label: 'Inventory' },
]
const rowB: Item[] = [
  { icon: Wifi, label: 'Guest Wi-Fi' },
  { icon: Star, label: 'Review requests' },
  { icon: CalendarCheck, label: 'Class sign-in' },
  { icon: Package, label: 'Asset tracking' },
  { icon: GraduationCap, label: 'Campus events' },
  { icon: Wrench, label: 'Maintenance rounds' },
  { icon: ParkingSquare, label: 'Visitor passes' },
]

const CSS = `
@keyframes mkt-marquee { from { transform: translate3d(0,0,0) } to { transform: translate3d(-50%,0,0) } }
.mkt-marquee { animation: mkt-marquee var(--mkt-dur, 40s) linear infinite; }
.mkt-marquee[data-reverse="true"] { animation-direction: reverse; }
.mkt-marquee-wrap:hover .mkt-marquee, .mkt-marquee-wrap:focus-within .mkt-marquee { animation-play-state: paused; }
`

function Chips({ items, hidden }: { items: Item[]; hidden?: boolean }) {
  return (
    <ul className="flex shrink-0 items-center gap-3 pr-3" aria-hidden={hidden || undefined}>
      {items.map(({ icon: Icon, label }) => (
        <li
          key={label}
          className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-[13.5px] font-medium whitespace-nowrap text-muted shadow-sm transition-colors hover:border-accent/50 hover:text-fg"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-accent transition-transform group-hover:scale-110">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          {label}
        </li>
      ))}
    </ul>
  )
}

function Row({ items, reverse, duration }: { items: Item[]; reverse?: boolean; duration: number }) {
  return (
    <div
      className="mkt-marquee-wrap relative overflow-hidden"
      style={{
        maskImage: 'linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)',
      }}
    >
      <div className={cn('mkt-marquee flex w-max')} data-reverse={reverse ? 'true' : 'false'} style={{ ['--mkt-dur' as string]: `${duration}s` }}>
        <Chips items={items} />
        <Chips items={items} hidden />
      </div>
    </div>
  )
}

export function UseCases() {
  const reduce = useReducedMotionPref()
  return (
    <section aria-labelledby="usecases-title" className="relative border-y border-border bg-surface-2/40 py-10">
      <style>{CSS}</style>
      <div className="mx-auto w-11/12">
        <h2 id="usecases-title" className="text-center text-[12.5px] font-semibold tracking-[0.14em] text-subtle uppercase">
          One tap — whatever it means to you
        </h2>
      </div>
      {reduce ? (
        <ul className="mx-auto mt-6 flex w-11/12 flex-wrap justify-center gap-3">
          {[...rowA, ...rowB].map(({ icon: Icon, label }) => (
            <li key={label} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-[13.5px] font-medium text-muted">
              <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 space-y-3">
          <Row items={rowA} duration={42} />
          <Row items={rowB} duration={48} reverse />
        </div>
      )}
    </section>
  )
}
