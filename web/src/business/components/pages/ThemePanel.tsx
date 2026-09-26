import type { ReactNode } from 'react'
import { Monitor, Moon, RotateCcw, Sun } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { LAYOUTS, PAGE_FONTS, layoutOf } from '@/public/page/theme'
import type { PageHeaderStyle, ProfileTheme, ProfileType } from '../../api/types'
import { ImageField } from './PageSectionEditors'

const SWATCHES = ['#b91c1c', '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#15803d', '#0d9488', '#0369a1', '#1d4ed8', '#7c3aed', '#be185d', '#334155', '#111827']

const HEADERS: { v: PageHeaderStyle; label: string; hint: string }[] = [
  { v: 'cover', label: 'Cover', hint: 'Wide cover, logo overlapping' },
  { v: 'logo', label: 'Logo', hint: 'Centred logo and title' },
  { v: 'minimal', label: 'Minimal', hint: 'Slim top bar, big title' },
  { v: 'banner', label: 'Banner', hint: 'Accent-coloured band' },
]

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium">{label}</p>
      {children}
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  )
}

function ColorInput({ label, value, onChange, auto }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void; auto?: string }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-[12.5px]">
      <input type="color" value={value || auto || '#ffffff'} onChange={(e) => onChange(e.target.value)} className="h-7 w-8 shrink-0 cursor-pointer rounded border border-border-strong bg-surface" aria-label={`${label} colour`} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block font-mono text-[11px] text-subtle">{value || 'Auto'}</span>
      </span>
      {value && (
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label={`Reset ${label} colour`} title="Reset to automatic">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  )
}

