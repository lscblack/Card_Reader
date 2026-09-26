import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useIsDark, useTheme, type ThemePref } from '@/hooks/useTheme'
import { Menu } from '@/components/ui/Menu'
import { cn } from '@/lib/cn'

const opts: { value: ThemePref; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
]

/** Compact top-bar theme switcher: one icon button (effective theme) → Light / Dark / System menu. */
export function ThemeMenu({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { pref, setPref } = useTheme()
  const dark = useIsDark()
  const Icon = dark ? Moon : Sun
  return (
    <Menu
      label={`Theme: ${pref}`}
      align={align}
      trigger={
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" title="Theme">
          <Icon className="h-4.5 w-4.5" />
        </span>
      }
      header={<p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Theme</p>}
      items={opts.map(({ value, icon: OptIcon, label }) => ({
        label,
        icon: (
          <span className="inline-flex items-center gap-2">
            <Check className={cn('h-3.5 w-3.5 text-accent', pref !== value && 'invisible')} aria-hidden="true" />
            <OptIcon className="h-4 w-4 text-subtle" aria-hidden="true" />
          </span>
        ),
        onSelect: () => setPref(value),
      }))}
    />
  )
}
