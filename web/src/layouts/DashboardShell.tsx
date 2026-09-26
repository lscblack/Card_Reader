import { isValidElement, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { Bell, BookOpen, Building2, ChevronDown, Code2, Compass, IdCard, LogOut, ShieldCheck, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Settings, X, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { USE_MOCKS } from '@/api/client'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ThemeMenu } from '@/components/ThemeMenu'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { VerifyEmailBanner } from '@/components/VerifyEmailBanner'
import { PoweredBy } from '@/components/PoweredBy'
import { NotificationBell } from '@/components/NotificationBell'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { setFocusMode, useFocusMode } from '@/hooks/useShellChrome'
import { useIsDark } from '@/hooks/useTheme'
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
 * On desktop the sidebar collapses to an icon rail (Ctrl/Cmd+B, persisted); pages can hide all
 * chrome with `useFocusMode()` from '@/hooks/useShellChrome'.
 */

const COLLAPSED_KEY = 'nfc.sidebar.collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

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

const ACCOUNT_TYPES = {
  admin: { label: 'Admin', icon: ShieldCheck, tone: 'text-red-700 bg-red-50 ring-red-600/20 dark:text-red-300 dark:bg-red-500/10 dark:ring-red-400/20' },
  developer: { label: 'Developer account', icon: Code2, tone: 'text-sky-700 bg-sky-50 ring-sky-600/20 dark:text-sky-300 dark:bg-sky-500/10 dark:ring-sky-400/20' },
  business: { label: 'Business account', icon: Building2, tone: 'text-amber-800 bg-amber-50 ring-amber-600/25 dark:text-amber-300 dark:bg-amber-500/10 dark:ring-amber-400/20' },
  personal: { label: 'Personal account', icon: IdCard, tone: 'text-emerald-700 bg-emerald-50 ring-emerald-600/20 dark:text-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-400/20' },
} as const

/** Which kind of account is signed in — shown under the name in every dashboard's top bar and user menu. */
function AccountTypeLabel({
  user,
  badge = false,
  className,
}: {
  user: { role?: string; account_type?: string } | null | undefined
  badge?: boolean
  className?: string
}) {
  if (!user) return null
  const key = user.role === 'admin' ? 'admin' : ((user.account_type ?? 'developer') as keyof typeof ACCOUNT_TYPES)
  const t = ACCOUNT_TYPES[key] ?? ACCOUNT_TYPES.developer
  const Icon = t.icon
  if (!badge) {
    return (
      <span className={cn('flex items-center gap-1 text-[11px] text-subtle', className)} data-testid="account-type">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {t.label}
      </span>
    )
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', t.tone, className)}
      data-testid="account-type-badge"
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t.label}
    </span>
  )
}

