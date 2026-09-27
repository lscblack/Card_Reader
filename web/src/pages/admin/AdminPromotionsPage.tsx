import { useState } from 'react'
import { Megaphone, Pencil, Plus, TicketPercent, Trash2 } from 'lucide-react'
import type { Plan, Promotion, PromotionInput, PromotionStatus } from '@/api/types'
import { ApiError } from '@/api/client'
import { useAdminPlans, useAdminPromotions, usePromotionMutations } from '@/hooks/useAdmin3'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { dateTime, money, num } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge, type Tone } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Input'
import { ConfirmDialog, Drawer } from '@/components/ui/Modal'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/toastContext'
import { freePeriodLabel } from '@/marketing/plans'

const statusTone: Record<PromotionStatus, Tone> = { active: 'success', scheduled: 'info', expired: 'neutral', inactive: 'neutral', exhausted: 'warning' }

/** ISO → value for <input type="datetime-local"> in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z') : null)

function discountLabel(p: Pick<Promotion, 'discount_type' | 'discount_value' | 'currency'>) {
  if (p.discount_type === 'free') return freePeriodLabel(p.discount_value)
  return p.discount_type === 'percent' ? `${p.discount_value}% off` : `${money(p.discount_value, p.currency ?? 'usd')} off`
}

function discounted(plan: Plan, type: 'percent' | 'amount' | 'free', value: number) {
  if (type === 'free') return 0
  const m = plan.price_monthly_cents ?? 0
  const off = type === 'percent' ? Math.round((m * value) / 100) : value
  return Math.max(0, m - off)
}

interface Draft {
  name: string
  code: string
  description: string
  discount_type: 'percent' | 'amount' | 'free'
  value: string
  currency: string
  audience: 'developer' | 'business' | 'personal' | 'all'
  plan_codes: string[]
  starts_at: string
  ends_at: string
  is_active: boolean
  show_on_landing: boolean
  banner_text: string
  max_redemptions: string
}

function toDraft(p?: Promotion): Draft {
  return {
    name: p?.name ?? '',
    code: p?.code ?? '',
    description: p?.description ?? '',
    discount_type: p?.discount_type ?? 'percent',
    value: p ? (p.discount_type === 'amount' ? String(p.discount_value / 100) : String(p.discount_value)) : '20',
    currency: p?.currency ?? 'usd',
    audience: p?.audience ?? 'all',
    plan_codes: p?.plan_codes ?? [],
    starts_at: toLocalInput(p?.starts_at ?? null),
    ends_at: toLocalInput(p?.ends_at ?? null),
    is_active: p?.is_active ?? true,
    show_on_landing: p?.show_on_landing ?? false,
    banner_text: p?.banner_text ?? '',
    max_redemptions: p?.max_redemptions == null ? '' : String(p.max_redemptions),
  }
}

function Preview({ d, plans }: { d: Draft; plans: Plan[] }) {
  const value = d.discount_type === 'amount' ? Math.round(Number(d.value || 0) * 100) : Number(d.value || 0)
  const eligible = plans.filter(
    (p) => p.is_active !== false && (p.price_monthly_cents ?? 0) > 0 && (d.audience === 'all' || p.audience === d.audience) && (!d.plan_codes.length || d.plan_codes.includes(p.code)),
  )
  const sample = eligible[0]
  if (d.discount_type === 'free') {
    const given = plans.filter((p) => d.plan_codes.includes(p.code))
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium tracking-wide text-subtle uppercase">Preview</p>
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{d.name || 'Free period'}</p>
            <Badge tone="success">{freePeriodLabel(value || 0)}</Badge>
          </div>
          {given.length ? (
            <ul className="mt-2 space-y-1 text-[13px] text-muted">
              {given.map((p) => (
                <li key={p.code}>
                  <span className="capitalize">{p.audience}</span> accounts on a free plan get <b className="text-fg">{p.name}</b> free for {value || 0} months, then go
                  back to their free plan automatically.
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Choose the paid plan to give for each account type.</p>
          )}
          <p className="mt-2 text-xs text-subtle">Users claim it from their dashboard; each account can claim it once.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-wide text-subtle uppercase">Preview</p>
      {d.show_on_landing && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-solid px-3 py-2 text-[13px] font-medium text-accent-fg">
          <Megaphone className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{d.banner_text || `${d.name || 'Promotion'}: ${discountLabel({ discount_type: d.discount_type, discount_value: value, currency: d.currency })}`}</span>
          {d.code && <span className="rounded bg-white/20 px-1.5 font-mono text-xs">{d.code.toUpperCase()}</span>}
        </div>
      )}
      {sample ? (
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{sample.name}</p>
            <Badge tone="success">{discountLabel({ discount_type: d.discount_type, discount_value: value, currency: d.currency })}</Badge>
          </div>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{money(discounted(sample, d.discount_type, value), sample.currency ?? 'usd')}</span>
            <span className="text-sm text-subtle line-through">{money(sample.price_monthly_cents ?? 0, sample.currency ?? 'usd')}</span>
            <span className="text-xs text-muted">/ month</span>
          </p>
          {d.ends_at && <p className="mt-1 text-xs text-muted">Offer ends {dateTime(fromLocalInput(d.ends_at))}</p>}
          <p className="mt-2 text-xs text-subtle">
            Applies to {eligible.length} plan{eligible.length === 1 ? '' : 's'}: {eligible.map((p) => p.name).join(', ')}
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-[13px] text-muted">No paid, active plan matches this audience/plan selection.</p>
      )}
    </div>
  )
}

function PromotionEditor({ promo, onClose }: { promo: Promotion | null; onClose: () => void }) {
  const plans = useAdminPlans()
  const m = usePromotionMutations()
  const toast = useToast()
  const [d, setD] = useState<Draft>(() => toDraft(promo ?? undefined))
  const [error, setError] = useState<unknown>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const fe = error instanceof ApiError ? error.fieldErrors : {}
  const val = Number(d.value)
  const invalid =
    !d.name.trim() ||
    !d.value ||
    Number.isNaN(val) ||
    val <= 0 ||
    (d.discount_type === 'percent' && val > 100) ||
    (d.discount_type === 'free' && (!Number.isInteger(val) || val > 36 || !d.plan_codes.length)) ||
    (!!d.starts_at && !!d.ends_at && new Date(d.starts_at) >= new Date(d.ends_at)) ||
    (d.code !== '' && !/^[A-Z0-9_-]{3,32}$/i.test(d.code)) ||
    (d.max_redemptions !== '' && !/^\d+$/.test(d.max_redemptions))
  const free = d.discount_type === 'free'
  const planOptions = (plans.data ?? []).filter(
    (p) => (d.audience === 'all' || p.audience === d.audience) && (!free || (p.price_monthly_cents ?? 0) > 0),
  )
  const togglePlan = (code: string) => {
    const on = d.plan_codes.includes(code)
    if (on) return set('plan_codes', d.plan_codes.filter((c) => c !== code))
    // A free period gives one plan per account type: picking one replaces the other plan of that type.
    const audience = planOptions.find((p) => p.code === code)?.audience
    const keep = free ? d.plan_codes.filter((c) => planOptions.find((p) => p.code === c)?.audience !== audience) : d.plan_codes
    set('plan_codes', [...keep, code])
  }

  async function save() {
    setError(null)
    const body: PromotionInput = {
      name: d.name.trim(),
      code: !free && d.code.trim() ? d.code.trim().toUpperCase() : null,
      description: d.description.trim() || null,
      discount_type: d.discount_type,
      discount_value: d.discount_type === 'amount' ? Math.round(val * 100) : val,
      currency: d.discount_type === 'amount' ? d.currency : null,
      audience: d.audience,
      plan_codes: d.plan_codes.filter((c) => planOptions.some((p) => p.code === c)),
      starts_at: fromLocalInput(d.starts_at),
      ends_at: fromLocalInput(d.ends_at),
      is_active: d.is_active,
      show_on_landing: d.show_on_landing,
      banner_text: d.banner_text.trim() || null,
      max_redemptions: d.max_redemptions === '' ? null : Number(d.max_redemptions),
    }
    try {
      if (promo) await m.update.mutateAsync({ id: promo.id, body })
      else await m.create.mutateAsync(body)
      toast.success(promo ? 'Promotion saved' : 'Promotion created')
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={promo ? `Edit ${promo.name}` : 'New promotion'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={m.create.isPending || m.update.isPending} disabled={invalid}>
            {promo ? 'Save promotion' : 'Create promotion'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error != null && <ErrorAlert error={error} />}
        <Field label="Name" error={fe.name}>
          {(p) => <Input {...p} value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={80} data-autofocus />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Discount">
            {(p) => (
              <Select
                {...p}
                value={d.discount_type}
                onChange={(e) => {
                  const t = e.target.value as Draft['discount_type']
                  setD((x) => ({ ...x, discount_type: t, value: t === 'free' ? '12' : x.discount_type === 'free' ? '20' : x.value }))
                }}
              >
                <option value="percent">Percent</option>
                <option value="amount">Fixed amount</option>
                <option value="free">Free period</option>
              </Select>
            )}
          </Field>
          <Field
            label={free ? 'Months free' : d.discount_type === 'percent' ? 'Percent off' : 'Amount off'}
            hint={free ? '12 = one year' : undefined}
            error={fe.discount_value ?? (d.discount_type === 'percent' && val > 100 ? 'Max 100%' : free && val > 36 ? 'Max 36 months' : null)}
          >
            {(p) => <Input {...p} inputMode="decimal" value={d.value} onChange={(e) => set('value', e.target.value.replace(/[^\d.]/g, ''))} />}
          </Field>
          {d.discount_type === 'amount' ? (
            <Field label="Currency">
              {(p) => (
                <Select {...p} value={d.currency} onChange={(e) => set('currency', e.target.value)}>
                  {['usd', 'eur', 'gbp', 'rwf', 'kes'].map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : free ? (
            <p className="self-end pb-2 text-xs text-subtle">No code needed — free-plan accounts claim it from their dashboard.</p>
          ) : (
            <Field label="Coupon code" optional error={fe.code}>
              {(p) => <Input {...p} value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} className="font-mono uppercase" maxLength={32} />}
            </Field>
          )}
        </div>
        {d.discount_type === 'amount' && (
          <Field label="Coupon code" optional error={fe.code}>
            {(p) => <Input {...p} value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} className="font-mono uppercase" maxLength={32} />}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Audience">
            {(p) => (
              <Select {...p} value={d.audience} onChange={(e) => set('audience', e.target.value as Draft['audience'])}>
                <option value="all">Everyone</option>
                <option value="developer">Developers</option>
                <option value="business">Businesses</option>
                <option value="personal">Personal accounts</option>
              </Select>
            )}
          </Field>
          <Field label="Max redemptions" optional hint="Blank = unlimited">
            {(p) => <Input {...p} inputMode="numeric" value={d.max_redemptions} onChange={(e) => set('max_redemptions', e.target.value.replace(/\D/g, ''))} />}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">{free ? 'Plan to give' : 'Plans'}</legend>
          <p className="mb-2 text-xs text-subtle">
            {free ? 'Pick one paid plan per account type (developer, business, personal) — required.' : 'None selected = every plan of the audience.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {planOptions.map((p) => {
              const on = d.plan_codes.includes(p.code)
              return (
                <button
                  key={p.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePlan(p.code)}
                  className={cn('rounded-lg border px-2.5 py-1 text-xs', on ? 'border-accent bg-accent-soft text-fg' : 'border-border text-muted hover:border-border-strong')}
                >
                  {p.name} <span className="font-mono text-subtle">{p.code}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" optional hint="Your local time">
            {(p) => <Input {...p} type="datetime-local" value={d.starts_at} onChange={(e) => set('starts_at', e.target.value)} />}
          </Field>
          <Field label="Ends" optional error={d.starts_at && d.ends_at && new Date(d.starts_at) >= new Date(d.ends_at) ? 'Must be after the start' : null}>
            {(p) => <Input {...p} type="datetime-local" value={d.ends_at} onChange={(e) => set('ends_at', e.target.value)} />}
          </Field>
        </div>
        <Field label="Description" optional>
          {(p) => <Textarea {...p} rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={240} />}
        </Field>
        <div className="space-y-3 rounded-lg border border-border p-3">
          <label className="flex items-center justify-between gap-3 text-[13px] font-medium">
            Show a banner on the landing page
            <Switch checked={d.show_on_landing} onChange={(v) => set('show_on_landing', v)} label="Show on landing" />
          </label>
          {d.show_on_landing && (
            <Field label="Banner text" optional hint="Defaults to the name and discount.">
              {(p) => <Input {...p} value={d.banner_text} onChange={(e) => set('banner_text', e.target.value)} maxLength={120} />}
            </Field>
          )}
          <label className="flex items-center justify-between gap-3 text-[13px] font-medium">
            Active
            <Switch checked={d.is_active} onChange={(v) => set('is_active', v)} label="Active" />
          </label>
        </div>
        <Preview d={d} plans={plans.data ?? []} />
      </div>
    </Drawer>
  )
}

export default function AdminPromotionsPage() {
  useDocumentTitle('Admin · Promotions')
  const { data, isLoading, error, refetch } = useAdminPromotions()
  const m = usePromotionMutations()
  const toast = useToast()
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Promotion | null>(null)
  const [filter, setFilter] = useState<PromotionStatus | ''>('')
  const list = (data ?? []).filter((p) => !filter || p.status === filter)

  return (
    <>
      <PageHeader
        title="Promotions"
        description="Discounts shown on pricing and redeemable with coupon codes. Checkout itself is coming soon."
        actions={
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            New promotion
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
          <Select aria-label="Status" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-44">
            <option value="">All statuses</option>
            {(['active', 'scheduled', 'expired', 'exhausted', 'inactive'] as const).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : !list.length ? (
          <EmptyState icon={TicketPercent} title={filter ? 'No promotions with this status' : 'No promotions yet'} />
        ) : (
          <TableWrap>
            <Table className="min-w-[960px]">
              <THead>
                <tr>
                  <TH>Promotion</TH>
                  <TH>Status</TH>
                  <TH>Discount</TH>
                  <TH>Applies to</TH>
                  <TH>Schedule</TH>
                  <TH>Redemptions</TH>
                  <TH className="w-28">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {list.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <p className="flex items-center gap-1.5 font-medium">
                        {p.name}
                        {p.show_on_landing && <Megaphone className="h-3.5 w-3.5 text-accent" aria-label="Shown on landing" />}
                      </p>
                      {p.code && <p className="font-mono text-xs text-subtle">{p.code}</p>}
                    </TD>
                    <TD>
                      <Badge tone={statusTone[p.status]} dot>
                        {p.status}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap">{discountLabel(p)}</TD>
                    <TD className="text-xs text-muted">
                      <span className="capitalize">{p.audience === 'all' ? 'Everyone' : p.audience === 'personal' ? 'Personal accounts' : `${p.audience}s`}</span>
                      {p.plan_codes.length ? ` · ${p.plan_codes.join(', ')}` : ' · all plans'}
                    </TD>
                    <TD className="text-xs whitespace-nowrap text-muted">
                      <p>{p.starts_at ? dateTime(p.starts_at) : 'Now'}</p>
                      <p>→ {p.ends_at ? dateTime(p.ends_at) : 'No end'}</p>
                    </TD>
                    <TD className="min-w-[120px]">
                      <p className="text-[13px] tabular-nums">
                        {num(p.redemptions)}
                        {p.max_redemptions != null && <span className="text-subtle"> / {num(p.max_redemptions)}</span>}
                      </p>
                      {p.max_redemptions != null && (
                        <div className="mt-1 h-1 rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-accent-solid" style={{ width: `${Math.min(100, (p.redemptions / Math.max(1, p.max_redemptions)) * 100)}%` }} />
                        </div>
                      )}
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Switch
                          checked={p.is_active}
                          label={`${p.is_active ? 'Deactivate' : 'Activate'} ${p.name}`}
                          onChange={async (v) => {
                            try {
                              await m.setActive.mutateAsync({ id: p.id, active: v })
                              toast.success(`${p.name} ${v ? 'activated' : 'deactivated'}`)
                            } catch (e) {
                              toast.fromError(e)
                            }
                          }}
                        />
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
      {editing && <PromotionEditor key={editing === 'new' ? 'new' : editing.id} promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="The promotion and its coupon code stop working immediately. Consider deactivating instead to keep its history."
        confirmLabel="Delete"
        loading={m.remove.isPending}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await m.remove.mutateAsync(deleting.id)
            toast.success('Promotion deleted')
            setDeleting(null)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
    </>
  )
}
