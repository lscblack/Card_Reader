import { useRef, useState, type ReactNode } from 'react'
import { ImagePlus, Link2, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { RichText } from '@/components/ui/RichText'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Input'
import { useToast } from '@/components/ui/toastContext'
import { ApiError } from '@/api/client'
import { cn } from '@/lib/cn'
import { imgSrc } from '@/public/page/format'
import type { FormField, FormFieldType, LinkIcon, Price, ProductItem, SectionDataMap } from '../../api/types'
import { pageMediaApi } from '../../api/profiles'
import { checkImage } from '../../api/upload'
import { useBusiness } from '../../hooks/context'
import { DragHandle, SortableList } from './Sortable'
import { CurrencySelect } from './MenuEditor'

// ─────────────────────────── shared bits ───────────────────────────

/** Numbers stay numbers (formatted with the currency on the page); anything else is kept as text (e.g. "from $5"). */
const toPrice = (v: string): Price => (/^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : v)

function PriceInput({ value, onChange, label = 'Price', className, placeholder = '0.00' }: { value: Price | null | undefined; onChange: (v: Price) => void; label?: string; className?: string; placeholder?: string }) {
  return <Input aria-label={label} inputMode="decimal" placeholder={placeholder} value={value == null ? '' : String(value)} onChange={(e) => onChange(toPrice(e.target.value))} className={cn('tabular-nums', className)} maxLength={24} />
}

function useUpload() {
  const { business } = useBusiness()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const upload = async (file: File): Promise<string | null> => {
    const err = checkImage(file)
    if (err) {
      toast.error(err)
      return null
    }
    setBusy(true)
    try {
      return (await pageMediaApi.upload(business.id, file)).url
    } catch (e) {
      // Older servers have no page-image upload: fall back to pasting an https URL.
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) toast.error('Photo upload isn’t available on this server yet — use “URL” to paste an https image link.')
      else toast.error(e instanceof Error ? e.message : 'Upload failed')
      return null
    } finally {
      setBusy(false)
    }
  }
  return { busy, upload }
}

/** Image: upload (PNG/JPEG/WebP ≤ 2 MB) or paste an https URL. */
export function ImageField({ value, onChange, label, compact }: { value: string | null | undefined; onChange: (v: string | null) => void; label: string; compact?: boolean }) {
  const { busy, upload } = useUpload()
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(false)
  const src = imgSrc(value)
  return (
    <div className="flex items-start gap-2.5">
      <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2 text-subtle', compact ? 'h-12 w-12' : 'h-16 w-16')}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" leftIcon={<Upload className="h-3.5 w-3.5" />} onClick={() => input.current?.click()} disabled={busy}>
            {src ? 'Replace' : 'Upload'}
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setUrl((u) => !u)} aria-expanded={url}>
            URL
          </Button>
          {value && (
            <Button size="sm" variant="ghost" leftIcon={<X className="h-3.5 w-3.5" />} onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
        {url && <Input aria-label={`${label} URL`} type="url" placeholder="https://…/image.jpg" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />}
        {!compact && <p className="text-xs text-subtle">{label} · PNG, JPEG or WebP up to 2 MB.</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) {
            const u = await upload(f)
            if (u) onChange(u)
          }
        }}
      />
    </div>
  )
}

