import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Menu, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cn } from '@/lib/cn'
import { DASHBOARD_PATH, useIsLoggedIn, type NavTarget, useProductName, useReducedMotionPref } from '../lib'

const links: { id: NavTarget; label: string }[] = [
  { id: 'product', label: 'Product' },
  { id: 'developers', label: 'Developers' },
  { id: 'businesses', label: 'Businesses' },
  { id: 'pricing', label: 'Pricing' },
]

export function MarketingNav({ onNavigate }: { onNavigate: (t: NavTarget) => void }) {
  const loggedIn = useIsLoggedIn()
  const [open, setOpen] = useState(false)
  const reduce = useReducedMotionPref()
  const productName = useProductName()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const go = (t: NavTarget) => {
    setOpen(false)
    onNavigate(t)
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-colors duration-300',
        scrolled || open ? 'border-border bg-bg/75 backdrop-blur-xl backdrop-saturate-150' : 'border-transparent bg-transparent',
      )}
    >
      <nav className="mx-auto flex h-16 w-11/12 items-center justify-between gap-4" aria-label="Main">
        <Link to="/" className="rounded-md text-fg" aria-label={`${productName} home`}>
          <Logo />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <li key={l.id}>
              <a
                href={`#${l.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  go(l.id)
                }}
                className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <Link to="/docs" className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg">
              Docs
            </Link>
          </li>
        </ul>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle className="mr-1" />
          {loggedIn ? (
            <PrimaryLink to={DASHBOARD_PATH}>Go to dashboard</PrimaryLink>
          ) : (
            <>
              <Link to="/login" className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-muted transition-colors hover:text-fg">
                Sign in
              </Link>
              <PrimaryLink to="/register">Get started</PrimaryLink>
            </>
          )}
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg hover:bg-surface-2 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            className="overflow-hidden border-t border-border md:hidden"
          >
            <div className="mx-auto flex w-11/12 flex-col gap-1 py-4">
              {links.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    go(l.id)
                  }}
                  className="rounded-lg px-3 py-2.5 text-[15px] font-medium text-fg hover:bg-surface-2"
                >
                  {l.label}
                </a>
              ))}
              <Link to="/docs" className="rounded-lg px-3 py-2.5 text-[15px] font-medium text-fg hover:bg-surface-2">
                Docs
              </Link>
              <div className="mt-2 flex flex-col gap-2 border-t border-border pt-4">
                <div className="flex items-center justify-between px-3 pb-2 text-[14px] text-muted">
                  Theme <ThemeToggle />
                </div>
                {loggedIn ? (
                  <PrimaryLink to={DASHBOARD_PATH} className="justify-center">
                    Go to dashboard
                  </PrimaryLink>
                ) : (
                  <>
                    <Link to="/login" className="rounded-lg border border-border-strong px-4 py-2.5 text-center text-[14px] font-medium text-fg hover:bg-surface-2">
                      Sign in
                    </Link>
                    <PrimaryLink to="/register" className="justify-center">
                      Get started
                    </PrimaryLink>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

export function PrimaryLink({ to, children, className, size = 'md' }: { to: string; children: ReactNode; className?: string; size?: 'md' | 'lg' }) {
  return (
    <Link
      to={to}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-lg bg-accent-solid font-semibold text-accent-fg shadow-[0_8px_30px_-12px] shadow-accent-solid/60 transition-all hover:-translate-y-px hover:bg-accent-solid-hover',
        size === 'lg' ? 'px-5 py-3 text-[15px]' : 'px-4 py-2 text-[13.5px]',
        className,
      )}
    >
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  )
}

export function SecondaryLink({ to, children, className, external }: { to: string; children: ReactNode; className?: string; external?: boolean }) {
  const cls = cn(
    'inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface/60 px-5 py-3 text-[15px] font-semibold text-fg backdrop-blur transition-colors hover:bg-surface-2',
    className,
  )
  if (external) {
    return (
      <a href={to} className={cls} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
  return (
    <Link to={to} className={cls}>
      {children}
    </Link>
  )
}
