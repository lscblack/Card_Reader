import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Menu, Search as SearchIcon, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cn } from '@/lib/cn'
import { useDashboardPath, POWERED_BY_URL, useIsLoggedIn, useProductName } from '@/marketing/lib'
import { DownloadApp } from '@/marketing/components/DownloadApp'
import { docGroups, docPages, docPath } from './nav'
import { SearchDialog } from './components/Search'

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation" className="space-y-7 text-[14px]">
      {docGroups.map((g) => (
        <div key={g}>
          <p className="mb-2 px-3 text-[11.5px] font-semibold tracking-wider text-subtle uppercase">{g}</p>
          <ul className="space-y-0.5">
            {docPages
              .filter((p) => p.group === g)
              .map((p) => (
                <li key={p.slug}>
                  <NavLink
                    to={docPath(p.slug)}
                    end
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-lg px-3 py-1.5 transition-colors',
                        isActive ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                      )
                    }
                  >
                    {p.title}
                  </NavLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <div className="space-y-3 border-t border-border pt-5">
        <DownloadApp compact />
        <a href={POWERED_BY_URL} target="_blank" rel="noopener" className="block px-3 text-[12px] text-subtle transition-colors hover:text-accent">
          Powered by Nexventures
        </a>
      </div>
    </nav>
  )
}

interface TocItem {
  id: string
  title: string
  level: 2 | 3
}

function useToc(articleRef: RefObject<HTMLElement | null>, key: string) {
  const [items, setItems] = useState<TocItem[]>([])
  const [active, setActive] = useState<string | null>(null)

  const collect = useCallback(() => {
    const el = articleRef.current
    if (!el) return
    const hs = Array.from(el.querySelectorAll<HTMLElement>('[data-toc]'))
    const next = hs.map((h) => ({ id: h.id, title: h.textContent ?? '', level: (h.tagName === 'H3' ? 3 : 2) as 2 | 3 }))
    setItems((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.title === next[i].title) ? prev : next))
  }, [articleRef])

  useEffect(() => {
    collect()
    const el = articleRef.current
    if (!el) return
    const mo = new MutationObserver(() => collect())
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [collect, articleRef, key])

  useEffect(() => {
    const onScroll = () => {
      let current: string | null = null
      for (const it of items) {
        const h = document.getElementById(it.id)
        if (h && h.getBoundingClientRect().top < 120) current = it.id
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && items.length) {
        current = items[items.length - 1].id
      }
      setActive(current ?? items[0]?.id ?? null)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [items])

  return { items, active }
}

export default function DocsLayout() {
  const location = useLocation()
  const productName = useProductName()
  const loggedIn = useIsLoggedIn()
  const dashboardPath = useDashboardPath()
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const articleRef = useRef<HTMLElement>(null)
  const { items, active } = useToc(articleRef, location.pathname)

  // Cmd/Ctrl-K and "/" open search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((o) => !o)
      } else if (e.key === '/' && !typing) {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === 'Escape') {
        setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Scroll to the hash target (or the top) after navigation.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) {
      window.scrollTo({ top: 0 })
      return
    }
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 30)
    return () => window.clearTimeout(t)
  }, [location.pathname, location.hash])

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <div className="min-h-screen bg-bg font-sans text-fg antialiased">
      <a
        href="#docs-content"
        className="sr-only z-50 rounded-md bg-accent-solid px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 w-11/12 items-center gap-3">
          <button
            type="button"
            className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg hover:bg-surface-2 lg:hidden"
            aria-label="Open documentation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/" className="shrink-0 rounded-md" aria-label={`${productName} home`}>
            <span className="sm:hidden">
              <Logo withText={false} />
            </span>
            <span className="hidden sm:inline">
              <Logo />
            </span>
          </Link>
          <Link to="/docs" className="rounded-md bg-surface-2 px-2 py-0.5 text-[12.5px] font-semibold text-muted hover:text-fg">
            Docs
          </Link>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13.5px] text-subtle transition-colors hover:border-border-strong hover:text-muted md:ml-6 md:w-72"
            aria-label="Search documentation"
          >
            <SearchIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden truncate md:inline">Search docs…</span>
            <kbd className="ml-auto hidden rounded border border-border px-1.5 text-[11px] md:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>

          <div className="hidden items-center gap-3 md:ml-auto md:flex">
            <ThemeToggle />
            {loggedIn ? (
              <Link to={dashboardPath} className="rounded-lg bg-accent-solid px-3.5 py-2 text-[13px] font-semibold text-accent-fg hover:bg-accent-solid-hover">
                Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-[13.5px] font-medium text-muted hover:text-fg">
                  Sign in
                </Link>
                <Link to="/register" className="rounded-lg bg-accent-solid px-3.5 py-2 text-[13px] font-semibold text-accent-fg hover:bg-accent-solid-hover">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Documentation menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <div className="animate-slide-in-left absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col overflow-y-auto border-r border-border bg-bg p-4">
            <div className="mb-5 flex items-center justify-between">
              <Logo />
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-2"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SideNav onNavigate={() => setMenuOpen(false)} />
            <div className="mt-6 flex flex-col gap-2 border-t border-border pt-5">
              <ThemeToggle className="self-start" />
              {loggedIn ? (
                <Link to={dashboardPath} className="rounded-lg bg-accent-solid px-3.5 py-2 text-center text-[14px] font-semibold text-accent-fg">
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link to="/login" className="rounded-lg border border-border-strong px-3.5 py-2 text-center text-[14px] font-medium text-fg">
                    Sign in
                  </Link>
                  <Link to="/register" className="rounded-lg bg-accent-solid px-3.5 py-2 text-center text-[14px] font-semibold text-accent-fg">
                    Get started
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto grid w-11/12 gap-10 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_200px]">
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-8 pr-2">
            <SideNav />
          </div>
        </aside>

        <main id="docs-content" ref={articleRef} className="min-w-0 py-8 lg:py-10">
          <Outlet />
        </main>

        <aside className="hidden xl:block" aria-label="On this page">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-10">
            {items.length > 0 && (
              <>
                <p className="mb-3 text-[11.5px] font-semibold tracking-wider text-subtle uppercase">On this page</p>
                <ul className="space-y-0.5 border-l border-border text-[13px]">
                  {items.map((it) => (
                    <li key={it.id}>
                      <a
                        href={`#${it.id}`}
                        className={cn(
                          '-ml-px block border-l-2 py-1 transition-colors',
                          it.level === 3 ? 'pl-6' : 'pl-3',
                          active === it.id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-fg',
                        )}
                      >
                        {it.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </aside>
      </div>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex w-11/12 flex-wrap items-center justify-between gap-3 text-[12.5px] text-subtle">
          <p>
            © {new Date().getFullYear()} {productName} ·{' '}
            <a href={POWERED_BY_URL} target="_blank" rel="noopener" className="font-medium text-muted hover:text-accent">
              Powered by Nexventures
            </a>
          </p>
          <div className="flex gap-4">
            <Link to="/" className="hover:text-fg">
              Home
            </Link>
            <Link to="/docs/changelog" className="hover:text-fg">
              Changelog
            </Link>
            <Link to="/docs/errors" className="hover:text-fg">
              Error codes
            </Link>
          </div>
        </div>
      </footer>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