function Row({ children, handle, label, onRemove, className }: { children: ReactNode; handle: Record<string, unknown>; label: string; onRemove: () => void; className?: string }) {
  return (
    <div className={cn('flex gap-1.5 rounded-lg border border-border bg-surface p-2.5', className)}>
      <DragHandle handle={handle} label={`Drag to reorder ${label}`} className="mt-1" />
      <div className="min-w-0 flex-1">{children}</div>
      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove} className="mt-0.5">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function CtaInputs({ value, onChange }: { value: { label: string; url: string } | null | undefined; onChange: (v: { label: string; url: string } | null) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <Input aria-label="Button label" placeholder="Button label (e.g. Buy now)" value={value?.label ?? ''} onChange={(e) => onChange(e.target.value || value?.url ? { label: e.target.value, url: value?.url ?? '' } : null)} maxLength={60} />
      <Input aria-label="Button link" type="url" placeholder="https://…" value={value?.url ?? ''} onChange={(e) => onChange(e.target.value || value?.label ? { label: value?.label ?? '', url: e.target.value } : null)} />
    </div>
  )
}

function SectionTitle({ value, onChange, placeholder }: { value?: string; onChange: (v: string | undefined) => void; placeholder: string }) {
  return (
    <Field label="Section title" optional>
      {(p) => <Input {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} placeholder={placeholder} maxLength={120} />}
    </Field>
  )
}

// ─────────────────────────── products & services ───────────────────────────

export function ProductsEditor({ d, onChange }: { d: SectionDataMap['products'] & { title?: string }; onChange: (d: SectionDataMap['products'] & { title?: string }) => void }) {
  const items = d.items ?? []
  const set = (xs: ProductItem[]) => onChange({ ...d, items: xs })
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SectionTitle value={d.title} onChange={(title) => onChange({ ...d, title })} placeholder="e.g. Best sellers" />
        <Field label="Currency">{(p) => <CurrencySelect id={p.id} value={d.currency} onChange={(currency) => onChange({ ...d, currency })} />}</Field>
      </div>
      <SortableList items={items} onReorder={set} className="space-y-2" idPrefix="p">
        {(it, i, h) => {
          const up = (patch: Partial<ProductItem>) => set(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <Row handle={h.handle} label={it.title || `product ${i + 1}`} onRemove={() => set(items.filter((_, j) => j !== i))}>
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_100px]">
                  <Input aria-label="Product name" placeholder="Product name" value={it.title} onChange={(e) => up({ title: e.target.value })} maxLength={120} />
                  <PriceInput value={it.price} onChange={(price) => up({ price })} placeholder="0.00" />
                  <PriceInput label="Was (compare-at price)" value={it.compare_at_price} onChange={(v) => up({ compare_at_price: v === '' ? null : v })} placeholder="Was" />
                </div>
                <RichText inline rows={2} aria-label="Description" placeholder="Description" value={it.description ?? ''} onChange={(description) => up({ description })} maxLength={1000} />
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <Input aria-label="Badge" placeholder="Badge (e.g. New, Sale, -20%)" value={it.badge ?? ''} onChange={(e) => up({ badge: e.target.value || null })} maxLength={30} />
                  <label className="flex items-center gap-2 text-[13px] text-muted">
                    <Switch checked={it.in_stock !== false} onChange={(v) => up({ in_stock: v })} label="In stock" /> In stock
                  </label>
                </div>
                <CtaInputs value={it.cta ?? (it.url ? { label: 'View', url: it.url } : null)} onChange={(cta) => up({ cta, url: undefined })} />
                <ImageField compact label="Product photo" value={it.image_url} onChange={(image_url) => up({ image_url })} />
              </div>
            </Row>
          )
        }}
      </SortableList>
      <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => set([...items, { title: '', description: '', price: '', in_stock: true }])} disabled={items.length >= 100}>
        Add product
      </Button>
    </div>
  )
}

