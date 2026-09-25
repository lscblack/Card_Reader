import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Copy, ExternalLink, ImagePlus, Plus, RotateCcw, Save, Star, Trash2, Undo2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Alert } from '@/components/ui/Alert'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import { ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { BizErrorState, FormError } from '@/business/components/BizError'
import { PageSkeleton } from '@/business/components/bits'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import { fieldErrorsOf } from '@/business/lib/errors'
import { SOCIAL_PLATFORMS } from '@/business/lib/format'
import type { BackgroundStyle, CardDesign, CardFields, CardFont, DigitalCard, LabeledUrl, LabeledValue, ShareSettings, SocialLinkP, Visibility, VisibilityKey } from '../api/types'
import { cardsApi } from '../api/personal'
import { usePCard, usePMutation, useTemplates } from '../hooks/queries'
import { layoutFor, renderableOf } from '../lib/card'
import { DEFAULT_VISIBILITY, FONT_LABELS, FONT_STACKS, PATTERNS, visibilityOf } from '../lib/design'
import { DigitalCardRender, type CardAudience } from '../components/DigitalCardRender'
import { TemplateGallery } from '../components/TemplateGallery'
import { ColorField, ImageCropModal, LockedHint, VisibilityToggle } from '../components/editorBits'

type Tab = 'template' | 'design' | 'images' | 'details' | 'sharing'

interface Draft {
  label: string
  slug: string
  template_id: string
  design: CardDesign
  fields: CardFields
  visibility: Partial<Record<VisibilityKey, Visibility>>
  share_settings: ShareSettings
}

const toDraft = (c: DigitalCard): Draft => ({
  label: c.label,
  slug: c.slug,
  template_id: c.template_id,
  design: { ...c.design },
  fields: structuredClone(c.fields),
  visibility: { ...DEFAULT_VISIBILITY, ...c.visibility },
  share_settings: { ...c.share_settings },
})

function Seg<T extends string>({ value, onChange, options, label, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; style?: CSSProperties }[]; label: string; disabled?: boolean }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          style={o.style}
          className={cn('h-8 rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-50', value === o.value ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Header row for a field group: label, lock hint and visibility toggle. */
function GroupHead({ label, vis, onVis, locked, business }: { label: string; vis?: Visibility; onVis?: (v: Visibility) => void; locked?: boolean; business?: string }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-[13px] font-medium">
        {label}
        {locked && business && <LockedHint business={business} />}
      </span>
      {vis && onVis && <VisibilityToggle value={vis} onChange={onVis} label={label} />}
    </div>
  )
}

function Rows<T extends LabeledValue | LabeledUrl | SocialLinkP>({
  items,
  onChange,
  make,
  render,
  addLabel,
  disabled,
  max = 10,
}: {
  items: T[]
  onChange: (v: T[]) => void
  make: () => T
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode
  addLabel: string
  disabled?: boolean
  max?: number
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-2 min-[520px]:flex-row min-[520px]:items-center">
          {render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))))}
          <Button size="icon" variant="ghost" aria-label="Remove row" disabled={disabled} onClick={() => onChange(items.filter((_, j) => j !== i))} className="self-end min-[520px]:self-auto">
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

const IMAGE_SPECS = {
  photo: { title: 'Crop photo', aspect: 1, w: 512, h: 512, round: true, label: 'Profile photo', hint: 'Square, shown round.' },
  cover: { title: 'Crop cover', aspect: 1200 / 630, w: 1200, h: 630, round: false, label: 'Cover image', hint: 'Wide banner (1200×630).' },
  logo: { title: 'Crop logo', aspect: 1, w: 512, h: 512, round: false, label: 'Logo', hint: 'Square logo.' },
} as const

