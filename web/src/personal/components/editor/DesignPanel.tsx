import { useRef, useState, type ReactNode } from 'react'
import { Check, Dices, ImagePlus, Pipette } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { cn } from '@/lib/cn'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import type { BackgroundStyle, CardDesign, CardFont, IconStyle, PhotoShape } from '../../api/types'
import { cardsApi } from '../../api/personal'
import { useDesignPresets, usePMutation } from '../../hooks/queries'
import { dominantColors, paletteFrom } from '../../lib/colors'
import { FONT_LABELS, FONT_STACKS, PATTERNS } from '../../lib/design'
import { FONT_PAIRS } from '../../lib/v2'
import { ColorField, ImageCropModal } from '../editorBits'
import type { PanelProps } from './doc'

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function Seg<T extends string>({ value, onChange, options, label, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; label: string; disabled?: boolean }) {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn('h-8 rounded-md px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-50', value === o.value ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const SHAPES: { value: PhotoShape; label: string; clip: string }[] = [
  { value: 'circle', label: 'Circle', clip: 'circle(50%)' },
  { value: 'rounded', label: 'Rounded', clip: 'inset(0 round 22%)' },
  { value: 'square', label: 'Square', clip: 'inset(0 round 4%)' },
  { value: 'hexagon', label: 'Hexagon', clip: 'polygon(50% 0, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)' },
]

export function DesignPanel({ doc, set, card, v2, locked }: PanelProps) {
  const presets = useDesignPresets()
  const toast = useToast()
  const onError = useErrorToast()
  const [extracting, setExtracting] = useState(false)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const uploadCover = usePMutation((f: File) => cardsApi.uploadImage(card.id, 'cover', f))
  const d = doc.design
  const designLocked = !!card.business_link?.template_locked
  const setD = (patch: Partial<CardDesign>, key?: string) => set((x) => ({ ...x, design: { ...x.design, ...patch } }), key)

  async function extract() {
    const src = card.logo_url ?? card.photo_url
    if (!src) return toast.info('Upload a photo or logo first (Content tab).')
    setExtracting(true)
    try {
      const pal = paletteFrom(await dominantColors(src))
      if (!pal) toast.info('No strong colours found in that image.')
      else {
        setD({ ...pal })
        toast.success('Colours applied from your image')
      }
    } catch {
      toast.error('Couldn’t read colours from this image.')
    } finally {
      setExtracting(false)
    }
  }

  function surprise() {
    const pals = presets.data?.palettes ?? []
    const pal = pals[Math.floor(Math.random() * pals.length)]
    const variants = [null, ...(v2?.variants ?? []).map((v) => v.id)]
    const variant = variants[Math.floor(Math.random() * variants.length)]
    const pairs = Object.keys(FONT_PAIRS)
    if (pal) setD({ primary: pal.primary, secondary: pal.secondary, accent: pal.accent, decor_style: variant, font: pairs[Math.floor(Math.random() * pairs.length)] as CardFont })
  }

  return (
    <div className={cn('space-y-6', designLocked && 'pointer-events-none opacity-60')} aria-disabled={designLocked}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" leftIcon={<Dices className="h-3.5 w-3.5" />} onClick={surprise}>
          Surprise me
        </Button>
        <Button size="sm" leftIcon={<Pipette className="h-3.5 w-3.5" />} loading={extracting} onClick={extract}>
          Colours from my logo/photo
        </Button>
      </div>

      <Section title="Palette">
        {presets.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-4">
            {(presets.data?.palettes ?? []).map((p) => {
              const active = d.primary.toLowerCase() === p.primary.toLowerCase() && (d.secondary ?? '').toLowerCase() === p.secondary.toLowerCase()
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.name}
                  aria-label={`Palette ${p.name}`}
                  aria-pressed={active}
                  onClick={() => setD({ primary: p.primary, secondary: p.secondary, accent: p.accent, ...(v2 ? {} : { background: p.background, text: p.text }) })}
                  className={cn('relative h-10 overflow-hidden rounded-lg ring-1 ring-black/10 transition hover:scale-[1.04]', active && 'ring-2 ring-fg')}
                >
                  <span className="absolute inset-y-0 left-0 w-1/2" style={{ background: p.primary }} />
                  <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: p.secondary }} />
                  <span className="absolute right-1 bottom-1 h-2.5 w-2.5 rounded-full ring-1 ring-white/60" style={{ background: p.accent }} />
                  {active && <Check className="absolute top-1 left-1 h-3.5 w-3.5 text-white drop-shadow" />}
                </button>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Colours">
        <div className="space-y-4">
          <ColorField label="Primary" value={d.primary} onChange={(v) => setD({ primary: v }, 'primary')} against={d.background} againstLabel="the background" />
          {v2 && <ColorField label="Secondary" value={d.secondary ?? '#1C1717'} onChange={(v) => setD({ secondary: v }, 'secondary')} />}
          <ColorField label="Accent" value={d.accent} onChange={(v) => setD({ accent: v }, 'accent')} against={d.background} againstLabel="the background" />
          <ColorField label="Background" value={d.background} onChange={(v) => setD({ background: v }, 'background')} />
          <ColorField label="Text" value={d.text} onChange={(v) => setD({ text: v }, 'text')} against={d.background} againstLabel="the background" />
          {v2 && <p className="text-xs text-subtle">Text on coloured shapes switches to white automatically when needed for readability.</p>}
        </div>
      </Section>

      {v2?.variants?.length ? (
        <Section title="Variant">
          <Seg<string>
            label="Template variant"
            value={d.decor_style ?? ''}
            onChange={(v) => setD({ decor_style: v || null })}
            options={[{ value: '', label: 'Default' }, ...v2.variants.map((v) => ({ value: v.id, label: v.name }))]}
          />
        </Section>
      ) : null}

      <Section title="Fonts">
        {v2 ? (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(FONT_PAIRS).map(([id, fp]) => (
              <button
                key={id}
                type="button"
                aria-pressed={d.font === id}
                onClick={() => setD({ font: id as CardFont })}
                className={cn('rounded-lg border px-3 py-2 text-left transition-colors', d.font === id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}
              >
                <span className="block truncate text-[15px] font-bold" style={{ fontFamily: fp.heading }}>
                  Aa Name
                </span>
                <span className="block truncate text-[11.5px] text-muted" style={{ fontFamily: fp.body }}>
                  {fp.name}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Seg<CardFont> label="Font" value={d.font} onChange={(v) => setD({ font: v })} options={(Object.keys(FONT_LABELS) as CardFont[]).map((f) => ({ value: f, label: <span style={{ fontFamily: FONT_STACKS[f] }}>{FONT_LABELS[f]}</span> }))} />
        )}
      </Section>

      {v2 && (
        <>
          <Section title="Photo">
            <div className="flex flex-wrap items-center gap-2">
              {SHAPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={(d.photo_shape ?? 'circle') === s.value}
                  aria-label={s.label}
                  title={s.label}
                  onClick={() => setD({ photo_shape: s.value })}
                  className={cn('flex h-11 w-11 items-center justify-center rounded-lg border transition-colors', (d.photo_shape ?? 'circle') === s.value ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}
                >
                  <span className="h-6 w-6 bg-current text-muted" style={{ clipPath: s.clip }} />
                </button>
              ))}
              <label className="ml-2 flex items-center gap-2 text-[13px]">
                <Switch checked={!!d.photo_ring} onChange={(v) => setD({ photo_ring: v })} label="Accent ring" /> Ring
              </label>
            </div>
          </Section>
          <Section title="Icons">
            <Seg<IconStyle>
              label="Icon style"
              value={d.icon_style ?? 'filled'}
              onChange={(v) => setD({ icon_style: v })}
              options={[
                { value: 'filled', label: 'Filled' },
                { value: 'outline', label: 'Outline' },
                { value: 'none', label: 'None' },
              ]}
            />
          </Section>
          <Section title="Background image" hint="Shown in the template’s image areas (e.g. Skyline Split). Leave empty for a subtle pattern.">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
                {card.cover_url ? <img src={card.cover_url} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-subtle" />}
              </div>
              <Button size="sm" loading={uploadCover.isPending} disabled={locked('cover')} onClick={() => coverInput.current?.click()}>
                {card.cover_url ? 'Replace' : 'Upload'}
              </Button>
              <input
                ref={coverInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  if (f.size > 3 * 1024 * 1024) return toast.error('The image must be 3 MB or smaller.')
                  setCoverFile(f)
                }}
              />
            </div>
            <label className="block space-y-1">
              <span className="flex justify-between text-xs text-muted">
                Opacity <span className="font-mono">{Math.round((d.background_image_opacity ?? 0) * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={d.background_image_opacity ?? 0}
                onChange={(e) => setD({ background_image_opacity: Number(e.target.value) }, 'bgop')}
                className="w-full accent-[var(--accent)]"
                aria-label="Background image opacity"
              />
            </label>
          </Section>
        </>
      )}

      {!v2 && (
        <>
          <Section title="Background style">
            <Seg<BackgroundStyle>
              label="Background style"
              value={d.background_style}
              onChange={(v) => setD({ background_style: v, pattern: v === 'pattern' ? (d.pattern ?? 'dots') : d.pattern })}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'gradient', label: 'Gradient' },
                { value: 'glass', label: 'Glass' },
                { value: 'pattern', label: 'Pattern' },
              ]}
            />
            {d.background_style === 'pattern' && <Seg<string> label="Pattern" value={d.pattern ?? 'dots'} onChange={(v) => setD({ pattern: v })} options={PATTERNS.map((p) => ({ value: p, label: p }))} />}
          </Section>
          <Section title="Corner radius">
            <input type="range" min={0} max={32} value={d.corner_radius} onChange={(e) => setD({ corner_radius: Number(e.target.value) }, 'radius')} className="w-full accent-[var(--accent)]" aria-label="Corner radius" />
          </Section>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            Show QR code <Switch checked={d.show_qr} onChange={(v) => setD({ show_qr: v })} label="Show QR code" />
          </label>
        </>
      )}

      <ImageCropModal
        file={coverFile}
        title="Crop background image"
        aspect={1200 / 630}
        outW={1200}
        outH={630}
        onClose={() => setCoverFile(null)}
        onDone={async (f) => {
          setCoverFile(null)
          try {
            await uploadCover.mutateAsync(f)
            if (!d.background_image_opacity) setD({ background_image_opacity: 0.45 })
            toast.success('Background image updated')
          } catch (e) {
            onError(e)
          }
        }}
      />
    </div>
  )
}