export function ServicesEditor({ d, onChange }: { d: SectionDataMap['services'] & { title?: string }; onChange: (d: SectionDataMap['services'] & { title?: string }) => void }) {
  const items = d.items ?? []
  const set = (xs: typeof items) => onChange({ ...d, items: xs })
  return (
    <div className="space-y-3">
      <SectionTitle value={d.title} onChange={(title) => onChange({ ...d, title })} placeholder="Services" />
      <SortableList items={items} onReorder={set} className="space-y-2" idPrefix="sv">
        {(it, i, h) => {
          const up = (patch: Partial<(typeof items)[number]>) => set(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <Row handle={h.handle} label={it.title || `service ${i + 1}`} onRemove={() => set(items.filter((_, j) => j !== i))}>
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_100px]">
                  <Input aria-label="Service" placeholder="Service" value={it.title} onChange={(e) => up({ title: e.target.value })} />
                  <PriceInput value={it.price} onChange={(price) => up({ price })} placeholder="Price" />
                  <Input aria-label="Duration" placeholder="e.g. 45 min" value={it.duration ?? ''} onChange={(e) => up({ duration: e.target.value || undefined })} maxLength={30} />
                </div>
                <Input aria-label="Description" placeholder="Description" value={it.description ?? ''} onChange={(e) => up({ description: e.target.value })} />
              </div>
            </Row>
          )
        }}
      </SortableList>
      <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => set([...items, { title: '', description: '', price: '' }])}>
        Add service
      </Button>
    </div>
  )
}

// ─────────────────────────── links ───────────────────────────

const ICONS: { v: LinkIcon; label: string }[] = [
  { v: 'link', label: 'Link' },
  { v: 'phone', label: 'Phone' },
  { v: 'email', label: 'Email' },
  { v: 'map', label: 'Map' },
  { v: 'whatsapp', label: 'WhatsApp' },
  { v: 'instagram', label: 'Instagram' },
  { v: 'facebook', label: 'Facebook' },
  { v: 'tiktok', label: 'TikTok' },
  { v: 'x', label: 'X' },
  { v: 'linkedin', label: 'LinkedIn' },
  { v: 'youtube', label: 'YouTube' },
  { v: 'github', label: 'GitHub' },
  { v: 'telegram', label: 'Telegram' },
  { v: 'pinterest', label: 'Pinterest' },
  { v: 'snapchat', label: 'Snapchat' },
]

export function LinksEditor({ d, onChange }: { d: SectionDataMap['links'] & { title?: string }; onChange: (d: SectionDataMap['links'] & { title?: string }) => void }) {
  const items = d.items ?? []
  const set = (xs: typeof items) => onChange({ ...d, items: xs })
  return (
    <div className="space-y-3">
      <SortableList items={items} onReorder={set} className="space-y-2" idPrefix="l">
        {(it, i, h) => {
          const up = (patch: Partial<(typeof items)[number]>) => set(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <Row handle={h.handle} label={it.label || `link ${i + 1}`} onRemove={() => set(items.filter((_, j) => j !== i))}>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px]">
                <Input aria-label="Label" placeholder="Label" value={it.label} onChange={(e) => up({ label: e.target.value })} maxLength={80} />
                <Select aria-label="Icon" value={it.icon ?? 'link'} onChange={(e) => up({ icon: e.target.value })}>
                  {ICONS.map((x) => (
                    <option key={x.v} value={x.v}>
                      {x.label}
                    </option>
                  ))}
                </Select>
                <Input aria-label="Link" placeholder="https://…, mailto:… or tel:…" value={it.url} onChange={(e) => up({ url: e.target.value })} className="sm:col-span-2" />
                <label className="flex items-center gap-2 text-[13px] text-muted sm:col-span-2">
                  <Switch checked={!!it.highlight} onChange={(v) => up({ highlight: v })} label="Highlight" /> Highlight (accent colour)
                </label>
              </div>
            </Row>
          )
        }}
      </SortableList>
      <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => set([...items, { label: '', url: 'https://', icon: 'link' }])} disabled={items.length >= 50}>
        Add link
      </Button>
    </div>
  )
}

// ─────────────────────────── offer / event / wifi ───────────────────────────

const toLocalInput = (iso: string | null | undefined) => (iso ? iso.replace(/Z$/, '').slice(0, 16) : '')

