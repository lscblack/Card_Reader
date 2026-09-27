import { useBranding } from '@/branding/context'
import { useIsDark } from '@/hooks/useTheme'
import { cn } from '@/lib/cn'

/** The built-in NFC mark (used when no branding logo is uploaded). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-7 w-7 shrink-0', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-accent-solid" />
      <path
        d="M11 10c3 3.5 3 8.5 0 12M15.5 7.5c4.5 5 4.5 12 0 17M20 5c6 6.5 6 15.5 0 22"
        className="stroke-accent-fg"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Product logo from runtime branding (Part 3). Renders the uploaded logo (the dark variant in dark mode,
 * falling back to the light one); without an upload it shows the NFC mark + product name.
 *
 * - `withText={false}`: compact mark only (uploaded logos are shown as-is, clipped to `markClassName` height).
 * - `imgClassName`: height of an uploaded logo (default h-7).
 * - `surface`: 'dark' | 'light' to pick the logo variant for a fixed background (default follows the theme).
 * - `variant="wordmark"`: sign-in pages, public pages and footers use the optional wordmark (Branding → wordmark),
 *   shown larger; without one they fall back to the navigation logo. Dashboard navigation keeps the compact logo.
 */
export function Logo({
  className,
  withText = true,
  imgClassName,
  markClassName,
  surface = 'auto',
  variant = 'nav',
}: {
  className?: string
  withText?: boolean
  imgClassName?: string
  markClassName?: string
  /** Background the logo sits on: 'auto' follows the theme; 'dark' forces the dark-mode logo (e.g. on a dark hero). */
  surface?: 'auto' | 'light' | 'dark'
  variant?: 'nav' | 'wordmark'
}) {
  const { branding } = useBranding()
  const themeDark = useIsDark()
  const dark = surface === 'auto' ? themeDark : surface === 'dark'
  const authSrc =
    variant === 'wordmark'
      ? (dark ? branding.auth_logo_dark_url || branding.auth_logo_url : branding.auth_logo_url || branding.auth_logo_dark_url) ?? null
      : null
  if (authSrc) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <img src={authSrc} alt={branding.product_name} className={cn('h-11 w-auto max-w-[260px] object-contain', imgClassName)} />
      </span>
    )
  }
  const src = (dark ? branding.logo_dark_url || branding.logo_url : branding.logo_url || branding.logo_dark_url) ?? null
  if (src) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <img
          src={src}
          alt={branding.product_name}
          className={cn('h-7 w-auto max-w-[160px] object-contain', !withText && 'max-w-[28px] object-left', imgClassName)}
        />
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={markClassName} />
      {withText && <span className="truncate text-[15px] font-semibold tracking-tight">{branding.product_name}</span>}
    </span>
  )
}
