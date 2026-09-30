import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { Check, Clock, Sparkles, Tag } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDashboardPath, useIsLoggedIn, useReducedMotionPref } from '../lib'
import {
  FALLBACK_PLANS,
  fetchPublicPlans,
  formatCents,
  isCustomPriced,
  planAudience,
  planLimits,
  planPrice,
  promoLabel,
  type Audience,
  type Billing,
  type PublicPlan,
} from '../plans'
import { useCountdown } from '../useCountdown'
import { GlowCard } from './GlowCard'
import { Reveal, SectionHeading } from './Reveal'

function PromoLine({ plan }: { plan: PublicPlan }) {
  const promo = plan.promotion
  const left = useCountdown(promo?.ends_at, 7 * 86_400_000)
  if (!promo) return null
  return (
    <div className="mt-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[12.5px]">
      <p className="flex items-center gap-1.5 font-semibold text-accent">
        <Tag className="h-3.5 w-3.5" aria-hidden="true" />
        {promo.banner_text || `${promo.name}: ${promoLabel(promo, plan.currency)}`}
      </p>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted">
        {promo.code && (
          <span>
            Code <span className="font-mono font-semibold text-fg">{promo.code}</span>
          </span>
        )}
        {left && (
          <span className="inline-flex items-center gap-1 tabular-nums" aria-label={`Offer ends in ${left}`}>
            <Clock className="h-3 w-3" aria-hidden="true" /> ends in {left}
          </span>
        )}
      </div>
    </div>
  )
}