export function OfferEditor({ d, onChange }: { d: SectionDataMap['offer']; onChange: (d: SectionDataMap['offer']) => void }) {
  const up = (patch: Partial<SectionDataMap['offer']>) => onChange({ ...d, ...patch })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Headline">{(p) => <Input {...p} value={d.title} onChange={(e) => up({ title: e.target.value })} maxLength={120} />}</Field>
      <Field label="Discount label" optional hint="Big text, e.g. 20% OFF">
        {(p) => <Input {...p} value={d.discount_label ?? ''} onChange={(e) => up({ discount_label: e.target.value || undefined })} maxLength={40} />}
      </Field>
      <Field label="Description" optional className="sm:col-span-2">
        {(p) => <RichText {...p} rows={2} value={d.description ?? ''} onChange={(description) => up({ description })} maxLength={2000} />}
      </Field>
      <Field label="Coupon code" optional hint="Customers get a “Copy” button.">
        {(p) => <Input {...p} value={d.code ?? ''} onChange={(e) => up({ code: e.target.value.toUpperCase() || undefined })} maxLength={40} className="font-mono" />}
      </Field>
      <Field label="Valid until" optional hint="Shows “Expired” after this date.">
        {(p) => <Input {...p} type="date" value={(d.valid_until ?? '').slice(0, 10)} onChange={(e) => up({ valid_until: e.target.value || null })} />}
      </Field>
      <Field label="Terms" optional className="sm:col-span-2">
        {(p) => <Textarea {...p} rows={2} value={d.terms ?? ''} onChange={(e) => up({ terms: e.target.value || undefined })} maxLength={2000} />}
      </Field>
      <div className="space-y-1.5 sm:col-span-2">
        <p className="text-[13px] font-medium">Button <span className="font-normal text-subtle">(optional)</span></p>
        <CtaInputs value={d.cta} onChange={(cta) => up({ cta })} />
      </div>
    </div>
  )
}

export function EventEditor({ d, onChange }: { d: SectionDataMap['event']; onChange: (d: SectionDataMap['event']) => void }) {
  const up = (patch: Partial<SectionDataMap['event']>) => onChange({ ...d, ...patch })
  const endBeforeStart = !!d.ends_at && !!d.starts_at && d.ends_at < d.starts_at
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Event title" className="sm:col-span-2">
        {(p) => <Input {...p} value={d.title} onChange={(e) => up({ title: e.target.value })} maxLength={120} />}
      </Field>
      <Field label="Starts" hint="Local time of the venue.">
        {(p) => <Input {...p} type="datetime-local" value={toLocalInput(d.starts_at)} onChange={(e) => up({ starts_at: e.target.value ? `${e.target.value}:00` : '' })} />}
      </Field>
      <Field label="Ends" optional error={endBeforeStart ? 'Ends before it starts.' : null}>
        {(p) => <Input {...p} type="datetime-local" value={toLocalInput(d.ends_at)} onChange={(e) => up({ ends_at: e.target.value ? `${e.target.value}:00` : null })} />}
      </Field>
      <Field label="Venue" optional>
        {(p) => <Input {...p} value={d.venue ?? ''} onChange={(e) => up({ venue: e.target.value || undefined })} maxLength={120} />}
      </Field>
      <Field label="Address" optional>
        {(p) => <Input {...p} value={d.address ?? ''} onChange={(e) => up({ address: e.target.value || undefined })} maxLength={300} />}
      </Field>
      <Field label="Map search" optional hint="What Google Maps should look up (defaults to the address)." className="sm:col-span-2">
        {(p) => <Input {...p} value={d.map_query ?? ''} onChange={(e) => up({ map_query: e.target.value || undefined })} maxLength={300} />}
      </Field>
      <Field label="Description" optional className="sm:col-span-2">
        {(p) => <RichText {...p} rows={3} value={d.description ?? ''} onChange={(v) => up({ description: v || undefined })} maxLength={4000} />}
      </Field>
      <div className="space-y-1.5 sm:col-span-2">
        <p className="text-[13px] font-medium">Button <span className="font-normal text-subtle">(optional — tickets, RSVP site…)</span></p>
        <CtaInputs value={d.cta} onChange={(cta) => up({ cta })} />
      </div>
    </div>
  )
}

