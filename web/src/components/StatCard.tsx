import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Skeleton } from './ui/Spinner'
import { cn } from '@/lib/cn'

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  loading,
  className,
}: {
  label: string
  value: ReactNode
  icon?: LucideIcon
  hint?: ReactNode
  loading?: boolean
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-xl border border-border bg-surface p-4 shadow-xs', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[12.5px] font-medium text-muted">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-subtle" />}
      </div>
      {loading ? (
        <Skeleton className="mt-2.5 h-7 w-20" />
      ) : (
        <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      )}
      {hint && <p className="mt-1 truncate text-xs text-subtle">{hint}</p>}
    </div>
  )
}
