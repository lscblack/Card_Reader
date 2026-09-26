import { useRef, useState, type ReactNode } from 'react'
import { ImagePlus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { useToast } from '@/components/ui/toastContext'
import { cn } from '@/lib/cn'
import { SOCIAL_PLATFORMS } from '@/business/lib/format'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import type { CardFields, LabeledUrl, LabeledValue, SocialLinkP, Visibility, VisibilityKey } from '../../api/types'
import { cardsApi } from '../../api/personal'
import { usePMutation } from '../../hooks/queries'
import { isCode128Printable } from '../../lib/code128'
import { visibilityOf } from '../../lib/design'
import { ImageCropModal, LockedHint, VisibilityToggle } from '../editorBits'
import { Section } from './DesignPanel'
import type { PanelProps } from './doc'

function Head({ label, vis, onVis, locked, business }: { label: string; vis?: Visibility; onVis?: (v: Visibility) => void; locked?: boolean; business?: string }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-[13px] font-medium">
        {label}
        {locked && business && <LockedHint business={business} />}
      </span>
      {vis && onVis && <VisibilityToggle value={vis} onChange={onVis} label={label} disabled={locked} />}
    </div>
  )
}

function Rows<T extends LabeledValue | LabeledUrl | SocialLinkP>({ items, onChange, make, render, addLabel, disabled, max = 6 }: { items: T[]; onChange: (v: T[]) => void; make: () => T; render: (item: T, update: (patch: Partial<T>) => void) => ReactNode; addLabel: string; disabled?: boolean; max?: number }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          {render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))))}
          <Button size="icon" variant="ghost" aria-label="Remove row" disabled={disabled} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {items.length < max && !disabled && (
        <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange([...items, make()])}>
          {addLabel}
        </Button>
      )}
    </div>
  )
}

const IMG = {
  photo: { title: 'Crop photo', aspect: 1, w: 512, h: 512, round: true, label: 'Photo' },
  logo: { title: 'Crop logo', aspect: 1, w: 512, h: 512, round: false, label: 'Logo' },
} as const