export function WifiEditor({ d, onChange }: { d: SectionDataMap['wifi'] & { title?: string }; onChange: (d: SectionDataMap['wifi'] & { title?: string }) => void }) {
  const up = (patch: Partial<SectionDataMap['wifi'] & { title?: string }>) => onChange({ ...d, ...patch })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Network name (SSID)">{(p) => <Input {...p} value={d.ssid} onChange={(e) => up({ ssid: e.target.value })} maxLength={32} />}</Field>
      <Field label="Security">
        {(p) => (
          <Select {...p} value={d.security} onChange={(e) => up({ security: e.target.value as 'WPA' | 'WEP' | 'nopass' })}>
            <option value="WPA">WPA/WPA2/WPA3</option>
            <option value="WEP">WEP</option>
            <option value="nopass">Open network</option>
          </Select>
        )}
      </Field>
      {d.security !== 'nopass' && (
        <Field label="Password" error={!d.password ? 'Required unless the network is open.' : null}>
          {(p) => <Input {...p} value={d.password ?? ''} onChange={(e) => up({ password: e.target.value })} maxLength={63} className="font-mono" autoComplete="off" />}
        </Field>
      )}
      <Field label="Label" optional>
        {(p) => <Input {...p} value={d.title ?? ''} onChange={(e) => up({ title: e.target.value || undefined })} placeholder="Free guest Wi-Fi" maxLength={120} />}
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-muted sm:col-span-2">
        <Switch checked={!!d.hidden} onChange={(v) => up({ hidden: v })} label="Hidden network" /> Hidden network (not broadcast)
      </label>
    </div>
  )
}

// ─────────────────────────── gallery ───────────────────────────