function PlanCard({ plan, billing, cta }: { plan: PublicPlan; billing: Billing; cta: { to: string; label: string } }) {
  const featured = !!plan.is_featured
  const { now, was, perYear } = planPrice(plan, billing)
  const custom = isCustomPriced(plan)
  const promo = plan.promotion && billing === 'monthly' ? plan.promotion : null
  const ribbon = promo ? promoLabel(promo, plan.currency) : null
  const limits = planLimits(plan).filter((l) => !plan.features.some((f) => f.startsWith(l.split(' ')[0] + ' ')))

  return (
    <GlowCard
      tilt={0}
      className={cn('flex h-full flex-col', featured && 'border-accent/70 shadow-[0_30px_80px_-44px] shadow-accent-solid/70 md:-translate-y-2')}
    >
      {ribbon && (
        <div aria-hidden="true" className="absolute top-5 -right-12 z-20 w-44 rotate-45 bg-accent-solid py-1 text-center text-[11px] font-bold tracking-wide text-accent-fg uppercase shadow">
          {ribbon}
        </div>
      )}
      <div className="flex h-full flex-col p-6">
        <div className="flex items-center gap-2 pr-10">
          <h3 className="text-[16px] font-semibold text-fg">{plan.name}</h3>
          {(plan.badge || featured) && (
            <span className="rounded-full bg-accent-solid px-2 py-0.5 text-[11px] font-semibold text-accent-fg">{plan.badge || 'Most popular'}</span>
          )}
        </div>
        {plan.description && <p className="mt-1 text-[13.5px] text-muted">{plan.description}</p>}

        <div className="mt-5 flex flex-wrap items-baseline gap-x-2">
          {custom ? (
            <span className="text-4xl font-semibold tracking-tight text-fg">{planAudience(plan) === 'personal' ? 'Soon' : 'Custom'}</span>
          ) : now === 0 ? (
            <span className="text-4xl font-semibold tracking-tight text-fg">Free</span>
          ) : (
            <>
              {was != null && was !== now && (
                <span className="text-xl font-medium text-subtle line-through decoration-accent/70" aria-label={`was ${formatCents(was, plan.currency)}`}>
                  {formatCents(was, plan.currency)}
                </span>
              )}
              <span className="text-4xl font-semibold tracking-tight text-fg">{formatCents(now ?? 0, plan.currency)}</span>
              <span className="text-[13px] text-subtle">/ month</span>
            </>
          )}
        </div>
        <p className="mt-1 min-h-[18px] text-[12px] text-subtle">
          {perYear != null ? `${formatCents(perYear, plan.currency)} billed yearly` : billing === 'yearly' && !custom && now ? 'Billed monthly' : ''}
        </p>
        {billing === 'monthly' && <PromoLine plan={plan} />}

        {limits.length > 0 && (
          <ul className="mt-5 space-y-1.5 border-t border-border pt-5 text-[13.5px]">
            {limits.map((l) => (
              <li key={l} className="font-medium text-fg">
                {l}
              </li>
            ))}
          </ul>
        )}
        <ul className={cn('flex-1 space-y-2 text-[13.5px] text-muted', limits.length ? 'mt-4' : 'mt-5 border-t border-border pt-5')}>
          {plan.features.map((f) => (
            <li key={f} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <Link
          to={cta.to}
          className={cn(
            'mt-6 rounded-lg px-4 py-2.5 text-center text-[14px] font-semibold transition-colors',
            featured ? 'bg-accent-solid text-accent-fg hover:bg-accent-solid-hover' : 'border border-border-strong text-fg hover:bg-surface-2',
          )}
        >
          {cta.label}
        </Link>
      </div>
    </GlowCard>
  )
}

function Segmented<T extends string>({ value, options, onChange, label, id }: { value: T; options: { value: T; label: string; extra?: string }[]; onChange: (v: T) => void; label: string; id: string }) {
  const reduce = useReducedMotionPref()
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('relative rounded-lg px-4 py-2 text-[14px] font-semibold transition-colors sm:px-5', value === o.value ? 'text-fg' : 'text-muted hover:text-fg')}
        >
          {value === o.value && (
            <motion.span
              layoutId={id}
              className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-border-strong"
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 34 }}
            />
          )}
          <span className="relative inline-flex items-center gap-1.5">
            {o.label}
            {o.extra && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-bold text-accent">{o.extra}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

export function Pricing({ audience, onAudience }: { audience: Audience; onAudience: (a: Audience) => void }) {
  const loggedIn = useIsLoggedIn()
  const dashboardPath = useDashboardPath()
  const [billing, setBilling] = useState<Billing>('monthly')
  const q = useQuery({ queryKey: ['public', 'billing-plans'], queryFn: fetchPublicPlans, staleTime: 5 * 60_000, retry: false })
  const apiForAudience = (q.data ?? []).filter((p) => planAudience(p) === audience)
  const usingFallback = apiForAudience.length === 0
  const plans = (usingFallback ? FALLBACK_PLANS.filter((p) => planAudience(p) === audience) : apiForAudience)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const yearly = plans.filter((p) => p.price_yearly_cents != null && p.price_yearly_cents > 0 && (p.price_monthly_cents ?? 0) > 0)
  const hasYearly = yearly.length > 0
  const saving = hasYearly
    ? Math.max(...yearly.map((p) => Math.round((1 - (p.price_yearly_cents ?? 0) / (12 * (p.price_monthly_cents ?? 1))) * 100)))
    : 0
  const effectiveBilling: Billing = hasYearly ? billing : 'monthly'

  const cta = (p: PublicPlan) => {
    if (loggedIn) return { to: dashboardPath, label: 'Go to dashboard' }
    const to = audience === 'developer' ? '/register' : `/register?type=${audience}`
    if (isCustomPriced(p)) return { to, label: 'Get started' }
    return { to, label: p.price_monthly_cents === 0 ? 'Start free' : `Choose ${p.name}` }
  }

  return (
    <section id="pricing" className="relative scroll-mt-20 overflow-hidden border-t border-border bg-surface-2/40 py-20 sm:py-28" aria-labelledby="pricing-title">
      <div className="mx-auto w-11/12">
        <SectionHeading
          id="pricing-title"
          eyebrow="Pricing"
          title="Start free. Grow when your taps do."
          subtitle="Every plan includes signed delivery, QR pairing and the mobile reader app."
        />
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Segmented
            id="price-aud"
            label="Plans for"
            value={audience}
            onChange={onAudience}
            options={[
              { value: 'developer', label: 'Developers' },
              { value: 'business', label: 'Businesses' },
              { value: 'personal', label: 'Individuals' },
            ]}
          />
          {hasYearly && (
            <Segmented
              id="price-billing"
              label="Billing period"
              value={effectiveBilling}
              onChange={setBilling}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly', extra: saving > 0 ? `−${saving}%` : undefined },
              ]}
            />
          )}
        </div>

        <div
          className={cn('mx-auto mt-12 grid items-stretch gap-6', plans.length === 2 ? 'max-w-3xl md:grid-cols-2' : plans.length === 1 ? 'max-w-sm' : 'max-w-5xl md:grid-cols-3')}
          aria-busy={q.isLoading}
        >
          {plans.map((p, i) => (
            <Reveal key={`${audience}-${p.code}`} delay={i * 0.07} className="h-full">
              <PlanCard plan={p} billing={effectiveBilling} cta={cta(p)} />
            </Reveal>
          ))}
        </div>
        <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-[12.5px] text-subtle">
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Prices in USD. Pay securely by card — upgrades apply instantly, cancel anytime.
          {usingFallback && q.isError && ' Live pricing is temporarily unavailable.'}
        </p>
      </div>
    </section>
  )
}