function ImagesTab({ card, lockedLogo }: { card: DigitalCard; lockedLogo: boolean }) {
  const toast = useToast()
  const onError = useErrorToast()
  const [pending, setPending] = useState<{ kind: keyof typeof IMAGE_SPECS; file: File } | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const upload = usePMutation((v: { kind: keyof typeof IMAGE_SPECS; file: File }) => cardsApi.uploadImage(card.id, v.kind, v.file))
  const remove = usePMutation((kind: keyof typeof IMAGE_SPECS) => cardsApi.deleteImage(card.id, kind))
  return (
    <div className="space-y-3">
      {(Object.keys(IMAGE_SPECS) as (keyof typeof IMAGE_SPECS)[]).map((kind) => {
        const spec = IMAGE_SPECS[kind]
        const url = card[`${kind}_url`]
        const locked = kind === 'logo' && lockedLogo
        return (
          <div key={kind} className="flex items-center gap-4 rounded-xl border border-border p-3">
            <div className={cn('flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 text-subtle ring-1 ring-border', kind === 'cover' ? 'h-14 w-[106px] rounded-lg' : 'h-14 w-14', kind === 'photo' ? 'rounded-full' : 'rounded-lg')}>
              {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                {spec.label} {locked && card.business_link && <LockedHint business={card.business_link.business_name} />}
              </p>
              <p className="text-xs text-subtle">{spec.hint} PNG, JPEG or WebP up to 3 MB.</p>
            </div>
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
            <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
              <Button size="sm" disabled={locked} loading={upload.isPending && upload.variables?.kind === kind} onClick={() => inputs.current[kind]?.click()}>
                {url ? 'Replace' : 'Upload'}
              </Button>
              {url && !locked && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(kind)
                      toast.success(`${spec.label} removed`)
                    } catch (e) {
                      onError(e)
                    }
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        )
      })}
      <ImageCropModal
        file={pending?.file ?? null}
        title={pending ? IMAGE_SPECS[pending.kind].title : ''}
        aspect={pending ? IMAGE_SPECS[pending.kind].aspect : 1}
        outW={pending ? IMAGE_SPECS[pending.kind].w : 512}
        outH={pending ? IMAGE_SPECS[pending.kind].h : 512}
        round={pending ? IMAGE_SPECS[pending.kind].round : false}
        onClose={() => setPending(null)}
        onDone={async (file) => {
          const kind = pending!.kind
          setPending(null)
          try {
            await upload.mutateAsync({ kind, file })
            toast.success(`${IMAGE_SPECS[kind].label} updated`)
          } catch (e) {
            onError(e)
          }
        }}
      />
    </div>
  )
}

function Editor({ card }: { card: DigitalCard }) {
  const navigate = useNavigate()
  const toast = useToast()
  const onError = useErrorToast()
  const templates = useTemplates()
  const [draft, setDraft] = useState<Draft>(() => toDraft(card))
  const [base, setBase] = useState<Draft>(() => toDraft(card))
  const [tab, setTab] = useState<Tab>('details')
  const [pane, setPane] = useState<'edit' | 'preview'>('edit')
  const [audience, setAudience] = useState<CardAudience>('public')
  const [confirm, setConfirm] = useState<'rotate' | 'delete' | null>(null)
  const link = card.business_link
  const locked = (k: string) => !!link?.locked_fields.includes(k)
  const dirty = JSON.stringify(draft) !== JSON.stringify(base)

  const save = usePMutation(() =>
    cardsApi.update(card.id, {
      label: draft.label.trim() || card.label,
      ...(draft.slug !== card.slug ? { slug: draft.slug } : {}),
      template_id: draft.template_id,
      design: draft.design,
      fields: Object.fromEntries(Object.entries(draft.fields).filter(([k]) => !locked(k))) as Partial<CardFields>,
      visibility: draft.visibility,
      share_settings: draft.share_settings,
    }),
  )
  const primary = usePMutation(() => cardsApi.setPrimary(card.id))
  const setStatus = usePMutation((v: boolean) => cardsApi.update(card.id, { status: v ? 'active' : 'inactive' }))
  const rotate = usePMutation(() => cardsApi.rotate(card.id))
  const dup = usePMutation(() => cardsApi.duplicate(card.id))
  const del = usePMutation(() => cardsApi.remove(card.id))
  const errs = fieldErrorsOf(save.error)

  const setF = <K extends keyof CardFields>(k: K, v: CardFields[K]) => setDraft((d) => ({ ...d, fields: { ...d.fields, [k]: v } }))
  const setD = <K extends keyof CardDesign>(k: K, v: CardDesign[K]) => setDraft((d) => ({ ...d, design: { ...d.design, [k]: v } }))
  const setS = <K extends keyof ShareSettings>(k: K, v: boolean) => setDraft((d) => ({ ...d, share_settings: { ...d.share_settings, [k]: v } }))
  const vis = (k: VisibilityKey) => visibilityOf(draft, k)
  const setVis = (k: VisibilityKey) => (v: Visibility) => setDraft((d) => ({ ...d, visibility: { ...d.visibility, [k]: v } }))

  async function doSave() {
    try {
      const saved = await save.mutateAsync(undefined)
      const next = toDraft(saved)
      setDraft(next)
      setBase(next)
      toast.success('Card saved — it’s live on your link and phone.')
    } catch {
      /* inline */
    }
  }

  const layout = layoutFor(draft.template_id, templates.data)
  const preview = (
    <DigitalCardRender
      card={{ ...renderableOf(card), design: draft.design, fields: draft.fields, visibility: draft.visibility }}
      layout={layout}
      audience={audience}
      qrValue={card.public_url}
    />
  )

  const text = (k: 'full_name' | 'pronouns' | 'headline' | 'job_title' | 'company' | 'department', label: string, opts: { placeholder?: string; half?: boolean; noVis?: boolean } = {}) => (
    <div className={opts.half ? '' : 'sm:col-span-2'}>
      <GroupHead label={label} vis={opts.noVis ? undefined : vis(k)} onVis={opts.noVis ? undefined : setVis(k)} locked={locked(k)} business={link?.business_name} />
      <Input aria-label={label} value={draft.fields[k] ?? ''} onChange={(e) => setF(k, e.target.value)} disabled={locked(k)} placeholder={opts.placeholder} maxLength={120} aria-invalid={errs[k] ? true : undefined} />
      {errs[k] && <p className="mt-1 text-[12.5px] text-red-600 dark:text-red-400">{errs[k]}</p>}
    </div>
  )

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="min-w-0 break-words">{card.label}</span>
            {card.is_primary && <Badge tone="accent">Primary</Badge>}
            {card.status === 'inactive' && <Badge tone="warning">Inactive</Badge>}
            {dirty && <Badge tone="warning">Unsaved changes</Badge>}
          </span>
        }
        description={
          <a href={card.public_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12.5px] hover:text-accent">
            {card.public_url.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
          </a>
        }
        actions={
          <>
            {dirty && (
              <Button leftIcon={<Undo2 className="h-4 w-4" />} onClick={() => setDraft(base)}>
                Discard
              </Button>
            )}
            <Button variant="primary" leftIcon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty || !draft.fields.full_name.trim()} onClick={doSave}>
              Save
            </Button>
          </>
        }
      />
      {link && (
        <Alert tone="info" className="mb-4" title={`Issued by ${link.business_name}`}>
          {link.locked_fields.length ? `Some details (${link.locked_fields.map((f) => f.replace(/_/g, ' ')).join(', ')}) are managed by your company.` : 'This card is linked to your company.'}
          {link.template_locked && ' The template is set by your company.'}
        </Alert>
      )}
      <FormError error={save.error && !Object.keys(errs).length ? save.error : null} className="mb-4" />
      <Tabs<'edit' | 'preview'> className="mb-4 lg:hidden" value={pane} onChange={setPane} tabs={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className={cn('min-w-0', pane === 'preview' && 'hidden lg:block')}>
          <Tabs<Tab>
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'details', label: 'Details' },
              { value: 'template', label: 'Template' },
              { value: 'design', label: 'Design' },
              { value: 'images', label: 'Photos' },
              { value: 'sharing', label: 'Sharing' },
            ]}
          />

          {tab === 'details' && (
            <Card>
              <CardBody className="space-y-5">
                <p className="text-xs text-subtle">
                  Choose who sees each detail: <strong className="text-fg">Public</strong> (anyone with your link or tap), <strong className="text-fg">Contacts</strong> (people you exchange with) or{' '}
                  <strong className="text-fg">Hidden</strong>.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Card label" hint="Only you see it." className="sm:col-span-2">
                    {(p) => <Input {...p} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} maxLength={40} />}
                  </Field>
                  {text('full_name', 'Full name', { noVis: true })}
                  {text('pronouns', 'Pronouns', { half: true, placeholder: 'she/her' })}
                  {text('headline', 'Headline', { half: true, placeholder: 'What you do, in a line' })}
                  {text('job_title', 'Job title', { half: true })}
                  {text('company', 'Company', { half: true })}
                  {text('department', 'Department', { half: true })}
                  <div className="sm:col-span-2">
                    <GroupHead label="Bio" vis={vis('bio')} onVis={setVis('bio')} locked={locked('bio')} business={link?.business_name} />
                    <Textarea aria-label="Bio" rows={3} maxLength={600} value={draft.fields.bio ?? ''} onChange={(e) => setF('bio', e.target.value)} disabled={locked('bio')} />
                  </div>
                </div>

                {(
                  [
                    ['phones', 'Phone numbers', 'Add phone', 'tel', '+14155550123'],
                    ['emails', 'Email addresses', 'Add email', 'email', 'you@example.com'],
                  ] as const
                ).map(([k, label, add, type, ph]) => (
                  <div key={k}>
                    <GroupHead label={label} vis={vis(k)} onVis={setVis(k)} locked={locked(k)} business={link?.business_name} />
                    <Rows<LabeledValue>
                      items={draft.fields[k]}
                      onChange={(v) => setF(k, v)}
                      make={() => ({ label: k === 'phones' ? 'Mobile' : 'Work', value: '' })}
                      addLabel={add}
                      disabled={locked(k)}
                      render={(it, up) => (
                        <>
                          <Input aria-label="Label" value={it.label} onChange={(e) => up({ label: e.target.value })} className="min-[520px]:w-32" disabled={locked(k)} maxLength={30} />
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
                    <GroupHead label={label} vis={vis(k)} onVis={setVis(k)} locked={locked(k)} business={link?.business_name} />
                    <Rows<LabeledUrl>
                      items={draft.fields[k]}
                      onChange={(v) => setF(k, v)}
                      make={() => ({ label: k === 'websites' ? 'Website' : 'Link', url: '' })}
                      addLabel={add}
                      disabled={locked(k)}
                      render={(it, up) => (
                        <>
                          <Input aria-label="Label" value={it.label} onChange={(e) => up({ label: e.target.value })} className="min-[520px]:w-32" disabled={locked(k)} maxLength={40} />
                          <Input aria-label={`${label} URL`} type="url" value={it.url} onChange={(e) => up({ url: e.target.value })} placeholder="https://" disabled={locked(k)} />
                        </>
                      )}
                    />
                  </div>
                ))}
                <div>
                  <GroupHead label="Social profiles" vis={vis('socials')} onVis={setVis('socials')} locked={locked('socials')} business={link?.business_name} />
                  <Rows<SocialLinkP>
                    items={draft.fields.socials}
                    onChange={(v) => setF('socials', v)}
                    make={() => ({ platform: 'linkedin', url: '' })}
                    addLabel="Add profile"
                    disabled={locked('socials')}
                    render={(it, up) => (
                      <>
                        <Select aria-label="Platform" value={it.platform} onChange={(e) => up({ platform: e.target.value })} className="min-[520px]:w-36" disabled={locked('socials')}>
                          {SOCIAL_PLATFORMS.map((p) => (
                            <option key={p} value={p}>
                              {p === 'x' ? 'X (Twitter)' : p.charAt(0).toUpperCase() + p.slice(1)}
                            </option>
                          ))}
                        </Select>
                        <Input aria-label="Profile URL" type="url" value={it.url} onChange={(e) => up({ url: e.target.value })} placeholder="https://" disabled={locked('socials')} />
                      </>
                    )}
                  />
                </div>
                <div>
                  <GroupHead label="Address" vis={vis('address')} onVis={setVis('address')} locked={locked('address')} business={link?.business_name} />
                  <Input aria-label="Address" value={draft.fields.address ?? ''} onChange={(e) => setF('address', e.target.value)} disabled={locked('address')} />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className="text-[13px] font-medium">Photo</span>
                  <VisibilityToggle value={vis('photo')} onChange={setVis('photo')} label="Photo" />
                </div>
              </CardBody>
            </Card>
          )}

          {tab === 'template' && (
            <Card>
              <CardBody className="space-y-3">
                {link?.template_locked && <Alert tone="info">Your company sets the template for this card.</Alert>}
                <p className="text-xs text-subtle">Choosing a template also applies its colours — adjust them in Design.</p>
                <TemplateGallery
                  value={draft.template_id}
                  disabled={!!link?.template_locked}
                  sample={{ fields: draft.fields, photo_url: card.photo_url, cover_url: card.cover_url, logo_url: card.logo_url }}
                  onPick={(t) => setDraft((d) => ({ ...d, template_id: t.id, design: { ...t.default_design } }))}
                />
              </CardBody>
            </Card>
          )}

          {tab === 'design' && (
            <Card>
              <CardBody className="space-y-5">
                <ColorField label="Primary colour" value={draft.design.primary} onChange={(v) => setD('primary', v)} against={draft.design.background} againstLabel="the background" />
                <ColorField label="Accent" value={draft.design.accent} onChange={(v) => setD('accent', v)} against={draft.design.background} againstLabel="the background" />
                <ColorField label="Background" value={draft.design.background} onChange={(v) => setD('background', v)} />
                <ColorField label="Text" value={draft.design.text} onChange={(v) => setD('text', v)} against={draft.design.background} againstLabel="the background" />
                <div className="space-y-1.5">
                  <p className="text-[13px] font-medium">Background style</p>
                  <Seg<BackgroundStyle>
                    label="Background style"
                    value={draft.design.background_style}
                    onChange={(v) => setDraft((d) => ({ ...d, design: { ...d.design, background_style: v, pattern: v === 'pattern' ? (d.design.pattern ?? 'dots') : d.design.pattern } }))}
                    options={[
                      { value: 'solid', label: 'Solid' },
                      { value: 'gradient', label: 'Gradient' },
                      { value: 'glass', label: 'Glass' },
                      { value: 'pattern', label: 'Pattern' },
                    ]}
                  />
                  {draft.design.background_style === 'pattern' && (
                    <div className="pt-1">
                      <Seg<string> label="Pattern" value={draft.design.pattern ?? 'dots'} onChange={(v) => setD('pattern', v)} options={PATTERNS.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))} />
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <p className="text-[13px] font-medium">Font</p>
                  <Seg<CardFont> label="Font" value={draft.design.font} onChange={(v) => setD('font', v)} options={(Object.keys(FONT_LABELS) as CardFont[]).map((f) => ({ value: f, label: FONT_LABELS[f], style: { fontFamily: FONT_STACKS[f] } }))} />
                </div>
                <label className="block space-y-1.5">
                  <span className="flex items-center justify-between text-[13px] font-medium">
                    Corner radius <span className="font-mono text-xs text-subtle">{draft.design.corner_radius}px</span>
                  </span>
                  <input type="range" min={0} max={32} value={draft.design.corner_radius} onChange={(e) => setD('corner_radius', Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                </label>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span>
                    <span className="block text-[13px] font-medium">Show QR code on the card</span>
                    <span className="block text-xs text-subtle">Links to your public page.</span>
                  </span>
                  <Switch checked={draft.design.show_qr} onChange={(v) => setD('show_qr', v)} label="Show QR code" />
                </div>
              </CardBody>
            </Card>
          )}

          {tab === 'images' && <ImagesTab card={card} lockedLogo={locked('logo')} />}

          {tab === 'sharing' && (
            <div className="space-y-4">
              <Card>
                <CardHeader title="How people can get your card" />
                <CardBody className="space-y-2">
                  {(
                    [
                      ['nfc_sharing_enabled', 'NFC sharing', 'Your phone shares this card when held near another phone or reader (primary card only).'],
                      ['auto_exchange', 'Automatic exchange', 'When someone scans you, you get their card too.'],
                      ['web_page_enabled', 'Public web page', 'Your link and QR code open a page with your public details. iPhones read this over NFC.'],
                      ['lead_capture_enabled', 'Let visitors share back', 'Your web page shows a short form so people can leave their details.'],
                    ] as const
                  ).map(([k, label, hint]) => (
                    <div key={k} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                      <span>
                        <span className="block text-[13px] font-medium">{label}</span>
                        <span className="block text-xs text-subtle">{hint}</span>
                      </span>
                      <Switch checked={draft.share_settings[k]} onChange={(v) => setS(k, v)} label={label} />
                    </div>
                  ))}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Public link" />
                <CardBody className="space-y-3">
                  <Field label="Link" error={errs.slug ?? (!/^[a-z0-9-]{3,48}$/.test(draft.slug) ? 'Use 3–48 lowercase letters, numbers or dashes.' : null)} hint={`${window.location.origin}/p/${draft.slug}`}>
                    {(p) => <Input {...p} value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} className="font-mono" maxLength={48} />}
                  </Field>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                    <span>
                      <span className="block text-[13px] font-medium">Card is active</span>
                      <span className="block text-xs text-subtle">When off, the link and taps show a neutral “not available” page.</span>
                    </span>
                    <Switch
                      checked={card.status === 'active'}
                      disabled={!!link}
                      label="Card is active"
                      onChange={async (v) => {
                        try {
                          await setStatus.mutateAsync(v)
                          toast.success(v ? 'Card activated' : 'Card deactivated')
                        } catch (e) {
                          onError(e)
                        }
                      }}
                    />
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardBody className="flex flex-wrap gap-2">
                  {!card.is_primary && (
                    <Button
                      leftIcon={<Star className="h-4 w-4" />}
                      loading={primary.isPending}
                      onClick={async () => {
                        try {
                          await primary.mutateAsync(undefined)
                          toast.success('This is now the card your phone shares')
                        } catch (e) {
                          onError(e)
                        }
                      }}
                    >
                      Set as primary
                    </Button>
                  )}
                  <Button leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm('rotate')}>
                    Rotate link & codes
                  </Button>
                  <Button
                    leftIcon={<Copy className="h-4 w-4" />}
                    loading={dup.isPending}
                    onClick={async () => {
                      try {
                        const d = await dup.mutateAsync(undefined)
                        toast.success('Card duplicated')
                        navigate(`/me/cards/${d.id}`)
                      } catch (e) {
                        onError(e)
                      }
                    }}
                  >
                    Duplicate
                  </Button>
                  {!link && (
                    <Button variant="danger-soft" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm('delete')}>
                      Delete card
                    </Button>
                  )}
                </CardBody>
              </Card>
            </div>
          )}
        </div>

        <div className={cn('min-w-0', pane === 'edit' && 'hidden lg:block')}>
          <div className="space-y-3 lg:sticky lg:top-20">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-subtle">Live preview</p>
              <Seg<CardAudience>
                label="Preview as"
                value={audience}
                onChange={setAudience}
                options={[
                  { value: 'public', label: 'Public' },
                  { value: 'contacts', label: 'Contacts' },
                ]}
              />
            </div>
            <div className="mx-auto max-w-[380px]">{preview}</div>
            <p className="text-center text-xs text-subtle">{audience === 'public' ? 'What anyone with your link sees.' : 'What people you exchange cards with see.'}</p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'rotate'}
        onClose={() => setConfirm(null)}
        title="Rotate your link and codes?"
        description="Old QR codes, exchange codes and NFC tokens for this card stop working immediately. Your public link stays the same; printed QR codes need reprinting."
        confirmLabel="Rotate"
        loading={rotate.isPending}
        onConfirm={async () => {
          try {
            await rotate.mutateAsync(undefined)
            toast.success('Codes rotated')
            setConfirm(null)
          } catch (e) {
            onError(e)
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={`Delete “${card.label}”?`}
        description="Its public link and QR codes stop working. Contacts you collected are kept."
        confirmLabel="Delete card"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(undefined)
            toast.success('Card deleted')
            navigate('/me/cards', { replace: true })
          } catch (e) {
            onError(e)
          }
        }}
      />
    </>
  )
}

export default function CardEditorPage() {
  const { cardId } = useParams()
  const { data, error, isLoading, refetch } = usePCard(cardId)
  useDocumentTitle(data ? `Edit ${data.label}` : 'Edit card')
  const back = (
    <Link to="/me/cards" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
      <ArrowLeft className="h-3.5 w-3.5" /> My cards
    </Link>
  )
  return (
    <>
      {back}
      {error ? (
        <Card>
          <BizErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !data ? (
        <PageSkeleton />
      ) : (
        <Editor key={data.id} card={data} />
      )}
    </>
  )
}
