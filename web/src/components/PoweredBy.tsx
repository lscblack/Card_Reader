import { cn } from '@/lib/cn'

/** "Powered by Nexventures" credit (Part 3 §11). */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <a
      href="http://nexventures.net/"
      target="_blank"
      rel="noopener"
      className={cn('inline-flex items-center gap-1 text-[11px] text-subtle transition-colors hover:text-fg', className)}
    >
      Powered by <span className="font-semibold tracking-tight">Nexventures</span>
    </a>
  )
}
