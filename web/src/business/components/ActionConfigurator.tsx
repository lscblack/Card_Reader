import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Info, RefreshCw, Sparkles } from 'lucide-react'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Spinner'
import { useDebounced } from '@/hooks/useDebounce'
import { cn } from '@/lib/cn'
import type { Action, ActionField, ActionPreview, ActionTypeDef, ProfileType } from '../api/types'
import { actionsApi } from '../api/cards'
import { useBusiness } from '../hooks/context'
import { useActionTypes } from '../hooks/queries'
import { fieldErrorsOf, formatError } from '../lib/errors'
import { CUSTOMER_SEES, actionDetail, previewKindLabel } from '../lib/actionMeta'
import { actionLabel, isE164, normalizePhone } from '../lib/format'
import { BizAppSelect, EmployeeSelect, ProfileSelect } from './Pickers'
import { BizErrorState } from './BizError'
import { ActionIcon } from './bits'

function optionOf(o: string | { value: string; label: string }) {
  return typeof o === 'string' ? { value: o, label: o.charAt(0).toUpperCase() + o.slice(1) } : o
}

function PhoneInput({ id, value, onChange, invalid, describedBy }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string }) {
  const normalized = normalizePhone(value)
  const showHint = value.trim() !== '' && !isE164(normalized)
  return (
    <div className="space-y-1">
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+14155550123"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => value.trim() && onChange(normalized)}
      />
      {showHint && (
        <p className="text-[12px] text-amber-700 dark:text-amber-400">
          Use international (E.164) format: <span className="font-mono">+</span>country code and number, no spaces — e.g.{' '}
          <span className="font-mono">+14155550123</span>.
        </p>
      )}
    </div>
  )
}

function PasswordInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute top-1/2 right-1.5 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-2"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

/** Profile types a `profile` field may point at, when the backend doesn't say. */
const PROFILE_TYPES_BY_ACTION: Record<string, ProfileType[]> = { digital_menu: ['menu'], product_info: ['product'], profile: ['custom', 'menu', 'product'] }

/**
 * Normalises backend field types to widgets: `string` → single-line, `text` → multi-line, `number`
 * named lat/lng → coordinate inputs, a field named `password` → password input.
 */
function widgetOf(field: ActionField): string {
  if (field.name === 'password') return 'password'
  if (field.type === 'number' && (field.name === 'lat' || field.name === 'lng')) return field.name
  if (field.type === 'text') return 'textarea'
  if (field.type === 'string') return 'text'
  return field.type
}

function FieldControl({
  field: rawField,
  actionType,
  value,
  onChange,
  error,
  depth,
}: {
  field: ActionField
  actionType: string
  value: unknown
  onChange: (v: unknown) => void
  error?: string
  depth: number
}) {
  const field = { ...rawField, type: widgetOf(rawField), profile_types: rawField.profile_types ?? PROFILE_TYPES_BY_ACTION[actionType] ?? null }
  const label = field.label ?? field.name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  const sv = typeof value === 'string' ? value : value == null ? '' : String(value)
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
        <div>
          <p className="text-[13px] font-medium">{label}</p>
          {field.help && <p className="text-xs text-subtle">{field.help}</p>}
        </div>
        <Switch checked={Boolean(value)} onChange={onChange} label={label} />
      </div>
    )
  }
  if (field.type === 'action') {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-border-strong p-3 sm:col-span-2">
        <p className="flex items-center gap-1.5 text-[13px] font-medium">
          <ArrowRight className="h-3.5 w-3.5 text-subtle" /> {label}
        </p>
        {field.help && <p className="text-xs text-subtle">{field.help}</p>}
        <ActionConfigurator
          value={(value as Action | null) ?? null}
          onChange={(a) => onChange(a)}
          allowDefault
          defaultLabel="Business profile (default)"
          exclude={['developer_webhook']}
          depth={depth + 1}
          showPreview={false}
        />
      </div>
    )
  }
  const half = field.type === 'lat' || field.type === 'lng'
  return (
    <Field label={label} optional={!field.required && !field.one_of} hint={field.help ?? undefined} error={error} className={half ? '' : 'sm:col-span-2'}>
      {(p) => {
        switch (field.type) {
          case 'phone':
            return <PhoneInput id={p.id} value={sv} onChange={onChange} invalid={!!error} describedBy={p['aria-describedby']} />
          case 'password':
            return <PasswordInput id={p.id} value={sv} onChange={onChange} />
          case 'textarea':
            return <Textarea {...p} rows={3} value={sv} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? undefined} />
          case 'select':
            return (
              <Select {...p} value={sv || String(field.default ?? '')} onChange={(e) => onChange(e.target.value)}>
                {!field.required && <option value="">—</option>}
                {(field.options ?? []).map(optionOf).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )
          case 'profile':
            return <ProfileSelect id={p.id} value={sv} onChange={(v) => onChange(v || null)} types={field.profile_types} />
          case 'employee':
            return <EmployeeSelect id={p.id} value={sv} onChange={(v) => onChange(v || null)} emptyLabel="Card holder (default)" />
          case 'application':
            return <BizAppSelect id={p.id} value={sv} onChange={(v) => onChange(v || null)} />
          case 'lat':
          case 'lng':
            return (
              <Input
                {...p}
                type="number"
                inputMode="decimal"
                step="any"
                min={field.type === 'lat' ? -90 : -180}
                max={field.type === 'lat' ? 90 : 180}
                placeholder={field.type === 'lat' ? '37.7749' : '-122.4194'}
                value={sv}
                onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
              />
            )
          case 'number':
            return <Input {...p} type="number" value={sv} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
          default:
            return (
              <Input
                {...p}
                type={field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text'}
                inputMode={field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : undefined}
                placeholder={field.placeholder ?? (field.type === 'url' ? 'https://' : undefined)}
                value={sv}
                onChange={(e) => onChange(e.target.value)}
              />
            )
        }
      }}
    </Field>
  )
}