function UnreadBadge({ count }: { count: number }) {
  if (!count) return null
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-solid px-1.5 text-[11px] font-semibold text-accent-fg tabular-nums"
      aria-label={`${count} unread`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** Collapsed-rail stand-in for a nav badge. Empty badges (e.g. a zero unread count) render nothing. */
function NavDot({ badge }: { badge: ReactNode }) {
  if (badge === false || badge === '' || badge === 0) return null
  if (isValidElement<{ count?: number }>(badge) && badge.type === UnreadBadge && !badge.props.count) return null
  return <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-accent-solid ring-2 ring-surface" aria-hidden="true" />
}

function SidebarNav({
  nav,
  notificationsPath,
  onNavigate,
  collapsed = false,
}: {
  nav: ShellNavSection[]
  notificationsPath: string
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const { user } = useAuth()
  const { count, supported } = useUnreadNotifications()
  // Every dashboard gets a pinned "Notifications" entry with the live unread counter.
  const withInbox: ShellNavSection[] = supported
    ? [...nav, { title: 'Inbox', items: [{ to: notificationsPath, label: 'Notifications', icon: Bell, badge: <UnreadBadge count={count} />, tour: 'nav-notifications' }] }]
    : nav
  return (
    <nav className={cn('flex-1 overflow-x-hidden overflow-y-auto py-4', collapsed ? 'space-y-3 px-2' : 'space-y-5 px-3')} aria-label="Main">
      {withInbox.map((section, i) => {
        const items = section.items.filter((it) => !it.adminOnly || user?.role === 'admin')
        if (!items.length) return null
        return (
          <div key={section.title ?? i}>
            {collapsed ? (
              i > 0 && <div className="mx-2 mb-3 border-t border-border" aria-hidden="true" />
            ) : section.title && (
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
                    title={collapsed ? it.label : undefined}
                    aria-label={collapsed ? it.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center rounded-lg text-[13.5px] font-medium transition-colors',
                        collapsed ? 'h-9 justify-center' : 'gap-2.5 px-2.5 py-1.5',
                        isActive ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden="true" />}
                        <it.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-accent' : 'text-subtle group-hover:text-muted')} />
                        {collapsed ? (
                          it.badge != null && <NavDot badge={it.badge} />
                        ) : (
                          <>
                            <span className="truncate">{it.label}</span>
                            {it.badge != null && <span className="ml-auto">{it.badge}</span>}
                          </>
                        )}
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
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const { focus } = useFocusMode()
  const dark = useIsDark()

  // Mobile browser toolbar colour follows the app theme (see index.html).
  useEffect(() => {
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#141112' : '#ffffff'))
  }, [dark])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'b') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return
      e.preventDefault()
      toggleCollapsed()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggleCollapsed])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  useEffect(() => {
    window.scrollTo(0, 0)
    setFocusMode(false)
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
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {!focus && (
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out lg:flex',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          <div className={cn('flex h-14 shrink-0 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'justify-between gap-2 pr-2 pl-5')}>
            {!collapsed && <Brand label={label} homeTo={homeTo} />}
            <button
              type="button"
              onClick={toggleCollapsed}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle hover:bg-surface-2 hover:text-fg"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
            >
              {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
            </button>
          </div>
          {sidebarTop && !collapsed && <div className="border-b border-border px-3 py-3">{sidebarTop}</div>}
          <SidebarNav nav={nav} notificationsPath={`${homeTo}/notifications`} collapsed={collapsed} />
          {collapsed ? (
            <div className="flex justify-center border-t border-border py-3">
              <ThemeMenu align="left" />
            </div>
          ) : (
            footer
          )}
        </aside>
      )}

      {drawerOpen && !focus && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="animate-slide-in-left absolute inset-y-0 left-0 flex w-[272px] max-w-[85vw] flex-col border-r border-border bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <Brand label={label} homeTo={homeTo} />
              <button
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebarTop && <div className="border-b border-border px-3 py-3">{sidebarTop}</div>}
            <SidebarNav nav={nav} notificationsPath={`${homeTo}/notifications`} onNavigate={() => setDrawerOpen(false)} />
            {footer}
          </aside>
        </div>
      )}

      <div className={cn('transition-[padding] duration-200 ease-out', !focus && (collapsed ? 'lg:pl-16' : 'lg:pl-60'))}>
        {!focus && (
          <header className="sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b border-border bg-surface/85 pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-md sm:gap-3 sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))]">
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
            <ThemeMenu />
            <NotificationBell />
            <NavLink
              to="/docs"
              className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex"
            >
              <BookOpen className="h-4 w-4" /> Docs
            </NavLink>
            <Menu
              label="User menu"
              trigger={
                <span className="flex min-h-9 items-center gap-2 rounded-lg py-1 pr-1.5 pl-1 hover:bg-surface-2">
                  <Avatar src={user?.avatar_url} name={user?.full_name} email={user?.email} size="sm" />
                  <span className="hidden min-w-0 flex-col text-left leading-tight sm:flex">
                    <span className="max-w-[160px] truncate text-[13px] font-medium">{user?.full_name || user?.email}</span>
                    <AccountTypeLabel user={user} />
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-subtle sm:block" />
                </span>
              }
              header={
                <div className="mb-1 flex items-center gap-2.5 border-b border-border px-2.5 pt-1.5 pb-2.5">
                  <Avatar src={user?.avatar_url} name={user?.full_name} email={user?.email} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{user?.full_name}</p>
                    <p className="truncate text-xs text-subtle">{user?.email}</p>
                    <AccountTypeLabel user={user} badge className="mt-1.5" />
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
        )}

        <main
          id="main"
          className={cn(
            focus
              ? 'w-full px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-4'
              : 'mx-auto w-11/12 py-6 sm:py-8',
          )}
        >
          <MaintenanceBanner />
          {showVerifyBanner && !focus && <VerifyEmailBanner />}
          {children ?? <Outlet />}
        </main>
        <TourWelcome />
      </div>
    </div>
  )
}
