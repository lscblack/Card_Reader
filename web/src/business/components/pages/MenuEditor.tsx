import { useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ImageIcon, Pencil, Plus, Tag, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Switch } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { RichText } from '@/components/ui/RichText'
import { cn } from '@/lib/cn'
import { formatPrice, imgSrc } from '@/public/page/format'
import type { MenuItem, Price, SectionDataMap } from '../../api/types'
import { CURRENCIES, PRESET_TAGS, TAG_IDEAS, itemTags, withTags } from '../../lib/menu'
import { DragHandle, SortableList } from './Sortable'
import { ImageField } from './PageSectionEditors'

type MenuData = SectionDataMap['menu'] & { title?: string }
type Cat = MenuData['categories'][number]

const toPrice = (v: string): Price => (/^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : v)
const priceText = (p: Price | null | undefined) => (p == null ? '' : String(p))
const strip = (s: string) => s.replace(/\*\*|\*|\[([^\]]+)\]\([^)]+\)/g, '$1')

/** Currency picker: the common list plus whatever the page already uses. */
export function CurrencySelect({ value, onChange, id }: { value: string | undefined; onChange: (v: string | undefined) => void; id?: string }) {
  const known = CURRENCIES.some((c) => c.code === value)
  return (
    <Select id={id} aria-label="Currency" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">No currency (numbers only)</option>
      {value && !known && <option value={value}>{value}</option>}
      {CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} — {c.name}
        </option>
      ))}
    </Select>
  )
}