function TypeGrid({ types, value, onPick, allowDefault, defaultLabel }: { types: ActionTypeDef[]; value: string | null; onPick: (t: string | null) => void; allowDefault?: boolean; defaultLabel: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Action type">
      {allowDefault && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onPick(null)}
          className={cn(
            'flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
            value === null ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong hover:bg-surface-2',
          )}
        >
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{defaultLabel}</span>
            <span className="block text-xs text-subtle">Follows the business default.</span>
          </span>
        </button>
      )}
      {types.map((t) => {
        const active = value === t.type
        return (
          <button
            key={t.type}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(t.type)}
            className={cn(
              'flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
              active ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong hover:bg-surface-2',
            )}
          >
            <ActionIcon type={t.type} className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-accent' : 'text-subtle')} />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t.label}</span>
              <span className="line-clamp-2 block text-xs text-subtle">{t.description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PreviewPanel({ action, cardId }: { action: Action; cardId?: string }) {
  const { business } = useBusiness()
  const debounced = useDebounced(action, 450)
  const key = JSON.stringify(debounced)
  const [state, setState] = useState<{ key: string; data?: ActionPreview; error?: unknown } | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let cancelled = false
    actionsApi
      .preview(business.id, JSON.parse(key) as Action, cardId)
      .then((data) => !cancelled && setState({ key, data }))
      .catch((error: unknown) => !cancelled && setState({ key, error }))
    return () => {
      cancelled = true
    }
  }, [key, business.id, cardId, nonce])
  const loading = !state || state.key !== key
  const fieldErrs = state?.error ? fieldErrorsOf(state.error) : {}
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 p-3" aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-subtle uppercase">Live preview</p>
        <Button size="icon-sm" variant="ghost" aria-label="Refresh preview" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>
      <p className="text-[13px] text-fg">{CUSTOMER_SEES[action.type] ?? 'The configured action runs.'}</p>
      <div className="mt-2">
        {loading && !state ? (
          <Skeleton className="h-5 w-3/4" />
        ) : state?.error ? (
          <p className="text-[12.5px] text-amber-700 dark:text-amber-400">
            {Object.keys(fieldErrs).length ? `Incomplete: ${Object.entries(fieldErrs).map(([k, v]) => `${k} — ${v}`).join('; ')}` : formatError(state.error)}
          </p>
        ) : state?.data ? (
          <div className={cn('flex flex-wrap items-center gap-2 transition-opacity', loading && 'opacity-60')}>
            <Badge tone="accent">{previewKindLabel(state.data.kind)}</Badge>
            {state.data.resolved_url ? (
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" title={state.data.resolved_url}>
                {state.data.resolved_url}
              </code>
            ) : (
              <span className="text-[12.5px] text-muted">{state.data.kind === 'vcard' ? 'A .vcf contact file is downloaded.' : 'No redirect URL.'}</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Renders an action form from the backend's `GET /actions/types` field definitions. `value = null`
 * means "use the business default" when `allowDefault` is set.
 */
export function ActionConfigurator({
  value,
  onChange,
  allowDefault = false,
  defaultLabel = 'Business default',
  exclude = [],
  cardId,
  errors,
  depth = 0,
  showPreview = true,
}: {
  value: Action | null
  onChange: (a: Action | null) => void
  allowDefault?: boolean
  defaultLabel?: string
  exclude?: string[]
  cardId?: string
  errors?: Record<string, string>
  depth?: number
  showPreview?: boolean
}) {
  const types = useActionTypes()
  const [picking, setPicking] = useState(value == null && !allowDefault)
  const available = useMemo(() => (types.data ?? []).filter((t) => !exclude.includes(t.type)), [types.data, exclude])
  const def = available.find((t) => t.type === value?.type)

  if (types.error) return <BizErrorState error={types.error} onRetry={() => types.refetch()} />
  if (types.isLoading) {
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    )
  }

  const pick = (t: string | null) => {
    setPicking(false)
    if (t === null) return onChange(null)
    if (t === value?.type) return
    const d = available.find((x) => x.type === t)
    const config: Record<string, unknown> = {}
    for (const f of d?.fields ?? []) if (f.default !== undefined) config[f.name] = f.default
    onChange({ type: t, config })
  }

  if (picking || (!value && !allowDefault)) {
    return (
      <div className="space-y-3">
        <TypeGrid types={available} value={value?.type ?? (allowDefault ? null : '')} onPick={pick} allowDefault={allowDefault} defaultLabel={defaultLabel} />
        {value && (
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
            Keep “{actionLabel(value.type)}”
          </Button>
        )}
      </div>
    )
  }

  const setField = (name: string, v: unknown) => {
    if (!value) return
    const config = { ...value.config }
    if (v === null || v === undefined || v === '') delete config[name]
    else config[name] = v
    onChange({ ...value, config })
  }
  const groups = [...new Set((def?.fields ?? []).map((f) => f.one_of).filter(Boolean))] as string[]

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <ActionIcon type={value?.type ?? null} className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">{value ? (def?.label ?? actionLabel(value.type)) : defaultLabel}</p>
          <p className="text-xs text-muted">{value ? (def?.description ?? actionDetail(value)) : 'Uses the business default action (your business profile unless changed in Actions).'}</p>
        </div>
        <Button size="sm" onClick={() => setPicking(true)}>
          Change
        </Button>
      </div>

      {value && def && def.fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <p key={g} className="flex items-center gap-1.5 text-xs text-subtle sm:col-span-2">
              <Info className="h-3.5 w-3.5" /> Fill in one of:{' '}
              {def.fields
                .filter((f) => f.one_of === g)
                .map((f) => f.label ?? f.name)
                .join(' / ')}
            </p>
          ))}
          {def.fields.map((f) => (
            <FieldControl key={f.name} field={f} actionType={value.type} value={value.config[f.name]} onChange={(v) => setField(f.name, v)} error={errors?.[f.name]} depth={depth} />
          ))}
          <Field label="Button label" optional hint="Shown on intermediate pages and in reports." className="sm:col-span-2">
            {(p) => <Input {...p} value={value.label ?? ''} onChange={(e) => onChange({ ...value, label: e.target.value || null })} maxLength={60} />}
          </Field>
        </div>
      )}
      {value && def && def.fields.length === 0 && <p className="text-[13px] text-muted">Nothing to configure — this action works out of the box.</p>}

      {showPreview && depth === 0 && value && <PreviewPanel action={value} cardId={cardId} />}
      {showPreview && depth === 0 && !value && (
        <p className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5 text-[13px] text-muted">{CUSTOMER_SEES.business_profile}</p>
      )}
    </div>
  )
}

/** Compact read-only summary of an action. */
export function ActionSummary({ action, fallback = 'Business default', className }: { action: Action | null | undefined; fallback?: string; className?: string }) {
  const detail = actionDetail(action)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <ActionIcon type={action?.type ?? null} className="h-3.5 w-3.5 shrink-0 text-subtle" />
      <span className="truncate">
        {action ? (action.label || actionLabel(action.type)) : <span className="text-muted">{fallback}</span>}
        {detail && <span className="text-subtle"> · {detail}</span>}
      </span>
    </span>
  )
}
