import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, ImageUp, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { Branding, BrandingAssetVariant, ThemeMode } from '@/api/types'
import { ApiError } from '@/api/client'
import { useBranding } from '@/branding/context'
import { accentContrast, accentVars, googleFontsHref, DEFAULT_BRANDING } from '@/branding'
import { useBrandingMutations, useFonts } from '@/hooks/useAdmin3'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { LogoMark } from '@/components/Logo'

const PRESETS: { name: string; light: string; dark: string }[] = [
  { name: 'Crimson', light: '#B91C1C', dark: '#E5484D' },
  { name: 'Ruby', light: '#BE123C', dark: '#F43F5E' },
  { name: 'Brick', light: '#9A3412', dark: '#F97316' },
  { name: 'Wine', light: '#881337', dark: '#FB7185' },
  { name: 'Scarlet', light: '#DC2626', dark: '#F87171' },
  { name: 'Teal', light: '#0F766E', dark: '#2DD4BF' },
  { name: 'Ocean', light: '#1D4ED8', dark: '#60A5FA' },
  { name: 'Graphite', light: '#3F3F46', dark: '#D4D4D8' },
]

type Asset = {
  variant: BrandingAssetVariant
  label: string
  hint: string
  field: 'logo_url' | 'logo_dark_url' | 'auth_logo_url' | 'auth_logo_dark_url' | 'favicon_url'
  bg: 'light' | 'dark'
  /** What shows when this asset is removed. */
  fallback: string
}

const ASSETS: Asset[] = [
  { variant: 'logo', label: 'Logo', hint: 'Dashboard navigation and small spaces. A compact mark works best.', field: 'logo_url', bg: 'light', fallback: 'The default mark will be used instead.' },
  { variant: 'logo_dark', label: 'Logo (dark mode)', hint: 'Light version for dark backgrounds.', field: 'logo_dark_url', bg: 'dark', fallback: 'The default mark will be used instead.' },
  { variant: 'favicon', label: 'Favicon', hint: 'Square, at least 64×64.', field: 'favicon_url', bg: 'light', fallback: 'The default mark will be used instead.' },
]

/** Optional wordmark (logo with the name) for sign-in pages, public pages and emails. */
const AUTH_ASSETS: Asset[] = [
  { variant: 'auth_logo', label: 'Wordmark', hint: 'Logo with the product name, for light backgrounds and emails. Optional.', field: 'auth_logo_url', bg: 'light', fallback: 'These pages will use the navigation logo.' },
  { variant: 'auth_logo_dark', label: 'Wordmark (dark)', hint: 'Light version for dark backgrounds and the sign-in side panel. Optional.', field: 'auth_logo_dark_url', bg: 'dark', fallback: 'These pages will use the navigation logo.' },
]

const ASSET_TYPES = ['image/png', 'image/svg+xml', 'image/webp']

