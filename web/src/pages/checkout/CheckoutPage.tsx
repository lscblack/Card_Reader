import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { loadStripe, type Appearance, type Stripe } from '@stripe/stripe-js'
import { CheckoutElementsProvider, PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout'
import { ArrowLeft, BadgeCheck, Check, CreditCard, Lock, ShieldCheck, Sparkles, Tag, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { billingApi, type BillingInterval } from '@/api/billing'
import { promotionsApi } from '@/api/pricing'
import { errorMessage } from '@/api/client'
import type { Plan } from '@/api/types'
import { useAuth } from '@/auth/context'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton, Spinner } from '@/components/ui/Spinner'
import { usePlans } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useIsDark } from '@/hooks/useTheme'
import { cn } from '@/lib/cn'
import { compact, money, num } from '@/lib/format'

const stripeCache = new Map<string, Promise<Stripe | null>>()
function stripeFor(key: string): Promise<Stripe | null> {
  let p = stripeCache.get(key)
  if (!p) {
    p = loadStripe(key)
    stripeCache.set(key, p)
  }
  return p
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Payment Element styled with the dashboard's own design tokens (follows light/dark). */
function useAppearance(dark: boolean): Appearance {
  return useMemo<Appearance>(
    () => ({
      theme: dark ? 'night' : 'stripe',
      variables: {
        colorPrimary: cssVar('--accent-solid', '#b91c1c'),
        colorBackground: cssVar('--surface', dark ? '#141112' : '#ffffff'),
        colorText: cssVar('--fg', dark ? '#f5f1f1' : '#1c1717'),
        colorTextSecondary: cssVar('--muted', '#57524f'),
        colorDanger: dark ? '#f87171' : '#dc2626',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        borderRadius: '10px',
        spacingUnit: '4px',
      },
      rules: {
        '.Input': { border: `1px solid ${cssVar('--border-strong', '#d6d0d0')}`, boxShadow: 'none' },
        '.Input:focus': { borderColor: cssVar('--ring', '#dc2626'), boxShadow: `0 0 0 3px ${cssVar('--accent-soft', '#fef2f2')}` },
        '.Tab': { border: `1px solid ${cssVar('--border-strong', '#d6d0d0')}`, boxShadow: 'none' },
        '.Tab--selected': { borderColor: cssVar('--accent-solid', '#b91c1c') },
        '.Label': { fontWeight: '500' },
      },
    }),
    [dark],
  )
}

function priceFor(plan: Plan, interval: BillingInterval): number {
  if (interval === 'year') return plan.price_yearly_cents ?? plan.price_monthly_cents * 12
  return plan.price_monthly_cents
}

function limitsOf(plan: Plan): string[] {
  const u = (v: number | null | undefined, unit: string) => (v == null ? `Unlimited ${unit}` : `${num(v)} ${unit}`)
  switch (plan.audience) {
    case 'business':
      return [u(plan.max_cards, 'cards & tags'), u(plan.max_devices, 'devices'), u(plan.max_members, 'team members'),
        plan.events_per_month == null ? 'Unlimited taps' : `${compact(plan.events_per_month)} taps / month`]
    case 'personal':
      return [u(plan.max_cards, 'digital cards'), u(plan.max_contacts, 'contacts')]
    default:
      return [plan.events_per_month == null ? 'Unlimited events' : `${compact(plan.events_per_month)} events / month`,
        u(plan.max_applications, 'applications'), u(plan.max_devices, 'devices')]
  }
}

function backLink(plan: Plan | undefined, businessId: string | null): string {
  if (businessId) return `/business/${businessId}/billing`
  if (plan?.audience === 'personal') return '/me/settings'
  return '/dashboard/usage'
}

/* ───────────────────────── Summary (left) ───────────────────────── */

interface Totals {
  subtotal: string
  discount: string | null
  discountLabel: string | null
  total: string
}

function IntervalToggle({ value, onChange, plan, disabled }: { value: BillingInterval; onChange: (v: BillingInterval) => void; plan: Plan; disabled?: boolean }) {
  const yearly = plan.price_yearly_cents
  const saving = yearly != null && plan.price_monthly_cents > 0 ? Math.round((1 - yearly / (plan.price_monthly_cents * 12)) * 100) : 0
  const opt = (v: BillingInterval, label: ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      disabled={disabled}
      onClick={() => onChange(v)}
      className={cn(
        'relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
        value === v ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Billing period" className="flex gap-1 rounded-xl bg-surface-2 p-1 ring-1 ring-border ring-inset">
      {opt('month', 'Monthly')}
      {opt(
        'year',
        <>
          Yearly
          {saving > 0 && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">−{saving}%</span>}
        </>,
      )}
    </div>
  )
}

function PromoField({ plan, applied, onApply, onRemove, busy }: { plan: Plan; applied: string | null; onApply: (code: string) => void; onRemove: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px]">
        <span className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
          <Tag className="h-3.5 w-3.5" /> {applied}
        </span>
        <button type="button" onClick={onRemove} disabled={busy} className="rounded p-0.5 text-muted hover:text-fg" aria-label="Remove promotion code">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
        <Tag className="h-3.5 w-3.5" /> Add promotion code
      </button>
    )
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    if (!c) return
    setChecking(true)
    setError(null)
    try {
      const r = await promotionsApi.validate(c, plan.code)
      if (r.valid && r.promotion?.discount_type !== 'free') onApply(c)
      else setError('This code isn’t valid for this plan.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex gap-2">
        <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="PROMO CODE" className="uppercase" aria-label="Promotion code" />
        <Button type="submit" loading={checking || busy}>Apply</Button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </form>
  )
}

function Summary(props: {
  plan: Plan
  interval: BillingInterval
  onInterval: (v: BillingInterval) => void
  promo: string | null
  onPromo: (c: string | null) => void
  totals: Totals | null
  busy: boolean
}) {
  const { plan, interval, totals } = props
  const price = priceFor(plan, interval)
  const per = interval === 'year' ? 'year' : 'month'
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wider text-subtle uppercase">Upgrade to</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{plan.name}</h1>
        </div>
        {plan.badge && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent ring-1 ring-accent/20">
            <Sparkles className="h-3 w-3" /> {plan.badge}
          </span>
        )}
      </div>
      {plan.description && <p className="mt-2 text-[14px] text-muted">{plan.description}</p>}

      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-tight tabular-nums">{money(price, plan.currency)}</span>
        <span className="text-[14px] text-muted">/ {per}</span>
      </div>
      {interval === 'year' && <p className="mt-1 text-[13px] text-muted">That’s {money(Math.round(price / 12), plan.currency)} a month, billed yearly.</p>}

      <div className="mt-5">
        <IntervalToggle value={interval} onChange={props.onInterval} plan={plan} disabled={props.busy} />
      </div>

      <ul className="mt-6 grid gap-2.5 text-[14px] sm:grid-cols-2 lg:grid-cols-1">
        {[...limitsOf(plan), ...plan.features.filter((f) => !/^\d|unlimited/i.test(f))].map((f) => (
          <li key={f} className="flex gap-2.5">
            <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
            </span>
            <span className="text-muted">{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        <div className="space-y-3 rounded-2xl border border-border bg-surface/70 p-4 backdrop-blur">
          <PromoField plan={plan} applied={props.promo} onApply={(c) => props.onPromo(c)} onRemove={() => props.onPromo(null)} busy={props.busy} />
          <dl className="space-y-2 border-t border-border pt-3 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-muted">{plan.name} · {interval === 'year' ? 'yearly' : 'monthly'}</dt>
              <dd className="tabular-nums">{totals?.subtotal ?? money(price, plan.currency)}</dd>
            </div>
            {totals?.discount && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <dt>{totals.discountLabel ?? 'Discount'}</dt>
                <dd className="tabular-nums">−{totals.discount}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-[15px] font-semibold">
              <dt>Due today</dt>
              <dd className="tabular-nums">{totals ? totals.total : props.busy ? <Skeleton className="h-5 w-16" /> : money(price, plan.currency)}</dd>
            </div>
          </dl>
          <p className="text-xs text-subtle">
            Renews at {money(price, plan.currency)} every {per}. Cancel anytime from your billing page.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Payment (right) ───────────────────────── */

function PaymentForm({ plan, interval, onTotals, testMode }: { plan: Plan; interval: BillingInterval; onTotals: (t: Totals | null) => void; testMode: boolean }) {
  const state = useCheckoutElements()
  const navigate = useNavigate()
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const checkout = state.type === 'success' ? state.checkout : null
  const t = checkout?.total
  const subtotal = t?.subtotal.amount
  const discount = t && t.discount.minorUnitsAmount > 0 ? t.discount.amount : null
  const discountLabel = checkout?.discountAmounts?.[0]?.displayName ?? null
  const total = t?.total.amount
  useEffect(() => {
    onTotals(subtotal && total ? { subtotal, discount, discountLabel, total } : null)
  }, [subtotal, discount, discountLabel, total, onTotals])

  if (state.type === 'error') {
    return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{state.error.message}</p>
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!checkout) return
    setPaying(true)
    setError(null)
    const res = await checkout.confirm({ redirect: 'if_required' })
    if (res.type === 'error') {
      setError(res.error.message)
      setPaying(false)
      return
    }
    navigate(`/checkout/complete?session_id=${encodeURIComponent(res.session.id)}`, { replace: true })
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {testMode && (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] text-amber-800 dark:text-amber-300">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Test mode — no real charge</p>
            <p className="mt-0.5">
              Card <span className="font-mono font-medium">4242 4242 4242 4242</span>, any future date, any CVC. Try{' '}
              <span className="font-mono">4000 0025 0000 3155</span> for 3-D Secure or <span className="font-mono">4000 0000 0000 9995</span> for a decline.
            </p>
          </div>
        </div>
      )}
      {checkout?.email && (
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Email</p>
          <p className="rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-muted">{checkout.email}</p>
        </div>
      )}
      <div className="relative min-h-[220px]">
        {!ready && (
          <div className="absolute inset-0 space-y-3">
            <Skeleton className="h-11" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
            <Skeleton className="h-11" />
          </div>
        )}
        <div className={cn('transition-opacity', ready ? 'opacity-100' : 'opacity-0')}>
          <PaymentElement options={{ layout: { type: 'tabs' } }} onReady={() => setReady(true)} />
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" className="h-12 w-full text-[15px]" loading={paying} disabled={!checkout || !ready || !checkout.canConfirm} leftIcon={!paying ? <Lock className="h-4 w-4" /> : undefined}>
        {paying ? 'Processing…' : `Pay ${checkout?.total.total.amount ?? money(priceFor(plan, interval), plan.currency)} and subscribe`}
      </Button>
      <p className="text-center text-xs text-subtle">
        By subscribing you authorise nexTap to charge you {money(priceFor(plan, interval), plan.currency)} every {interval} until you cancel.
      </p>
    </form>
  )
}

function Trust() {
  const item = (icon: ReactNode, text: string) => (
    <span className="flex items-center gap-1.5">
      {icon}
      {text}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-subtle">
      {item(<Lock className="h-3.5 w-3.5" />, 'Encrypted & secure')}
      {item(<ShieldCheck className="h-3.5 w-3.5" />, 'PCI-DSS compliant')}
      {item(<BadgeCheck className="h-3.5 w-3.5" />, 'Payments by Stripe')}
    </div>
  )
}

function Shell({ back, children }: { back: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to={back} className="flex items-center gap-2 text-[13px] font-medium text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back to billing</span>
          </Link>
          <Logo />
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> <span className="hidden sm:inline">Secure checkout</span>
          </span>
        </div>
      </header>
      {children}
    </div>
  )
}

function Message({ title, body, back }: { title: string; body: string; back: string }) {
  return (
    <Shell back={back}>
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[14px] text-muted">{body}</p>
        <Link to={back} className="mt-6 inline-block">
          <Button variant="primary">Back to billing</Button>
        </Link>
      </div>
    </Shell>
  )
}

export default function CheckoutPage() {
  const [params, setParams] = useSearchParams()
  const planCode = params.get('plan') ?? ''
  const businessId = params.get('business')
  const interval: BillingInterval = params.get('interval') === 'year' ? 'year' : 'month'
  const [promo, setPromo] = useState<string | null>(null)
  const plans = usePlans()
  const plan = plans.data?.find((p) => p.code === planCode)
  const back = backLink(plan, businessId)
  const { user } = useAuth()
  const dark = useIsDark()
  const appearance = useAppearance(dark)
  useDocumentTitle(plan ? `Upgrade to ${plan.name}` : 'Checkout')

  const [totals, setTotals] = useState<Totals | null>(null)
  // One Checkout Session per plan / period / code (a new one when any of them changes).
  const session = useQuery({
    queryKey: ['checkout', plan?.code, interval, businessId, promo],
    queryFn: () => billingApi.checkout({ plan_code: plan!.code, interval, business_id: businessId, promotion_code: promo }),
    enabled: !!plan,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const start = session.data ?? null
  const loading = session.isFetching
  const startError = session.error ? errorMessage(session.error) : null

  if (plans.isLoading) {
    return (
      <Shell back={back}>
        <div className="flex justify-center py-32">
          <Spinner />
        </div>
      </Shell>
    )
  }
  if (!plan) return <Message back={back} title="Plan not found" body="This plan isn’t available any more. Pick another one from your billing page." />

  const setInterval = (v: BillingInterval) => {
    const next = new URLSearchParams(params)
    next.set('interval', v)
    setParams(next, { replace: true })
  }
  const testMode = !!start?.publishable_key.startsWith('pk_test_')

  return (
    <Shell back={back}>
      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-12 lg:py-14">
        <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-accent-soft via-surface to-surface p-6 sm:p-8">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent-solid/10 blur-3xl" />
          <div className="relative h-full">
            <Summary plan={plan} interval={interval} onInterval={setInterval} promo={promo} onPromo={setPromo} totals={loading ? null : totals} busy={loading} />
          </div>
        </section>

        <section className="flex flex-col">
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Payment details</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  {businessId ? 'Billed to your business' : `Signed in as ${user?.email ?? ''}`}
                </p>
              </div>
              <div className="flex gap-1.5" aria-hidden>
                {['VISA', 'MC', 'AMEX'].map((b) => (
                  <span key={b} className="rounded-md border border-border bg-surface-2 px-1.5 py-1 text-[10px] font-bold tracking-wide text-subtle">
                    {b}
                  </span>
                ))}
              </div>
            </div>

            {startError ? (
              <div className="space-y-4">
                <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{startError}</p>
                {promo && (
                  <Button onClick={() => setPromo(null)} className="w-full">
                    Continue without the promotion code
                  </Button>
                )}
              </div>
            ) : !start || loading ? (
              <div className="space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-11" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-11" />
                  <Skeleton className="h-11" />
                </div>
                <Skeleton className="h-12" />
              </div>
            ) : (
              <CheckoutElementsProvider
                key={start.client_secret + (dark ? ':d' : ':l')}
                stripe={stripeFor(start.publishable_key)}
                options={{ clientSecret: start.client_secret, elementsOptions: { appearance } }}
              >
                <PaymentForm plan={plan} interval={interval} onTotals={setTotals} testMode={testMode} />
              </CheckoutElementsProvider>
            )}
          </div>
          <div className="mt-5">
            <Trust />
          </div>
        </section>
      </main>
    </Shell>
  )
}
