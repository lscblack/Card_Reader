import { cn } from '@/lib/cn'

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('-mx-4 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0', className)}>
      <div className="flex gap-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
              value === t.value ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-subtle ring-1 ring-border">{t.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
