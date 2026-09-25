import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePref } from '@/hooks/useTheme'
import { cn } from '@/lib/cn'

const opts: { value: ThemePref; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light theme' },
  { value: 'system', icon: Monitor, label: 'System theme' },
  { value: 'dark', icon: Moon, label: 'Dark theme' },
]

export function ThemeToggle({ className }: { className?: string }) {
  const { pref, setPref } = useTheme()
  return (
    <div className={cn('inline-flex items-center rounded-lg border border-border bg-surface-2 p-0.5', className)} role="radiogroup" aria-label="Theme">
      {opts.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => setPref(value)}
          className={cn(
            'inline-flex h-6 w-7 items-center justify-center rounded-md transition-colors',
            pref === value ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-subtle hover:text-fg',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  )
}
