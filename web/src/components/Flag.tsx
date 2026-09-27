import { cn } from '@/lib/cn'
import { flagUrl } from '@/lib/flags'

/** 3:2 country flag (SVG image, renders on every OS unlike emoji flags). */
export function Flag({ code, className }: { code: string | null | undefined; className?: string }) {
  const src = flagUrl(code)
  const box = cn('inline-block h-3.5 w-[21px] shrink-0 rounded-[2px] ring-1 ring-black/10 dark:ring-white/15', className)
  if (!src) return <span className={cn(box, 'bg-surface-3')} aria-hidden="true" />
  return <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" className={cn(box, 'object-cover')} />
}
