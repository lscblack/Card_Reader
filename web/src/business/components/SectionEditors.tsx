import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Switch } from '@/components/ui/Input'
import { RichText } from '@/components/ui/RichText'
import type { Action, HoursRow, Section, SectionDataMap, SectionType } from '../api/types'
import { defaultHours } from '../lib/sections'
import { sectionData } from '@/public/sectionUtils'
import { ActionConfigurator } from './ActionConfigurator'
import { SocialLinksEditor } from './inputs'
import { MenuEditor } from './pages/MenuEditor'
import { EventEditor, FormBuilder, GalleryEditor, LinksEditor, OfferEditor, ProductsEditor, ServicesEditor, WifiEditor } from './pages/PageSectionEditors'

/** Reorderable list of items with add/remove. */
function ListEditor<T>({
  items,
  onChange,
  newItem,
  addLabel,
  render,
  itemLabel,
}: {
  items: T[]
  onChange: (v: T[]) => void
  newItem: () => T
  addLabel: string
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode
  itemLabel: (item: T, i: number) => string
}) {
  const move = (i: number, d: number) => {
    const next = [...items]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface-2/40 p-3">
          <div className="mb-2 flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-subtle">{itemLabel(it, i)}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">{render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))))}</div>
        </div>
      ))}
      <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange([...items, newItem()])}>
        {addLabel}
      </Button>
    </div>
  )
}

const BUTTON_ACTION_EXCLUDE = ['developer_webhook', 'share_contact', 'wifi', 'profile', 'employee_profile', 'digital_menu', 'product_info']

/** Editor body for one section. `onChange` receives the full new section. */
export function SectionEditor({ section, onChange }: { section: Section; onChange: (s: Section) => void }) {
  // Sections are flat on the wire: `{ type, ...fields }` (keep an existing `id`, drop any legacy `data`).
  const set = <K extends SectionType>(data: SectionDataMap[K]) =>
    onChange({ ...(section.id ? { id: section.id } : {}), type: section.type, ...data } as Section)
  switch (section.type) {
    case 'about': {
      const d = sectionData(section)
      return <RichText aria-label="About text" rows={4} value={d.text} onChange={(text) => set<'about'>({ text })} placeholder="Tell customers who you are and what you do." />
    }
    case 'text': {
      const d = sectionData(section)
      return (
        <div className="space-y-1">
          <RichText aria-label="Text" rows={5} value={d.markdown} onChange={(markdown) => set<'text'>({ markdown })} maxLength={10000} />
        </div>
      )
    }
    case 'contact': {
      const d = sectionData(section)
      const u = (patch: Partial<SectionDataMap['contact']>) => set<'contact'>({ ...d, ...patch })
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone" optional>{(p) => <Input {...p} type="tel" value={d.phone ?? ''} onChange={(e) => u({ phone: e.target.value })} placeholder="+14155550123" />}</Field>
          <Field label="Email" optional>{(p) => <Input {...p} type="email" value={d.email ?? ''} onChange={(e) => u({ email: e.target.value })} />}</Field>
          <Field label="Website" optional>{(p) => <Input {...p} type="url" value={d.website ?? ''} onChange={(e) => u({ website: e.target.value })} placeholder="https://" />}</Field>
          <Field label="Address" optional>{(p) => <Input {...p} value={d.address ?? ''} onChange={(e) => u({ address: e.target.value })} />}</Field>
        </div>
      )
    }
    case 'hours': {
      const d = sectionData(section)
      const rows = d.rows?.length ? d.rows : defaultHours()
      const u = (i: number, patch: Partial<HoursRow>) => set<'hours'>({ rows: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
      return (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.day + i} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-[13px] font-medium">{r.day}</span>
              <Input type="time" aria-label={`${r.day} opens`} value={r.open} disabled={r.closed} onChange={(e) => u(i, { open: e.target.value })} className="w-[112px]" />
              <span className="text-subtle">–</span>
              <Input type="time" aria-label={`${r.day} closes`} value={r.close} disabled={r.closed} onChange={(e) => u(i, { close: e.target.value })} className="w-[112px]" />
              <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                <Switch checked={r.closed} onChange={(v) => u(i, { closed: v })} label={`${r.day} closed`} /> Closed
              </label>
            </div>
          ))}
        </div>
      )
    }
    case 'social': {
      const d = sectionData(section)
      return <SocialLinksEditor value={d.links ?? []} onChange={(links) => set<'social'>({ links })} />
    }
    case 'services':
      return <ServicesEditor d={sectionData(section)} onChange={(d) => set<'services'>(d)} />
    case 'products':
      return <ProductsEditor d={sectionData(section)} onChange={(d) => set<'products'>(d)} />
    case 'menu':
      return <MenuEditor d={sectionData(section)} onChange={(d) => set<'menu'>(d)} />
    case 'links':
      return <LinksEditor d={sectionData(section)} onChange={(d) => set<'links'>(d)} />
    case 'offer':
      return <OfferEditor d={sectionData(section)} onChange={(d) => set<'offer'>(d)} />
    case 'event':
      return <EventEditor d={sectionData(section)} onChange={(d) => set<'event'>(d)} />
    case 'wifi':
      return <WifiEditor d={sectionData(section)} onChange={(d) => set<'wifi'>(d)} />
    case 'form':
      return <FormBuilder d={sectionData(section)} onChange={(d) => set<'form'>(d)} />
    case 'buttons': {
      const d = sectionData(section)
      type Btn = { label: string; action: Action }
      return (
        <ListEditor<Btn>
          items={d.items ?? []}
          onChange={(items) => set<'buttons'>({ items })}
          newItem={() => ({ label: '', action: { type: 'website', config: { url: '' } } })}
          addLabel="Add button"
          itemLabel={(b, i) => b.label || `Button ${i + 1}`}
          render={(b, up) => (
            <>
              <Input aria-label="Button label" placeholder="Button label" value={b.label} onChange={(e) => up({ label: e.target.value })} className="sm:col-span-2" />
              <div className="sm:col-span-2">
                <ActionConfigurator value={b.action} onChange={(a) => a && up({ action: a })} exclude={BUTTON_ACTION_EXCLUDE} showPreview={false} depth={1} />
              </div>
            </>
          )}
        />
      )
    }
    case 'gallery':
      return <GalleryEditor d={sectionData(section)} onChange={(d) => set<'gallery'>(d)} />
    default:
      return null
  }
}