function AssetCard({ a, b }: { a: Asset; b: Branding }) {
  const m = useBrandingMutations()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState(false)
  const url = b[a.field] ?? null
  const busy = (m.upload.isPending && m.upload.variables?.variant === a.variant) || (m.remove.isPending && m.remove.variables === a.variant)

  async function pick(file?: File) {
    if (!file) return
    if (!ASSET_TYPES.includes(file.type)) return toast.error('Use a PNG, SVG or WebP image.')
    if (file.size > 1024 * 1024) return toast.error('Branding images must be 1 MB or smaller.')
    try {
      await m.upload.mutateAsync({ variant: a.variant, file })
      toast.success(`${a.label} updated`)
    } catch (e) {
      toast.fromError(e, 'Upload failed')
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="rounded-xl border border-border">
      <div className="grid grid-cols-2 overflow-hidden rounded-t-xl">
        {(['light', 'dark'] as const).map((bg) => (
          <div key={bg} className={cn('flex h-24 items-center justify-center p-3', bg === 'light' ? 'bg-white' : 'bg-[#0c0a0a]')}>
            {url ? (
              <img src={url} alt="" className={cn('max-h-full max-w-full object-contain', a.variant === 'favicon' && 'h-10 w-10')} />
            ) : (
              <span className="text-[11px] text-zinc-400">{bg === 'light' ? 'Light' : 'Dark'} preview</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{a.label}</p>
          <p className="text-xs text-subtle">{a.hint}</p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" leftIcon={<ImageUp className="h-3.5 w-3.5" />} onClick={() => input.current?.click()} loading={busy && m.upload.isPending}>
            {url ? 'Replace' : 'Upload'}
          </Button>
          {url && (
            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${a.label}`} onClick={() => setConfirm(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <input ref={input} type="file" accept={ASSET_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Remove ${a.label.toLowerCase()}?`}
        description={a.fallback}
        confirmLabel="Remove"
        loading={m.remove.isPending}
        onConfirm={async () => {
          try {
            await m.remove.mutateAsync(a.variant)
            toast.success(`${a.label} removed`)
            setConfirm(false)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
    </div>
  )
}

function ContrastBadge({ hex, mode }: { hex: string; mode: 'light' | 'dark' }) {
  const c = accentContrast(hex, mode)
  const tone = c >= 4.5 ? 'success' : c >= 3 ? 'warning' : 'danger'
  return (
    <Badge tone={tone} title="Contrast against the theme background. The API requires ≥ 3:1; 4.5:1 is ideal for text.">
      {c ? `${c.toFixed(2)}:1` : 'invalid'} {c >= 4.5 ? 'AA' : c >= 3 ? 'AA large' : 'too low'}
    </Badge>
  )
}

function ColorField({ label, value, onChange, mode }: { label: string; value: string; onChange: (v: string) => void; mode: 'light' | 'dark' }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[13px] font-medium">{label}</label>
        <ContrastBadge hex={value} mode={mode} />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-border-strong bg-surface p-1"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value.trim())} aria-invalid={!valid} className="font-mono text-[13px] uppercase" maxLength={7} aria-label={`${label} hex`} />
      </div>
    </div>
  )
}

/** Mini UI rendered with the draft accent + fonts, in both themes. */
function LivePreview({ d }: { d: Branding }) {
  const vars = accentVars(d)
  const fontStack = (f: string) => `'${f}', ui-sans-serif, system-ui, sans-serif`
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(['light', 'dark'] as const).map((mode) => {
        const v = mode === 'light' ? vars.light : vars.dark
        const surface = mode === 'light' ? { bg: '#ffffff', fg: '#1c1717', muted: '#6f6a6a', border: '#e7e2e2', s2: '#f5f3f3' } : { bg: '#141112', fg: '#f5f1f1', muted: '#b3acac', border: '#2a2324', s2: '#1c1819' }
        const style = { ...v, background: surface.bg, color: surface.fg, borderColor: surface.border, fontFamily: fontStack(d.fonts.body) } as CSSProperties
        return (
          <div key={mode} className="rounded-xl border p-4" style={style}>
            <div className="flex items-center gap-2">
              <LogoMark className="h-6 w-6" />
              <span className="text-[14px] font-semibold" style={{ fontFamily: fontStack(d.fonts.heading) }}>
                {d.product_name || 'Product'}
              </span>
              <span className="ml-auto text-[11px]" style={{ color: surface.muted }}>
                {mode}
              </span>
            </div>
            <p className="mt-3 text-[17px] font-semibold tracking-tight" style={{ fontFamily: fontStack(d.fonts.heading) }}>
              Every tap, delivered.
            </p>
            <p className="mt-1 text-[12.5px]" style={{ color: surface.muted }}>
              {d.tagline || 'Your tagline appears here.'} <span style={{ color: 'var(--accent)' }}>Learn more →</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white" style={{ background: 'var(--accent-solid)' }}>
                Primary button
              </span>
              <span className="rounded-lg border px-3 py-1.5 text-[12.5px] font-medium" style={{ borderColor: surface.border }}>
                Secondary
              </span>
              <span className="rounded-md px-1.5 py-0.5 text-[11px] font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                Badge
              </span>
            </div>
            <div className="mt-3 flex h-12 items-end gap-1" aria-hidden="true">
              {[40, 65, 50, 80, 55, 90, 70].map((h, i) => (
                <span key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: i % 3 === 2 ? '#0d9488' : 'var(--chart-1)' }} />
              ))}
            </div>
            <code className="mt-3 block rounded px-2 py-1 text-[11.5px]" style={{ background: surface.s2, fontFamily: `'${d.fonts.mono}', ui-monospace, monospace` }}>
              card_id: 04A1B2C3D4E5
            </code>
          </div>
        )
      })}
    </div>
  )
}

function BrandingForm({ b }: { b: Branding }) {
  const fonts = useFonts()
  const m = useBrandingMutations()
  const toast = useToast()
  const [d, setD] = useState<Branding>(b)
  const [error, setError] = useState<unknown>(null)
  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setD((x) => ({ ...x, [k]: v }))
  const setTheme = (patch: Partial<Branding['theme']>) => setD((x) => ({ ...x, theme: { ...x.theme, ...patch } }))
  const setFont = (k: keyof Branding['fonts'], v: string) => setD((x) => ({ ...x, fonts: { ...x.fonts, [k]: v } }))

  // Load draft fonts for the preview.
  const previewHref = googleFontsHref([d.fonts.heading, d.fonts.body, d.fonts.mono])
  const editable = (x: Branding) =>
    JSON.stringify({
      product_name: x.product_name,
      tagline: x.tagline,
      fonts: x.fonts,
      theme: x.theme,
      support_email: x.support_email,
      company_address: x.company_address,
      social_links: x.social_links,
    })
  const dirty = editable(d) !== editable(b)
  const lowContrast = accentContrast(d.theme.accent_light, 'light') < 3 || accentContrast(d.theme.accent_dark, 'dark') < 3
  const fe = error instanceof ApiError ? error.fieldErrors : {}

  const byCat = useMemo(() => {
    const list = fonts.data ?? []
    return {
      text: list.filter((f) => f.category !== 'mono'),
      mono: list.filter((f) => f.category === 'mono'),
    }
  }, [fonts.data])

  async function save() {
    setError(null)
    try {
      await m.update.mutateAsync({
        product_name: d.product_name.trim(),
        tagline: d.tagline?.trim() || null,
        fonts: d.fonts,
        theme: d.theme,
        support_email: d.support_email?.trim() || null,
        company_address: d.company_address?.trim() || null,
        social_links: d.social_links.filter((l) => l.url.trim()),
      })
      toast.success('Branding saved and applied everywhere.')
    } catch (e) {
      setError(e)
    }
  }

  const fontSelect = (k: keyof Branding['fonts'], label: string, list: typeof byCat.text) => (
    <Field label={label}>
      {(p) => (
        <Select {...p} value={d.fonts[k]} onChange={(e) => setFont(k, e.target.value)} style={{ fontFamily: `'${d.fonts[k]}'` }}>
          {!list.some((f) => f.family === d.fonts[k]) && <option value={d.fonts[k]}>{d.fonts[k]}</option>}
          {list.map((f) => (
            <option key={f.family} value={f.family} style={{ fontFamily: `'${f.family}'` }}>
              {f.family} · {f.category}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )

  return (
    <div className="space-y-6">
      {previewHref && <link rel="stylesheet" href={previewHref} />}
      {error != null && <ErrorAlert error={error} title={error instanceof ApiError && error.code === 'branding_low_contrast' ? 'Accent colour contrast is too low' : undefined} />}

      <Card>
        <CardHeader title="Logos & favicon" description="PNG, SVG or WebP up to 1 MB. SVGs are sanitised. Changes apply immediately." />
        <CardBody className="grid gap-4 lg:grid-cols-3">
          {ASSETS.map((a) => (
            <AssetCard key={a.variant} a={a} b={b} />
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Wordmark"
          description="Optional. Shown on sign-in and sign-up pages, the landing page, docs, public business pages and digital cards, and in emails — separate from the compact logo in the dashboard navigation. Leave empty to use the navigation logo everywhere."
        />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          {AUTH_ASSETS.map((a) => (
            <AssetCard key={a.variant} a={a} b={b} />
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Identity" />
            <CardBody className="space-y-4">
              <Field label="Product name" error={fe.product_name}>
                {(p) => <Input {...p} value={d.product_name} onChange={(e) => set('product_name', e.target.value)} maxLength={60} />}
              </Field>
              <Field label="Tagline" optional error={fe.tagline}>
                {(p) => <Input {...p} value={d.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} maxLength={120} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Support email" optional error={fe.support_email}>
                  {(p) => <Input {...p} type="email" value={d.support_email ?? ''} onChange={(e) => set('support_email', e.target.value)} />}
                </Field>
                <Field label="Default theme" hint="Users can still switch.">
                  {(p) => (
                    <Select {...p} value={d.theme.default_mode} onChange={(e) => setTheme({ default_mode: e.target.value as ThemeMode })}>
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">Follow system</option>
                    </Select>
                  )}
                </Field>
              </div>
              <Field label="Company address" optional hint="Shown in email footers." error={fe.company_address}>
                {(p) => <Textarea {...p} rows={2} value={d.company_address ?? ''} onChange={(e) => set('company_address', e.target.value)} maxLength={300} />}
              </Field>
              <div className="space-y-2">
                <p className="text-[13px] font-medium">Social links</p>
                {d.social_links.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <Select
                      aria-label="Platform"
                      value={l.platform}
                      onChange={(e) => set('social_links', d.social_links.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)))}
                      className="w-36"
                    >
                      {['x', 'linkedin', 'github', 'facebook', 'instagram', 'youtube', 'website'].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label="URL"
                      type="url"
                      placeholder="https://"
                      value={l.url}
                      onChange={(e) => set('social_links', d.social_links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                    />
                    <Button size="icon" variant="ghost" aria-label="Remove link" onClick={() => set('social_links', d.social_links.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('social_links', [...d.social_links, { platform: 'website', url: '' }])} disabled={d.social_links.length >= 8}>
                  Add link
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Typography" description="Curated Google Fonts. Loaded on demand." />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              {fonts.isLoading ? (
                <Skeleton className="h-9 sm:col-span-3" />
              ) : (
                <>
                  {fontSelect('heading', 'Headings', byCat.text)}
                  {fontSelect('body', 'Body', byCat.text)}
                  {fontSelect('mono', 'Code', byCat.mono)}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Accent colour" description="Used for buttons, links, focus rings and charts. Must keep ≥ 3:1 contrast." />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Presets">
                {PRESETS.map((p) => {
                  const on = p.light.toLowerCase() === d.theme.accent_light.toLowerCase() && p.dark.toLowerCase() === d.theme.accent_dark.toLowerCase()
                  return (
                    <button
                      key={p.name}
                      role="radio"
                      aria-checked={on}
                      onClick={() => setTheme({ accent_light: p.light, accent_dark: p.dark })}
                      className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs', on ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-strong')}
                    >
                      <span className="flex overflow-hidden rounded">
                        <span className="h-4 w-4" style={{ background: p.light }} />
                        <span className="h-4 w-4" style={{ background: p.dark }} />
                      </span>
                      {p.name}
                      {on && <Check className="h-3 w-3" />}
                    </button>
                  )
                })}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ColorField label="Light mode" value={d.theme.accent_light} onChange={(v) => setTheme({ accent_light: v })} mode="light" />
                <ColorField label="Dark mode" value={d.theme.accent_dark} onChange={(v) => setTheme({ accent_dark: v })} mode="dark" />
              </div>
              <p className="text-xs text-subtle">Buttons automatically use a darker shade when needed so white text stays readable (WCAG AA).</p>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader title="Live preview" description="Unsaved changes, in both themes." />
            <CardBody>
              <LivePreview d={d} />
            </CardBody>
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <p className="text-[13px] text-muted">{dirty ? 'You have unsaved changes.' : 'Everything is saved.'}</p>
            <div className="flex gap-2">
              <Button leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setD(b)} disabled={!dirty}>
                Reset
              </Button>
              <Button
                variant="ghost"
                onClick={() => setD((x) => ({ ...x, fonts: DEFAULT_BRANDING.fonts, theme: DEFAULT_BRANDING.theme }))}
                title="Restore the default fonts and colours (not saved until you click Save)"
              >
                Defaults
              </Button>
              <Button variant="primary" onClick={save} loading={m.update.isPending} disabled={!dirty || lowContrast || !d.product_name.trim()}>
                Save & apply
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function AdminBrandingPage() {
  useDocumentTitle('Admin · Branding')
  const { branding, loading } = useBranding()
  return (
    <>
      <PageHeader title="Branding" description="Logo, name, fonts and colours — applied at runtime to the whole web app, public pages and emails." />
      {loading && !branding.updated_at ? <Skeleton className="h-96 rounded-xl" /> : <BrandingForm key={branding.updated_at ? 'loaded' : 'default'} b={branding} />}
    </>
  )
}
