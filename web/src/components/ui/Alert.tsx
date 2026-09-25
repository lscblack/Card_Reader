import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

type Tone = 'info' | 'warning' | 'danger' | 'success'
const styles: Record<Tone, string> = {
  info: 'border-accent/25 bg-accent-soft text-fg',
  warning: 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  danger: 'border-red-300/70 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
  success: 'border-emerald-300/70 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
}
const icons = { info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle2 }

export function Alert({ tone = 'info', title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = icons[tone]
  return (
    <div className={cn('flex gap-2.5 rounded-lg border p-3 text-[13px]', styles[tone], className)} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'info' && 'text-accent')} />
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn('leading-relaxed [&_p]:!m-0', title ? 'mt-0.5 opacity-90' : '')}>{children}</div>}
      </div>
    </div>
  )
}
