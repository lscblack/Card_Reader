import { useState } from 'react'
import { ArrowDown, ArrowUp, CreditCard, GripVertical, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import type { Plan, PlanInput } from '@/api/types'
import { ApiError } from '@/api/client'
import { useAdminPlans, usePlanMutations } from '@/hooks/useAdmin3'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { compact, money } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Input'
import { ConfirmDialog, Drawer } from '@/components/ui/Modal'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/toastContext'

type Audience = 'developer' | 'business' | 'personal'

const LIMITS: { key: keyof Plan; label: string; audiences: Audience[] }[] = [
  { key: 'events_per_month', label: 'Events / month', audiences: ['developer', 'business'] },
  { key: 'max_applications', label: 'Applications', audiences: ['developer', 'business'] },
  { key: 'max_devices', label: 'Devices', audiences: ['developer', 'business'] },
  { key: 'max_cards', label: 'Cards', audiences: ['business', 'personal'] },
  { key: 'max_members', label: 'Team members', audiences: ['business'] },
  { key: 'max_contacts', label: 'Contacts', audiences: ['personal'] },
]
const limitsFor = (aud: Audience | undefined) => LIMITS.filter((l) => l.audiences.includes(aud ?? 'developer'))

const lim = (v: number | null | undefined) => (v == null ? '∞' : compact(v))
const toCents = (s: string) => (s.trim() === '' ? null : Math.round(Number(s) * 100))
const fromCents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(c % 100 ? 2 : 0))

interface Draft {
  code: string
  name: string
  audience: Audience
  description: string
  badge: string
  is_featured: boolean
  is_active: boolean
  currency: string
  monthly: string
  yearly: string
  limits: Record<string, string>
  features: string[]
}

function toDraft(p?: Plan): Draft {
  return {
    code: p?.code ?? '',
    name: p?.name ?? '',
    audience: p?.audience ?? 'developer',
    description: p?.description ?? '',
    badge: p?.badge ?? '',
    is_featured: !!p?.is_featured,
    is_active: p?.is_active ?? true,
    currency: (p?.currency ?? 'usd').toLowerCase(),
    monthly: fromCents(p?.price_monthly_cents ?? 0),
    yearly: fromCents(p?.price_yearly_cents),
    limits: Object.fromEntries(LIMITS.map((l) => [l.key, p?.[l.key] == null ? '' : String(p[l.key])])),
    features: p?.features?.length ? [...p.features] : [''],
  }
}