/** Tag chips + free input. Preset tags keep their icon on the page; anything typed becomes a custom tag. */
function TagPicker({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [text, setText] = useState('')
  const has = (t: string) => value.some((v) => v.toLowerCase() === t.toLowerCase())
  const add = (t: string) => {
    const l = t.trim().slice(0, 30)
    if (l && !has(l) && value.length < 12) onChange([...value, l])
    setText('')
  }
  const ideas = suggestions.filter((s) => !has(s) && (!text || s.toLowerCase().includes(text.toLowerCase()))).slice(0, 14)
  return (
    <div className="space-y-2">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20">
        {value.map((t) => (
          <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft pr-1 pl-2.5 text-[12.5px] font-medium text-accent">
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded-full p-0.5 hover:bg-accent/15" aria-label={`Remove tag ${t}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => text.trim() && add(text)}
          placeholder={value.length ? 'Add another…' : 'Type a tag and press Enter'}
          aria-label="Add a tag"
          maxLength={30}
          className="h-7 min-w-[140px] flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
        />
      </div>
      {!!ideas.length && (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggested tags">
          {ideas.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 text-[12px] text-muted hover:border-accent hover:text-fg">
              <Plus className="h-3 w-3" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Focused dialog for one item: the only place with every field, so the list itself stays short. */
function ItemDialog({
  item,
  position,
  onChange,
  onClose,
  onPrev,
  onNext,
  onDelete,
  suggestions,
  currency,
}: {
  item: MenuItem
  position: string
  onChange: (v: MenuItem) => void
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onDelete: () => void
  suggestions: string[]
  currency?: string
}) {
  const [sizes, setSizes] = useState(!!item.variants?.length)
  const up = (patch: Partial<MenuItem>) => onChange({ ...item, ...patch })
  const variants = item.variants ?? []
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={item.name || 'New item'}
      description={position}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" leftIcon={<Trash2 className="h-4 w-4" />} onClick={onDelete} className="text-red-600 dark:text-red-400">
            Delete
          </Button>
          <span className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="Previous item" onClick={onPrev} disabled={!onPrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Next item" onClick={onNext} disabled={!onNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
          <Field label="Name">{(p) => <Input {...p} value={item.name} onChange={(e) => up({ name: e.target.value })} maxLength={120} placeholder="e.g. Classic cheeseburger" />}</Field>
          {!variants.length && (
            <Field label="Price" hint={currency ? `In ${currency}` : undefined}>
              {(p) => <Input {...p} inputMode="decimal" value={priceText(item.price)} onChange={(e) => up({ price: toPrice(e.target.value) })} placeholder="0.00" className="tabular-nums" maxLength={24} />}
            </Field>
          )}
        </div>
        <Field label="Photo" optional>
          {() => <ImageField label="Photo" value={item.image_url} onChange={(image_url) => up({ image_url })} />}
        </Field>
        <Field label="Description" optional>
          {(p) => <RichText {...p} inline rows={2} value={item.description ?? ''} onChange={(description) => up({ description })} maxLength={500} placeholder="Ingredients, portion, how it’s made…" />}
        </Field>
        <Field label="Tags" optional hint="Use the suggestions or create your own (e.g. Halal, Chef’s pick). Sold out greys the item out.">
          {() => <TagPicker value={itemTags(item)} onChange={(labels) => onChange(withTags(item, labels))} suggestions={suggestions} />}
        </Field>
        <div className="rounded-lg border border-border">
          <button type="button" onClick={() => setSizes((s) => !s)} aria-expanded={sizes} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium">
            <ChevronDown className={cn('h-4 w-4 text-subtle transition-transform', sizes && 'rotate-180')} />
            Sizes & options
            <span className="text-xs font-normal text-subtle">{variants.length ? `${variants.length} with their own price` : 'e.g. Small / Large'}</span>
          </button>
          {sizes && (
            <div className="space-y-2 border-t border-border p-3">
              {variants.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label="Size or option" placeholder="e.g. Large" value={v.label} onChange={(e) => up({ variants: variants.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} maxLength={60} />
                  <Input aria-label="Price" inputMode="decimal" placeholder="0.00" value={priceText(v.price)} onChange={(e) => up({ variants: variants.map((x, j) => (j === i ? { ...x, price: toPrice(e.target.value) } : x)) })} className="w-28 tabular-nums" maxLength={24} />
                  <Button size="icon" variant="ghost" aria-label="Remove option" onClick={() => up({ variants: variants.filter((_, j) => j !== i) })}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => up({ variants: [...variants, { label: '', price: '' }] })} disabled={variants.length >= 10}>
                Add option
              </Button>
              {!!variants.length && <p className="text-xs text-subtle">Each option shows its own price; the single price is hidden.</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ItemRow({ it, currency, showImages, onOpen, onRemove, handle }: { it: MenuItem; currency?: string; showImages: boolean; onOpen: () => void; onRemove: () => void; handle: Record<string, unknown> }) {
  const img = imgSrc(it.image_url)
  const tags = itemTags(it)
  const price = it.variants?.length ? `${it.variants.length} options` : formatPrice(it.price, currency)
  const sold = it.badges?.includes('sold_out')
  return (
    <div className="group flex items-center gap-1.5 rounded-lg border border-border bg-surface py-1.5 pr-1.5 pl-1 hover:border-border-strong">
      <DragHandle handle={handle} label={`Drag to reorder ${it.name || 'item'}`} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        {showImages && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-subtle">
            {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4" />}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13.5px] font-medium', !it.name && 'text-subtle italic', sold && 'line-through opacity-60')}>{it.name || 'Untitled item'}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-subtle">
            {it.description ? <span className="truncate">{strip(it.description)}</span> : <span className="italic">No description</span>}
          </span>
        </span>
        {!!tags.length && (
          <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted sm:flex">
            <Tag className="h-3 w-3" /> {tags.length > 2 ? `${tags.slice(0, 2).join(', ')} +${tags.length - 2}` : tags.join(', ')}
          </span>
        )}
        <span className="shrink-0 pl-1 text-[13px] font-semibold tabular-nums">{price || <span className="font-normal text-subtle">—</span>}</span>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-subtle opacity-60 group-hover:opacity-100" />
      </button>
      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${it.name || 'item'}`} onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function QuickAdd({ onAdd, currency }: { onAdd: (name: string, price: Price) => void; currency?: string }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return nameRef.current?.focus()
    onAdd(name.trim(), toPrice(price))
    setName('')
    setPrice('')
    nameRef.current?.focus()
  }
  return (
    // Not a <form>: this sits inside the page editor, and nested forms are invalid HTML.
    <div className="flex gap-1.5 rounded-lg border border-dashed border-border-strong p-1.5" onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && submit(e as unknown as FormEvent)}>
      <Input ref={nameRef} aria-label="New item name" placeholder="Add an item — name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-9" />
      <Input aria-label="New item price" inputMode="decimal" placeholder={currency ? `Price (${currency})` : 'Price'} value={price} onChange={(e) => setPrice(e.target.value)} className="h-9 w-28 shrink-0 tabular-nums" maxLength={24} />
      <Button variant="primary" className="h-9 shrink-0" leftIcon={<Plus className="h-4 w-4" />} onClick={() => submit()}>
        <span className="hidden sm:inline">Add</span>
      </Button>
    </div>
  )
}

/**
 * Menu editor: categories one at a time, items as compact rows, quick "name + price" adding, and a focused dialog
 * for photo, rich description, tags and sizes.
 */
export function MenuEditor({ d, onChange }: { d: MenuData; onChange: (d: MenuData) => void }) {
  const cats = d.categories ?? []
  const [open, setOpen] = useState<number | null>(cats.length ? 0 : null)
  const [editing, setEditing] = useState<{ c: number; i: number } | null>(null)
  const [settings, setSettings] = useState(false)
  const setCats = (categories: Cat[]) => onChange({ ...d, categories })
  const setCat = (ci: number, patch: Partial<Cat>) => setCats(cats.map((c, j) => (j === ci ? { ...c, ...patch } : c)))
  const setItems = (ci: number, items: MenuItem[]) => setCat(ci, { items })
  const total = cats.reduce((n, c) => n + (c.items?.length ?? 0), 0)
  const showImages = !!d.show_images

  const suggestions = useMemo(() => {
    const used = cats.flatMap((c) => (c.items ?? []).flatMap((it) => it.tags ?? []))
    return [...new Set([...PRESET_TAGS.map((t) => t.label), ...used, ...TAG_IDEAS])]
  }, [cats])

  const current = editing ? cats[editing.c]?.items?.[editing.i] : null
  const flat = cats.flatMap((c, ci) => (c.items ?? []).map((_, i) => ({ c: ci, i })))
  const at = editing ? flat.findIndex((x) => x.c === editing.c && x.i === editing.i) : -1

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface-2/60 px-3 py-2 text-[13px]">
        <span className="text-muted">
          {cats.length} categor{cats.length === 1 ? 'y' : 'ies'} · {total} item{total === 1 ? '' : 's'}
        </span>
        <span className="text-muted">Currency: <b className="font-semibold text-fg">{d.currency || 'none'}</b></span>
        <label className="flex items-center gap-2">
          <Switch checked={showImages} onChange={(show_images) => onChange({ ...d, show_images })} label="Show photos" /> Photos
        </label>
        <button type="button" onClick={() => setSettings((s) => !s)} aria-expanded={settings} className="ml-auto inline-flex items-center gap-1 font-medium text-muted hover:text-fg">
          Menu settings <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', settings && 'rotate-180')} />
        </button>
      </div>
      {settings && (
        <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <Field label="Currency" hint="Prices are formatted in this currency on the page.">
            {(p) => <CurrencySelect id={p.id} value={d.currency} onChange={(currency) => onChange({ ...d, currency })} />}
          </Field>
          <Field label="Section title" optional>
            {(p) => <Input {...p} value={d.title ?? ''} onChange={(e) => onChange({ ...d, title: e.target.value || undefined })} placeholder="e.g. Dinner" maxLength={120} />}
          </Field>
        </div>
      )}

      <SortableList items={cats} onReorder={setCats} className="space-y-2" idPrefix="cat">
        {(cat, ci, h) => {
          const isOpen = open === ci
          const n = cat.items?.length ?? 0
          return (
            <div className={cn('rounded-xl border bg-surface', isOpen ? 'border-border-strong shadow-xs' : 'border-border')}>
              <div className="flex items-center gap-1.5 p-2">
                <DragHandle handle={h.handle} label={`Drag category ${cat.name || ci + 1}`} />
                {isOpen ? (
                  <Input aria-label="Category name" placeholder="Category name (e.g. Burgers)" value={cat.name} onChange={(e) => setCat(ci, { name: e.target.value })} className="h-9 font-semibold" maxLength={80} autoFocus={!cat.name} />
                ) : (
                  <button type="button" onClick={() => setOpen(ci)} className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left">
                    <span className={cn('truncate text-[14px] font-semibold', !cat.name && 'text-subtle italic')}>{cat.name || 'Untitled category'}</span>
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 text-[11.5px] text-muted tabular-nums">{n}</span>
                  </button>
                )}
                <Button size="icon-sm" variant="ghost" aria-label={isOpen ? 'Collapse category' : 'Open category'} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : ci)}>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove category"
                  onClick={() => {
                    if (n && !window.confirm(`Remove “${cat.name || 'this category'}” and its ${n} item${n === 1 ? '' : 's'}?`)) return
                    setCats(cats.filter((_, j) => j !== ci))
                    setOpen(null)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {isOpen && (
                <div className="space-y-2 border-t border-border p-2 sm:p-3">
                  <RichText inline rows={1} aria-label="Category note" placeholder="Category note (optional) — e.g. Served with fries" value={cat.description ?? ''} onChange={(v) => setCat(ci, { description: v || undefined })} maxLength={300} />
                  <SortableList items={cat.items ?? []} onReorder={(items) => setItems(ci, items)} className="space-y-1.5" idPrefix={`c${ci}`}>
                    {(it, ii, hh) => (
                      <ItemRow
                        it={it}
                        currency={d.currency}
                        showImages={showImages}
                        handle={hh.handle}
                        onOpen={() => setEditing({ c: ci, i: ii })}
                        onRemove={() => setItems(ci, cat.items.filter((_, k) => k !== ii))}
                      />
                    )}
                  </SortableList>
                  {!n && <p className="py-2 text-center text-xs text-subtle">No items yet — add the first one below.</p>}
                  <QuickAdd currency={d.currency} onAdd={(name, price) => setItems(ci, [...(cat.items ?? []), { name, price, badges: [] }])} />
                  <p className="text-[11.5px] text-subtle">Tip: add names and prices quickly here, then tap an item to add a photo, description, tags or sizes.</p>
                </div>
              )}
            </div>
          )
        }}
      </SortableList>

      <Button
        leftIcon={<Plus className="h-4 w-4" />}
        onClick={() => {
          setCats([...cats, { name: '', items: [] }])
          setOpen(cats.length)
        }}
        disabled={cats.length >= 40}
      >
        Add category
      </Button>

      {editing && current && (
        <ItemDialog
          key={`${editing.c}-${editing.i}`}
          item={current}
          currency={d.currency}
          suggestions={suggestions}
          position={`${cats[editing.c]?.name || 'Untitled category'} · item ${editing.i + 1} of ${cats[editing.c]?.items.length ?? 0}`}
          onChange={(v) => setItems(editing.c, cats[editing.c].items.map((x, k) => (k === editing.i ? v : x)))}
          onClose={() => setEditing(null)}
          onPrev={at > 0 ? () => setEditing(flat[at - 1]) : undefined}
          onNext={at >= 0 && at < flat.length - 1 ? () => setEditing(flat[at + 1]) : undefined}
          onDelete={() => {
            setItems(editing.c, cats[editing.c].items.filter((_, k) => k !== editing.i))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
