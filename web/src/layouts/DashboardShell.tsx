import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { BookOpen, ChevronDown, Compass, LogOut, Menu as MenuIcon, Settings, X, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { USE_MOCKS } from '@/api/client'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { VerifyEmailBanner } from '@/components/VerifyEmailBanner'
import { PoweredBy } from '@/components/PoweredBy'
import { NotificationBell } from '@/components/NotificationBell'
import { startTour, usePageTours, TourWelcome } from '@/tours'
import { MaintenanceBanner } from '@/components/MaintenanceBanner'
import { cn } from '@/lib/cn'

/**
 * Reusable dashboard chrome: responsive sidebar (drawer on mobile) + sticky top bar + user menu.
 * Used by the developer dashboard (/dashboard), the admin console (/admin) and the business dashboard.
 *
 *   <DashboardShell nav={sections} label="Business" sidebarTop={<WorkspaceSwitcher/>} />
 *
 * Children default to <Outlet/> so it can be a layout route element.
 */

export interface ShellNavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Match the path exactly (for index routes). */
  end?: boolean
  /** Hide unless user.role === 'admin'. */
  adminOnly?: boolean
  /** Small trailing badge (e.g. a count or "New"). */
  badge?: ReactNode
  /** `data-tour` hook for product tours (e.g. "nav-events"). */
  tour?: string
}

export interface ShellNavSection {
  title?: string
  items: ShellNavItem[]
}

export interface DashboardShellProps {
  nav: ShellNavSection[]
  /** Small label next to the logo, e.g. "Admin" or the workspace name. */
  label?: ReactNode
  /** Where the logo links to. */
  homeTo?: string
  /** Rendered above the nav in the sidebar (e.g. a workspace switcher). */
  sidebarTop?: ReactNode
  /** Rendered in the sidebar footer above the theme toggle. */
  sidebarFooter?: ReactNode
  /** Extra top-bar content, left of the Docs link / user menu. */
  header?: ReactNode
  /** Path for "Account settings" in the user menu. */
  settingsPath?: string
  /** Extra user-menu entries (shown before "Account settings"). */
  userMenuItems?: MenuItem[]
  /** Show the "verify your email" banner for unverified users (default true). */
  showVerifyBanner?: boolean
  children?: ReactNode
}

function SidebarNav({ nav, onNavigate }: { nav: ShellNavSection[]; onNavigate?: () => void }) {
  const { user } = useAuth()
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {nav.map((section, i) => {
        const items = section.items.filter((it) => !it.adminOnly || user?.role === 'admin')
        if (!items.length) return null
        return (
          <div key={section.title ?? i}>
            {section.title && (
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">{section.title}</p>
            )}
            <ul className="space-y-0.5">
              {items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.end}
                    onClick={onNavigate}
                    data-tour={it.tour}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium transition-colors',
                        isActive ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden="true" />}
                        <it.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-accent' : 'text-subtle group-hover:text-muted')} />
                        <span className="truncate">{it.label}</span>
                        {it.badge != null && <span className="ml-auto">{it.badge}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function Brand({ label, homeTo }: { label?: ReactNode; homeTo: string }) {
  return (
    <Link to={homeTo} className="flex min-w-0 items-center gap-2" aria-label="Home">
      <Logo />
      {label && (
        <span className="truncate rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-accent uppercase">
          {label}
        </span>
      )}
    </Link>
  )
}

export function DashboardShell({
  nav,
  label,
  homeTo = '/dashboard',
  sidebarTop,
  sidebarFooter,
  header,
  settingsPath = '/dashboard/settings',
  userMenuItems = [],
  showVerifyBanner = true,
  children,
}: DashboardShellProps) {
  const { user, logout } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const pageTours = usePageTours()

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  const footer = (
    <div className="space-y-3 border-t border-border px-4 py-3">
      {sidebarFooter}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-subtle">
          Plan: <span className="font-medium text-fg capitalize">{user?.plan ?? 'free'}</span>
        </span>
        <ThemeToggle />
      </div>
      <PoweredBy />
    </div>
  )

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-14 items-center border-b border-border px-5">
          <Brand label={label} homeTo={homeTo} />
        </div>
        {sidebarTop && <div className="border-b border-border px-3 py-3">{sidebarTop}</div>}
        <SidebarNav nav={nav} />
        {footer}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="animate-slide-in-left absolute inset-y-0 left-0 flex w-[272px] max-w-[85vw] flex-col border-r border-border bg-surface shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <Brand label={label} homeTo={homeTo} />
              <button
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebarTop && <div className="border-b border-border px-3 py-3">{sidebarTop}</div>}
            <SidebarNav nav={nav} onNavigate={() => setDrawerOpen(false)} />
            {footer}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur-md sm:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 lg:hidden"
            aria-label="Open navigation"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <Link to={homeTo} className="lg:hidden" aria-label="Home">
            <Logo withText={false} />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
          {USE_MOCKS && (
            <Badge tone="warning" title="VITE_USE_MOCKS=true — all data is fake and in-memory">
              Mock data
            </Badge>
          )}
          <NotificationBell />
          <NavLink
            to="/docs"
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex"
          >
            <BookOpen className="h-4 w-4" /> Docs
          </NavLink>
          <Menu
            label="User menu"
            trigger={
              <span className="flex items-center gap-2 rounded-lg py-1 pr-1.5 pl-1 hover:bg-surface-2">
                <Avatar src={user?.avatar_url} name={user?.full_name} email={user?.email} size="sm" />
                <span className="hidden max-w-[160px] truncate text-[13px] font-medium sm:block">{user?.full_name || user?.email}</span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-subtle sm:block" />
              </span>
            }
            header={
              <div className="mb-1 flex items-center gap-2.5 border-b border-border px-2.5 pt-1.5 pb-2.5">
                <Avatar src={user?.avatar_url} name={user?.full_name} email={user?.email} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{user?.full_name}</p>
                  <p className="truncate text-xs text-subtle">{user?.email}</p>
                </div>
              </div>
            }
            items={[
              ...userMenuItems,
              ...(pageTours.length
                ? [{ label: 'Replay page tour', icon: <Compass className="h-4 w-4 text-subtle" />, onSelect: () => startTour(pageTours[pageTours.length - 1]) }]
                : []),
              { label: 'Account settings', icon: <Settings className="h-4 w-4 text-subtle" />, onSelect: () => navigate(settingsPath) },
              { label: 'Log out', icon: <LogOut className="h-4 w-4" />, onSelect: logout, danger: true },
            ]}
          />
        </header>

        <main id="main" className="mx-auto w-11/12 py-6 sm:py-8">
          <MaintenanceBanner />
          {showVerifyBanner && <VerifyEmailBanner />}
          {children ?? <Outlet />}
        </main>
        <TourWelcome />
      </div>
    </div>
  )
}