function Images({ card, locked }: Pick<PanelProps, 'card' | 'locked'>) {
  const toast = useToast()
  const onError = useErrorToast()
  const [pending, setPending] = useState<{ kind: keyof typeof IMG; file: File } | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const upload = usePMutation((v: { kind: keyof typeof IMG; file: File }) => cardsApi.uploadImage(card.id, v.kind, v.file))
  const remove = usePMutation((kind: keyof typeof IMG) => cardsApi.deleteImage(card.id, kind))
  return (
    <div className="grid grid-cols-2 gap-3">
      {(Object.keys(IMG) as (keyof typeof IMG)[]).map((kind) => {
        const url = card[`${kind}_url`]
        const isLocked = locked(kind)
        return (
          <div key={kind} className="flex flex-col items-center gap-2 rounded-xl border border-border p-3">
            <div className={cn('flex h-16 w-16 items-center justify-center overflow-hidden bg-surface-2 ring-1 ring-border', kind === 'photo' ? 'rounded-full' : 'rounded-lg')}>
              {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-subtle" />}
            </div>
            <span className="text-[12.5px] font-medium">{IMG[kind].label}</span>
            <input
              ref={(el) => {
                inputs.current[kind] = el
              }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toast.error('Use a PNG, JPEG or WebP image.')
                if (f.size > 3 * 1024 * 1024) return toast.error('The image must be 3 MB or smaller.')
                setPending({ kind, file: f })
              }}
            />
            <div className="flex gap-1">
              <Button size="sm" disabled={isLocked} loading={upload.isPending && upload.variables?.kind === kind} onClick={() => inputs.current[kind]?.click()}>
                {url ? 'Replace' : 'Upload'}
              </Button>
              {url && !isLocked && (
                <Button size="sm" variant="ghost" onClick={() => remove.mutateAsync(kind).catch(onError)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        )
      })}
      <ImageCropModal
        file={pending?.file ?? null}
        title={pending ? IMG[pending.kind].title : ''}
        aspect={1}
        outW={512}
        outH={512}
        round={pending?.kind === 'photo'}
        onClose={() => setPending(null)}
        onDone={async (file) => {
          const kind = pending!.kind
          setPending(null)
          try {
            await upload.mutateAsync({ kind, file })
            toast.success(`${IMG[kind].label} updated`)
          } catch (e) {
            onError(e)
          }
        }}
      />
    </div>
  )
}

export function ContentPanel({ doc, set, card, locked, v2 }: PanelProps) {
  const biz = card.business_link?.business_name
  const vis = (k: VisibilityKey) => visibilityOf(doc, k)
  const setVis = (k: VisibilityKey) => (v: Visibility) => set((d) => ({ ...d, visibility: { ...d.visibility, [k]: v } }))
  const setF = <K extends keyof CardFields>(k: K, v: CardFields[K]) => set((d) => ({ ...d, fields: { ...d.fields, [k]: v } }), `f:${String(k)}`)
  const text = (k: 'full_name' | 'pronouns' | 'headline' | 'job_title' | 'company' | 'department' | 'id_number', label: string, opts: { ph?: string; noVis?: boolean } = {}) => (
    <div>
      <Head label={label} vis={opts.noVis ? undefined : vis(k)} onVis={opts.noVis ? undefined : setVis(k)} locked={locked(k)} business={biz} />
      <Input aria-label={label} value={doc.fields[k] ?? ''} onChange={(e) => setF(k, e.target.value)} disabled={locked(k)} placeholder={opts.ph} maxLength={120} />
    </div>
  )
  const barcode = doc.fields.barcode_value ?? ''
  const isBadge = v2?.category === 'badge'

  return (
    <div className="space-y-6">
      <p className="text-xs text-subtle">
        Choose who sees each detail: <strong className="text-fg">Public</strong>, <strong className="text-fg">Contacts</strong> (people you exchange with) or <strong className="text-fg">Hidden</strong>.
      </p>
      <Section title="Photo & logo">
        <Images card={card} locked={locked} />
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <span className="text-[13px] font-medium">Photo visibility</span>
          <VisibilityToggle value={vis('photo')} onChange={setVis('photo')} label="Photo" />
        </div>
      </Section>
      <Section title="About you">
        <div className="space-y-3">
          <div>
            <Head label="Card label (only you see it)" />
            <Input aria-label="Card label" value={doc.label} onChange={(e) => set((d) => ({ ...d, label: e.target.value }), 'label')} maxLength={40} />
          </div>
          {text('full_name', 'Full name', { noVis: true })}
          {text('job_title', 'Job title')}
          {text('company', 'Company')}
          {text('department', 'Department')}
          {text('headline', 'Tagline / headline', { ph: 'What you do, in a line' })}
          {text('pronouns', 'Pronouns', { ph: 'she/her' })}
          <div>
            <Head label="Bio" vis={vis('bio')} onVis={setVis('bio')} locked={locked('bio')} business={biz} />
            <Textarea aria-label="Bio" rows={3} maxLength={600} value={doc.fields.bio ?? ''} onChange={(e) => setF('bio', e.target.value)} disabled={locked('bio')} />
          </div>
        </div>
      </Section>
      <Section title="Contact">
        <div className="space-y-4">
          {(
            [
              ['phones', 'Phone numbers', 'Add phone', 'tel', '+14155550123'],
              ['emails', 'Email addresses', 'Add email', 'email', 'you@example.com'],
            ] as const
          ).map(([k, label, add, type, ph]) => (
            <div key={k}>
              <Head label={label} vis={vis(k)} onVis={setVis(k)} locked={locked(k)} business={biz} />
              <Rows<LabeledValue>
                items={doc.fields[k]}
                onChange={(v) => setF(k, v)}
                make={() => ({ label: k === 'phones' ? 'Mobile' : 'Work', value: '' })}
                addLabel={add}
                disabled={locked(k)}
                render={(it, up) => (
                  <>
                    <Input aria-label="Label" value={it.label} onChange={(e) => up({ label: e.target.value })} className="w-24 shrink-0" disabled={locked(k)} maxLength={30} />
                    <Input aria-label={label} type={type} value={it.value} onChange={(e) => up({ value: e.target.value })} placeholder={ph} disabled={locked(k)} />
                  </>
                )}
              />
            </div>
          ))}
          {(
            [
              ['websites', 'Websites', 'Add website'],
              ['custom_links', 'Links', 'Add link'],
            ] as const
          ).map(([k, label, add]) => (
            <div key={k}>
              <Head label={label} vis={vis(k)} onVis={setVis(k)} locked={locked(k)} business={biz} />
              <Rows<LabeledUrl>
                items={doc.fields[k]}
                onChange={(v) => setF(k, v)}
                make={() => ({ label: k === 'websites' ? 'Website' : 'Link', url: '' })}
                addLabel={add}
                disabled={locked(k)}
                render={(it, up) => (
                  <>
                    <Input aria-label="Label" value={it.label} onChange={(e) => up({ label: e.target.value })} className="w-24 shrink-0" disabled={locked(k)} maxLength={40} />
                    <Input aria-label={`${label} URL`} type="url" value={it.url} onChange={(e) => up({ url: e.target.value })} placeholder="https://" disabled={locked(k)} />
                  </>
                )}
              />
            </div>
          ))}
          <div>
            <Head label="Social profiles" vis={vis('socials')} onVis={setVis('socials')} locked={locked('socials')} business={biz} />
            <Rows<SocialLinkP>
              items={doc.fields.socials}
              onChange={(v) => setF('socials', v)}
              make={() => ({ platform: 'linkedin', url: '' })}
              addLabel="Add profile"
              disabled={locked('socials')}
              render={(it, up) => (
                <>
                  <Select aria-label="Platform" value={it.platform} onChange={(e) => up({ platform: e.target.value })} className="w-28 shrink-0" disabled={locked('socials')}>
                    {SOCIAL_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {p === 'x' ? 'X' : p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </Select>
                  <Input aria-label="Profile URL" type="url" value={it.url} onChange={(e) => up({ url: e.target.value })} placeholder="https://" disabled={locked('socials')} />
                </>
              )}
            />
          </div>
          <div>
            <Head label="Address" vis={vis('address')} onVis={setVis('address')} locked={locked('address')} business={biz} />
            <Input aria-label="Address" value={doc.fields.address ?? ''} onChange={(e) => setF('address', e.target.value)} disabled={locked('address')} />
          </div>
        </div>
      </Section>
      <Section title="Badge details" hint={isBadge ? 'Shown on ID badge templates.' : 'Used by ID badge templates (ID number, validity, barcode).'}>
        <div className="space-y-3">
          {text('id_number', 'ID number', { ph: 'EMP-0042' })}
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['valid_from', 'Issued'],
                ['valid_until', 'Valid until'],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <Head label={label} vis={vis(k)} onVis={setVis(k)} locked={locked(k)} business={biz} />
                <Input aria-label={label} type="date" value={(doc.fields[k] ?? '').slice(0, 10)} onChange={(e) => setF(k, e.target.value || null)} disabled={locked(k)} />
              </div>
            ))}
          </div>
          <div>
            <Head label="Barcode value (Code 128)" vis={vis('barcode_value')} onVis={setVis('barcode_value')} locked={locked('barcode_value')} business={biz} />
            <Input aria-label="Barcode value" value={barcode} onChange={(e) => setF('barcode_value', e.target.value)} disabled={locked('barcode_value')} maxLength={48} className="font-mono" aria-invalid={barcode && !isCode128Printable(barcode) ? true : undefined} />
            {barcode && !isCode128Printable(barcode) && <p className="mt-1 text-[12.5px] text-red-600 dark:text-red-400">Use printable ASCII only (letters, digits, basic symbols), up to 48 characters.</p>}
          </div>
        </div>
      </Section>
    </div>
  )
}
