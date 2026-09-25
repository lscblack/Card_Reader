import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PoweredBy } from '@/components/PoweredBy'
import { AuthVisualHeader, AuthVisualPanel } from '@/components/auth/AuthVisual'

/**
 * Two-column auth layout: animated brand panel on the left (desktop), form on the right.
 * On small screens the panel collapses into a compact animated header above the form.
 * Props unchanged from Part 1, so every auth-style page (incl. the business invite page) gets it.
 */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-screen" aria-label="Product highlights">
        <AuthVisualPanel />
      </aside>

      <div className="flex min-h-screen flex-col">
        <div className="lg:hidden">
          <AuthVisualHeader />
        </div>
        <header className="flex items-center justify-between px-4 py-4 sm:px-8">
          <Link to="/" aria-label="Home" className="lg:invisible">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:pt-10 lg:items-center lg:pt-0">
          <div className="animate-pop-in w-full max-w-[420px]">
            <div className="mb-7">
              <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>
              {subtitle && <p className="mt-2 text-[14px] text-muted">{subtitle}</p>}
            </div>
            <div className="space-y-4">{children}</div>
            {footer && <div className="mt-8 border-t border-border pt-5 text-[13px] text-muted">{footer}</div>}
          </div>
        </main>
        <footer className="flex flex-col items-center gap-2 px-4 pb-6 text-center text-xs text-subtle sm:px-8">
          <span>A card UID is an identifier, not proof of identity. Use cards responsibly.</span>
          <PoweredBy />
        </footer>
      </div>
    </div>
  )
}