export function GalleryEditor({ d, onChange }: { d: SectionDataMap['gallery'] & { title?: string }; onChange: (d: SectionDataMap['gallery'] & { title?: string }) => void }) {
  const { busy, upload } = useUpload()
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const images = d.images ?? []
  const set = (xs: string[]) => onChange({ ...d, images: xs })
  return (
    <div className="space-y-3">
      <SectionTitle value={d.title} onChange={(title) => onChange({ ...d, title })} placeholder="e.g. Recent work" />
      {images.length > 0 && (
        <SortableList items={images} onReorder={set} grid className="grid grid-cols-3 gap-2 sm:grid-cols-4" idPrefix="g">
          {(src, i, h) => (
            <div className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-2">
              {imgSrc(src) ? <img src={imgSrc(src)!} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center p-1 text-center text-[10px] break-all text-subtle">{src}</span>}
              <DragHandle handle={h.handle} label={`Drag photo ${i + 1}`} className="absolute top-1 left-1 bg-surface/90" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => set(images.filter((_, j) => j !== i))} className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded bg-surface/90 text-muted hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </SortableList>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" leftIcon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} onClick={() => input.current?.click()} disabled={busy}>
          Upload photos
        </Button>
        <Input aria-label="Image URL" type="url" placeholder="…or paste an https image URL" value={url} onChange={(e) => setUrl(e.target.value)} className="h-8 max-w-xs" />
        <Button
          size="sm"
          variant="ghost"
          disabled={!/^https:\/\//.test(url)}
          onClick={() => {
            set([...images, url])
            setUrl('')
          }}
        >
          Add
        </Button>
      </div>
      <p className="text-xs text-subtle">{images.length ? 'Drag to reorder. Visitors can open photos full-screen.' : 'No photos yet — the page shows nothing until you add some.'}</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          const added: string[] = []
          for (const f of files.slice(0, 24)) {
            const u = await upload(f)
            if (u) added.push(u)
          }
          if (added.length) set([...images, ...added])
        }}
      />
    </div>
  )
}

// ─────────────────────────── form builder ───────────────────────────

const FIELD_TYPES: { v: FormFieldType; label: string }[] = [
  { v: 'text', label: 'Short text' },
  { v: 'textarea', label: 'Long text' },
  { v: 'email', label: 'Email' },
  { v: 'phone', label: 'Phone' },
  { v: 'rating', label: 'Star rating (1–5)' },
  { v: 'select', label: 'Choice (dropdown)' },
  { v: 'checkbox', label: 'Checkbox' },
]

const fieldId = (label: string, taken: Set<string>) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'field'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
}

export function FormBuilder({ d, onChange }: { d: SectionDataMap['form']; onChange: (d: SectionDataMap['form']) => void }) {
  const up = (patch: Partial<SectionDataMap['form']>) => onChange({ ...d, ...patch })
  const fields = d.fields ?? []
  const setFields = (xs: FormField[]) => up({ fields: xs })
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Form title">{(p) => <Input {...p} value={d.title} onChange={(e) => up({ title: e.target.value })} maxLength={120} />}</Field>
        <Field label="Button label">{(p) => <Input {...p} value={d.submit_label} onChange={(e) => up({ submit_label: e.target.value })} maxLength={40} placeholder="Send" />}</Field>
        <Field label="Intro" optional className="sm:col-span-2">
          {(p) => <Input {...p} value={d.description ?? ''} onChange={(e) => up({ description: e.target.value || undefined })} maxLength={1000} />}
        </Field>
        <Field label="Thank-you message" className="sm:col-span-2">
          {(p) => <Input {...p} value={d.success_message} onChange={(e) => up({ success_message: e.target.value })} maxLength={300} placeholder="Thank you!" />}
        </Field>
      </div>
      <p className="text-[13px] font-medium">
        Fields <span className="font-normal text-subtle">({fields.length}/12 · drag to reorder)</span>
      </p>
      <SortableList items={fields} onReorder={setFields} className="space-y-2" idPrefix="f">
        {(f, i, h) => {
          const upF = (patch: Partial<FormField>) => setFields(fields.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <Row handle={h.handle} label={f.label || `field ${i + 1}`} onRemove={() => setFields(fields.filter((_, j) => j !== i))}>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px]">
                <Input aria-label="Question" placeholder="Question / label" value={f.label} onChange={(e) => upF({ label: e.target.value })} maxLength={120} />
                <Select
                  aria-label="Field type"
                  value={f.type}
                  onChange={(e) => {
                    const type = e.target.value as FormFieldType
                    upF({ type, options: type === 'select' ? (f.options?.length ? f.options : ['Option 1', 'Option 2']) : undefined })
                  }}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.label}
                    </option>
                  ))}
                </Select>
                {f.type === 'select' && (
                  <Textarea
                    aria-label="Options, one per line"
                    rows={3}
                    placeholder="One option per line"
                    value={(f.options ?? []).join('\n')}
                    onChange={(e) => upF({ options: e.target.value.split('\n').map((o) => o.slice(0, 80)).slice(0, 20) })}
                    onBlur={() => upF({ options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) })}
                    className="min-h-[64px] sm:col-span-2"
                  />
                )}
                {['text', 'textarea', 'email', 'phone'].includes(f.type) && (
                  <Input aria-label="Placeholder" placeholder="Placeholder (optional)" value={f.placeholder ?? ''} onChange={(e) => upF({ placeholder: e.target.value || undefined })} maxLength={120} className="sm:col-span-2" />
                )}
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <Switch checked={f.required} onChange={(v) => upF({ required: v })} label="Required" /> Required
                </label>
                <span className="self-center text-right font-mono text-[11px] text-subtle" title="Field id (used in exports)">
                  {f.id}
                </span>
              </div>
            </Row>
          )
        }}
      </SortableList>
      <Button
        size="sm"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        disabled={fields.length >= 12}
        onClick={() => setFields([...fields, { id: fieldId(`question ${fields.length + 1}`, new Set(fields.map((x) => x.id))), label: '', type: 'text', required: false }])}
      >
        Add field
      </Button>
    </div>
  )
}