/** Page theme: layout, header style, colours, font pair, corners, light/dark, cover and logo (Part 6 §1). */
export function ThemePanel({ theme, onChange, pageType, businessLogo }: { theme: ProfileTheme; onChange: (t: ProfileTheme) => void; pageType: ProfileType; businessLogo: string | null }) {
  const up = (patch: Partial<ProfileTheme>) => onChange({ ...theme, ...patch })
  const layout = layoutOf(theme.layout)
  const suggested = LAYOUTS.filter((l) => l.for.includes(pageType))
  const others = LAYOUTS.filter((l) => !l.for.includes(pageType))
  const accent = theme.accent || '#b91c1c'
  const dark = theme.dark === true ? 'dark' : theme.dark === false ? 'light' : 'auto'
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Layout" hint="Changes how sections look — menus, product grids, links, headings.">
          <Select aria-label="Layout" value={layout.id} onChange={(e) => up({ layout: e.target.value })}>
            <optgroup label="Suggested">
              {suggested.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Other layouts">
              {others.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Row>
        <Row label="Font">
          <Select aria-label="Font" value={theme.font ?? 'sans'} onChange={(e) => up({ font: e.target.value })}>
            {Object.entries(PAGE_FONTS).map(([id, f]) => (
              <option key={id} value={id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Row>
      </div>

      <Row label="Header">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Header style">
          {HEADERS.map((h) => {
            const on = (theme.header ?? layout.header) === h.v
            return (
              <button
                key={h.v}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => up({ header: h.v })}
                className={cn('rounded-lg border p-2 text-left transition-colors', on ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}
              >
                <HeaderGlyph kind={h.v} accent={accent} />
                <span className="mt-1.5 block text-[12.5px] font-semibold">{h.label}</span>
                <span className="block text-[11px] leading-snug text-subtle">{h.hint}</span>
              </button>
            )
          })}
        </div>
      </Row>

      <Row label="Accent colour">
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Accent ${c}`}
              aria-pressed={accent.toLowerCase() === c}
              onClick={() => up({ accent: c })}
              className={cn('h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition', accent.toLowerCase() === c ? 'ring-2 ring-fg' : 'ring-1 ring-black/10 hover:scale-110')}
              style={{ background: c }}
            />
          ))}
          <label className="ml-1 inline-flex items-center gap-2 text-xs text-muted">
            <input type="color" value={accent} onChange={(e) => up({ accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-border-strong bg-surface" aria-label="Custom accent colour" />
            <span className="font-mono">{accent}</span>
          </label>
        </div>
      </Row>

      <Row label="Page colours" hint="Leave on Auto for a neutral palette that follows the accent. Custom colours are for the designed scheme; the other scheme is derived automatically.">
        <div className="grid gap-2 sm:grid-cols-3">
          <ColorInput label="Background" value={theme.background} onChange={(background) => up({ background })} auto={theme.dark ? '#111111' : '#f6f6f5'} />
          <ColorInput label="Cards" value={theme.surface} onChange={(surface) => up({ surface })} auto={theme.dark ? '#1a1a1a' : '#ffffff'} />
          <ColorInput label="Text" value={theme.text} onChange={(text) => up({ text })} auto={theme.dark ? '#f4f4f5' : '#18181b'} />
        </div>
      </Row>

      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Light / dark" hint="Auto follows each visitor’s phone. Visitors can always switch with the toggle on the page.">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="Colour scheme">
            {(
              [
                ['auto', 'Auto', Monitor],
                ['light', 'Light', Sun],
                ['dark', 'Dark', Moon],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={dark === v}
                onClick={() => up({ dark: v === 'auto' ? null : v === 'dark' })}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium', dark === v ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg')}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label={`Corners · ${theme.corner_radius ?? 16}px`}>
          <input type="range" min={0} max={32} step={2} value={theme.corner_radius ?? 16} onChange={(e) => up({ corner_radius: Number(e.target.value) })} className="w-full accent-[var(--color-accent-solid)]" aria-label="Corner radius" />
        </Row>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Cover image" hint="Used by the Cover header. Empty = accent pattern.">
          <ImageField label="Cover" value={theme.cover_image_url} onChange={(cover_image_url) => up({ cover_image_url })} />
        </Row>
        <Row label="Logo" hint={businessLogo ? 'Defaults to your business logo.' : 'Defaults to your initials — upload a logo in Business Settings.'}>
          <ImageField label="Logo" value={theme.logo_url} onChange={(logo_url) => up({ logo_url })} />
        </Row>
      </div>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
        onClick={() => onChange({ accent: theme.accent, layout: theme.layout, font: theme.font, header: theme.header, cover_image_url: theme.cover_image_url, logo_url: theme.logo_url })}
      >
        Reset colours & scheme
      </Button>
    </div>
  )
}

function HeaderGlyph({ kind, accent }: { kind: PageHeaderStyle; accent: string }) {
  return (
    <svg viewBox="0 0 64 40" className="h-9 w-full rounded border border-border bg-surface" aria-hidden="true">
      {kind === 'cover' && (
        <>
          <rect x="0" y="0" width="64" height="16" fill={accent} opacity="0.85" />
          <rect x="6" y="11" width="11" height="11" rx="3" fill="currentColor" className="text-fg" stroke="white" strokeWidth="1.5" />
          <rect x="6" y="26" width="30" height="4" rx="2" fill="currentColor" className="text-fg" />
          <rect x="6" y="33" width="20" height="3" rx="1.5" fill="currentColor" className="text-subtle" />
        </>
      )}
      {kind === 'logo' && (
        <>
          <rect x="26" y="4" width="12" height="12" rx="3" fill={accent} />
          <rect x="17" y="21" width="30" height="4" rx="2" fill="currentColor" className="text-fg" />
          <rect x="23" y="29" width="18" height="3" rx="1.5" fill="currentColor" className="text-subtle" />
        </>
      )}
      {kind === 'minimal' && (
        <>
          <rect x="5" y="5" width="6" height="6" rx="1.5" fill={accent} />
          <rect x="14" y="6.5" width="16" height="3" rx="1.5" fill="currentColor" className="text-subtle" />
          <line x1="0" y1="15" x2="64" y2="15" stroke="currentColor" className="text-border" />
          <rect x="5" y="21" width="40" height="6" rx="2" fill="currentColor" className="text-fg" />
        </>
      )}
      {kind === 'banner' && (
        <>
          <rect x="0" y="0" width="64" height="30" rx="0" fill={accent} />
          <rect x="6" y="6" width="9" height="9" rx="2" fill="white" />
          <rect x="6" y="19" width="34" height="5" rx="2" fill="white" />
        </>
      )}
    </svg>
  )
}
