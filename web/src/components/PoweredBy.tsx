import { cn } from '@/lib/cn'
import { Logo } from './Logo'

/**
 * "Powered by Nexventures" credit (Part 3 §11). `brand` adds the product wordmark above it (public pages that
 * customers see; dashboards keep the plain credit).
 */
export function PoweredBy({ className, brand = false }: { className?: string; brand?: boolean }) {
  if (brand) {
    return (
      <span className={cn('inline-flex flex-col items-center gap-1.5', className)}>
        <a href="/" aria-label="Home" className="opacity-80 transition-opacity hover:opacity-100">
          <Logo variant="wordmark" imgClassName="h-8 max-w-[180px]" />
        </a>
        <PoweredBy />
      </span>
    )
  }
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
