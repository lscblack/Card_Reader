import { ArrowRight, Briefcase, Coffee, Code2, Warehouse, type LucideIcon } from 'lucide-react'
import { GlowCard } from './GlowCard'
import { Reveal, SectionHeading } from './Reveal'

const stories: { icon: LucideIcon; persona: string; setting: string; story: string; flow: string[] }[] = [
  {
    icon: Coffee,
    persona: 'Café owner',
    setting: 'Neighbourhood café, 12 tables',
    story: 'Puts a tag on every table that opens the menu, and one by the till for guest Wi-Fi. Updates prices in the profile editor — the tags never change.',
    flow: ['Tap table tag', 'Menu profile', 'Taps per table'],
  },
  {
    icon: Briefcase,
    persona: 'Sales team lead',
    setting: 'B2B team of 20',
    story: "Gives every rep an NFC business card that opens their profile and saves their contact. When someone leaves, deactivating them disables the card instantly.",
    flow: ['Tap business card', 'Employee profile', 'Save contact'],
  },
  {
    icon: Code2,
    persona: 'Backend developer',
    setting: 'Event check-in system',
    story: 'Uses old Android phones as door readers. Each tap arrives as a signed webhook; the backend looks up the attendee and treats the UID as a lookup key, not as proof of identity.',
    flow: ['Tap badge', 'Signed webhook', 'Check-in recorded'],
  },
  {
    icon: Warehouse,
    persona: 'Operations lead',
    setting: 'Small warehouse',
    story: 'Tags shelves and assets, then has staff tap them on patrol. Events land in the existing inventory tool through the relay mode, with retries when Wi-Fi drops.',
    flow: ['Tap shelf tag', 'Relay + retries', 'Inventory updated'],
  },
]

export function Stories() {
  return (
    <section className="py-20 sm:py-28" aria-labelledby="stories-title">
      <div className="mx-auto w-11/12">
        <SectionHeading
          id="stories-title"
          eyebrow="Use-case stories"
          title="What a tap can do for people like you"
          subtitle="Illustrative scenarios built from real product features — not customer testimonials."
        />
        <ul className="mt-14 grid gap-4 md:grid-cols-2">
          {stories.map((s, i) => (
            <Reveal as="li" key={s.persona} delay={(i % 2) * 0.08}>
              <GlowCard className="h-full" tilt={2}>
                <figure className="flex h-full flex-col p-6 sm:p-7">
                  <figcaption className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <s.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-[15px] font-semibold text-fg">{s.persona}</span>
                      <span className="block text-[12.5px] text-subtle">{s.setting} · example persona</span>
                    </span>
                  </figcaption>
                  <blockquote className="mt-5 flex-1 text-[15px] leading-relaxed text-muted">{s.story}</blockquote>
                  <ol className="mt-6 flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
                    {s.flow.map((f, k) => (
                      <li key={f} className="inline-flex items-center gap-1.5">
                        <span className="rounded-md border border-border bg-bg px-2 py-1 text-fg">{f}</span>
                        {k < s.flow.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />}
                      </li>
                    ))}
                  </ol>
                </figure>
              </GlowCard>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}