function PlanEditor({ plan, open, onClose, nextOrder }: { plan: Plan | null; open: boolean; onClose: () => void; nextOrder: number }) {
  const m = usePlanMutations()
  const toast = useToast()
  const creating = !plan
  const [d, setD] = useState<Draft>(() => toDraft(plan ?? undefined))
  const [error, setError] = useState<unknown>(null)
  const fe = error instanceof ApiError ? error.fieldErrors : {}
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const monthly = toCents(d.monthly)
  const yearly = toCents(d.yearly)
  const invalid =
    !d.name.trim() ||
    (creating && !/^[a-z0-9_]{2,32}$/.test(d.code)) ||
    monthly == null ||
    Number.isNaN(monthly) ||
    monthly < 0 ||
    (yearly != null && (Number.isNaN(yearly) || yearly < 0)) ||
    Object.values(d.limits).some((v) => v.trim() !== '' && (!/^\d+$/.test(v.trim())))

  async function save() {
    setError(null)
    const body: PlanInput = {
      name: d.name.trim(),
      audience: d.audience,
      description: d.description.trim() || null,
      badge: d.badge.trim() || null,
      is_featured: d.is_featured,
      currency: d.currency,
      price_monthly_cents: monthly ?? 0,
      price_yearly_cents: yearly,
      features: d.features.map((f) => f.trim()).filter(Boolean),
      ...Object.fromEntries(
        limitsFor(d.audience).map((l) => [l.key, d.limits[l.key].trim() === '' ? null : Number(d.limits[l.key])]),
      ),
    }
    try {
      if (creating) await m.create.mutateAsync({ ...body, code: d.code, is_active: d.is_active, sort_order: nextOrder })
      else await m.update.mutateAsync({ code: plan.code, body })
      toast.success(creating ? 'Plan created' : 'Plan saved')
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  const moveFeature = (i: number, dir: -1 | 1) => {
    const f = [...d.features]
    const j = i + dir
    if (j < 0 || j >= f.length) return
    ;[f[i], f[j]] = [f[j], f[i]]
    set('features', f)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={creating ? 'New plan' : `Edit ${plan.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={m.create.isPending || m.update.isPending} disabled={invalid}>
            {creating ? 'Create plan' : 'Save plan'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error != null && <ErrorAlert error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={fe.name}>
            {(p) => <Input {...p} value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={60} data-autofocus />}
          </Field>
          <Field label="Code" hint={creating ? 'Lowercase, digits, _ — cannot change later.' : 'Immutable.'} error={fe.code}>
            {(p) => <Input {...p} value={d.code} onChange={(e) => set('code', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} disabled={!creating} className="font-mono text-[13px]" />}
          </Field>
          <Field label="Audience">
            {(p) => (
              <Select {...p} value={d.audience} onChange={(e) => set('audience', e.target.value as Draft['audience'])}>
                <option value="developer">Developers</option>
                <option value="business">Businesses</option>
                <option value="personal">Personal (digital cards)</option>
              </Select>
            )}
          </Field>
          <Field label="Badge" optional hint="E.g. “Most popular”.">
            {(p) => <Input {...p} value={d.badge} onChange={(e) => set('badge', e.target.value)} maxLength={24} />}
          </Field>
        </div>
        <Field label="Description" optional>
          {(p) => <Textarea {...p} rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={200} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Monthly price" hint={`In ${d.currency.toUpperCase()}`} error={fe.price_monthly_cents}>
            {(p) => <Input {...p} inputMode="decimal" value={d.monthly} onChange={(e) => set('monthly', e.target.value.replace(/[^\d.]/g, ''))} />}
          </Field>
          <Field label="Yearly price" optional hint="Blank = no yearly option">
            {(p) => <Input {...p} inputMode="decimal" value={d.yearly} onChange={(e) => set('yearly', e.target.value.replace(/[^\d.]/g, ''))} />}
          </Field>
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
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Limits</p>
          <p className="mb-2 text-xs text-subtle">Leave blank for unlimited.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {limitsFor(d.audience).map((l) => (
              <Field key={l.key} label={l.label}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    placeholder="Unlimited"
                    value={d.limits[l.key]}
                    onChange={(e) => set('limits', { ...d.limits, [l.key]: e.target.value.replace(/\D/g, '') })}
                  />
                )}
              </Field>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Features</p>
          <ul className="space-y-2">
            {d.features.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <GripVertical className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                <Input
                  aria-label={`Feature ${i + 1}`}
                  value={f}
                  onChange={(e) => set('features', d.features.map((x, j) => (j === i ? e.target.value : x)))}
                  maxLength={80}
                  placeholder="E.g. Request logs & error refs"
                />
                <Button size="icon-sm" variant="ghost" aria-label="Move up" onClick={() => moveFeature(i, -1)} disabled={i === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move down" onClick={() => moveFeature(i, 1)} disabled={i === d.features.length - 1}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove feature" onClick={() => set('features', d.features.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <Button size="sm" className="mt-2" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('features', [...d.features, ''])} disabled={d.features.length >= 12}>
            Add feature
          </Button>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={d.is_featured} onChange={(v) => set('is_featured', v)} label="Featured" /> Featured (highlighted on pricing)
          </label>
          {creating && (
            <label className="flex items-center gap-2 text-[13px]">
              <Switch checked={d.is_active} onChange={(v) => set('is_active', v)} label="Active" /> Active
            </label>
          )}
        </div>
      </div>
    </Drawer>
  )
}

function PlanTable({ plans, all }: { plans: Plan[]; all: Plan[] }) {
  const m = usePlanMutations()
  const toast = useToast()
  const [editing, setEditing] = useState<Plan | null>(null)
  const [deactivate, setDeactivate] = useState<Plan | null>(null)

  async function move(p: Plan, dir: -1 | 1) {
    const i = plans.indexOf(p)
    const other = plans[i + dir]
    if (!other) return
    const a = p.sort_order ?? i + 1
    const b = other.sort_order ?? i + 1 + dir
    try {
      await Promise.all([
        m.update.mutateAsync({ code: p.code, body: { sort_order: a === b ? b + dir : b } }),
        m.update.mutateAsync({ code: other.code, body: { sort_order: a } }),
      ])
    } catch (e) {
      toast.fromError(e)
    }
  }

  return (
    <>
      <TableWrap>
        <Table className="min-w-[860px]">
          <THead>
            <tr>
              <TH className="w-16">Order</TH>
              <TH>Plan</TH>
              <TH>Price</TH>
              <TH>Limits</TH>
              <TH>Status</TH>
              <TH className="w-20">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {plans.map((p, i) => (
              <TR key={p.code} className={cn(p.is_active === false && 'opacity-60')}>
                <TD>
                  <div className="flex flex-col">
                    <button className="rounded p-0.5 text-subtle hover:text-fg disabled:opacity-30" onClick={() => void move(p, -1)} disabled={i === 0} aria-label={`Move ${p.name} up`}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button className="rounded p-0.5 text-subtle hover:text-fg disabled:opacity-30" onClick={() => void move(p, 1)} disabled={i === plans.length - 1} aria-label={`Move ${p.name} down`}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TD>
                <TD>
                  <p className="flex items-center gap-1.5 font-medium">
                    {p.name}
                    {p.is_featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Featured" />}
                    {p.badge && <Badge tone="accent">{p.badge}</Badge>}
                  </p>
                  <p className="font-mono text-xs text-subtle">{p.code}</p>
                  {p.promotion && <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">Promo: {p.promotion.name}</p>}
                </TD>
                <TD className="whitespace-nowrap">
                  <p className="font-medium">{money(p.price_monthly_cents ?? 0, p.currency ?? 'usd')}/mo</p>
                  {p.price_yearly_cents != null && <p className="text-xs text-muted">{money(p.price_yearly_cents, p.currency ?? 'usd')}/yr</p>}
                </TD>
                <TD className="text-xs text-muted">
                  {limitsFor(p.audience)
                    .map((l) => `${lim(p[l.key] as number | null)} ${l.label.toLowerCase()}`)
                    .join(' · ')}
                </TD>
                <TD>
                  <Switch
                    checked={p.is_active !== false}
                    label={`${p.is_active !== false ? 'Deactivate' : 'Activate'} ${p.name}`}
                    onChange={async (v) => {
                      if (!v) return setDeactivate(p)
                      try {
                        await m.setActive.mutateAsync({ code: p.code, active: true })
                        toast.success(`${p.name} is active`)
                      } catch (e) {
                        toast.fromError(e)
                      }
                    }}
                  />
                </TD>
                <TD className="text-right">
                  <Button size="sm" variant="ghost" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      {editing && <PlanEditor key={editing.code} plan={editing} open onClose={() => setEditing(null)} nextOrder={all.length + 1} />}
      <ConfirmDialog
        open={!!deactivate}
        onClose={() => setDeactivate(null)}
        title={`Deactivate ${deactivate?.name}?`}
        description="It disappears from public pricing and can’t be chosen by new customers. Existing subscribers keep it."
        confirmLabel="Deactivate"
        loading={m.setActive.isPending}
        onConfirm={async () => {
          if (!deactivate) return
          try {
            await m.setActive.mutateAsync({ code: deactivate.code, active: false })
            toast.success(`${deactivate.name} deactivated`)
            setDeactivate(null)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
    </>
  )
}

export default function AdminPlansPage() {
  useDocumentTitle('Admin · Plans')
  const { data, isLoading, error, refetch } = useAdminPlans()
  const [creating, setCreating] = useState(false)
  const groups = (['developer', 'business', 'personal'] as const).map((aud) => ({
    aud,
    plans: (data ?? []).filter((p) => (p.audience ?? 'developer') === aud).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
  }))
  return (
    <>
      <PageHeader
        title="Plans"
        description="Pricing shown on the landing page and in-app. Plans with subscribers can be deactivated but not deleted."
        actions={
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New plan
          </Button>
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <Card>
          <SkeletonRows rows={6} cols={5} />
        </Card>
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={CreditCard} title="No plans yet" />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <Card key={g.aud}>
              <CardHeader title={g.aud === 'developer' ? 'Developer plans' : g.aud === 'business' ? 'Business plans' : 'Personal plans'} description={`${g.plans.filter((p) => p.is_active !== false).length} active of ${g.plans.length}`} />
              {g.plans.length ? <PlanTable plans={g.plans} all={data} /> : <EmptyState title="No plans for this audience" />}
            </Card>
          ))}
        </div>
      )}
      {creating && <PlanEditor plan={null} open onClose={() => setCreating(false)} nextOrder={(data?.length ?? 0) + 1} />}
    </>
  )
}
