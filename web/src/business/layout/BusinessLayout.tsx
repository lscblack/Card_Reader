import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { AlertTriangle, BadgeCheck, Check, ChevronsUpDown, Code2, ShieldAlert } from 'lucide-react'
import { safeImageUrl } from '@/lib/url'
import { useAuth } from '@/auth/context'
import { DashboardShell } from '@/layouts/DashboardShell'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { FloatingPanel } from '@/components/ui/Popover'
import { useDismiss } from '@/components/ui/useDismiss'
import type { Business, BusinessMe, Permission } from '../api/types'
import { BusinessContext, type BusinessContextValue } from '../hooks/context'
import { useBusinessDetail, useBusinessMe, useBusinesses } from '../hooks/queries'
import { ROLE_LABELS, ROLE_PERMISSIONS } from '../lib/permissions'
import { planName } from '../lib/format'
import { setLastBusiness } from '../lib/lastBusiness'
import { BizErrorState } from '../components/BizError'
import { businessNav } from './nav'
import { useTour } from '@/tours'
import { BUSINESS_TOUR_ID, businessTourSteps } from './tour'

function BizLogo({ b, size = 28 }: { b: Pick<Business, 'name' | 'logo_url'>; size?: number }) {
  const logo = safeImageUrl(b.logo_url)
  if (logo) return <img src={logo} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-lg object-cover ring-1 ring-border" />
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-lg bg-accent-solid text-[12px] font-semibold text-accent-fg" aria-hidden="true">
      {b.name.trim().charAt(0).toUpperCase() || 'B'}
    </span>
  )
}

function Switcher({ current, businesses, me }: { current: Business; businesses: Business[]; me: BusinessMe | null }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const loc = useLocation()
  const close = useCallback(() => {
    setOpen(false)
    setQ('')
  }, [])
  useDismiss(open, close, [anchorRef, panelRef])

  const multi = businesses.length > 1
  const inner = (
    <>
      <BizLogo b={current} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13.5px] font-semibold">{current.name}</span>
        <span className="block truncate text-[11.5px] text-subtle">
          {me ? ROLE_LABELS[me.role] : '—'} · {planName(current.plan)}
        </span>
      </span>
      {multi && <ChevronsUpDown className="h-4 w-4 shrink-0 text-subtle" />}
    </>
  )
  if (!multi) return <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">{inner}</div>

  const switchTo = (id: string) => {
    close()
    // Keep the section (e.g. /cards) but drop detail ids, which belong to the other business.
    const section = loc.pathname.split('/')[3] ?? ''
    navigate(`/business/${id}${section ? `/${section}` : ''}`)
  }
  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Switch business (current: ${current.name})`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2"
      >
        {inner}
      </button>
      <FloatingPanel anchorRef={anchorRef} panelRef={panelRef} open={open} matchWidth maxHeight={380} role="listbox" ariaLabel="Businesses" className="p-1">
          {businesses.length > 6 && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search businesses…"
              aria-label="Search businesses"
              className="mb-1 h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] outline-none focus:border-accent"
            />
          )}
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Your businesses</p>
          <div className="min-h-0 overflow-y-auto">
          {businesses.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase())).map((b) => (
            <button
              key={b.id}
              role="option"
              aria-selected={b.id === current.id}
              onClick={() => switchTo(b.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2"
            >
              <BizLogo b={b} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{b.name}</span>
                {b.role && <span className="block text-[11.5px] text-subtle">{ROLE_LABELS[b.role]}</span>}
              </span>
              {b.id === current.id && <Check className="h-4 w-4 text-accent" />}
            </button>
          ))}
          </div>
      </FloatingPanel>
    </div>
  )
}

function StatusBanners({ business }: { business: Business }) {
  if (business.status === 'suspended') {
    return (
      <div className="mb-6 flex gap-3 rounded-xl border border-red-300/70 bg-red-50 px-4 py-3 text-[13px] text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100" role="alert">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">This business is suspended</p>
          <p className="opacity-90">Cards, tags and public pages are disabled and devices can’t send events. Contact support to restore access.</p>
        </div>
      </div>
    )
  }
  if (!business.verified) {
    return (
      <div className="mb-6 flex gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" role="status">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Not verified yet</p>
          <p className="opacity-90">
            You can set everything up, but customers who tap a card see a neutral “not verified yet” page until the owner verifies their email
            address.
          </p>
        </div>
      </div>
    )
  }
  return null
}

export function BusinessLayout() {
  const { businessId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const list = useBusinesses()
  const detail = useBusinessDetail(businessId)
  const meQ = useBusinessMe(businessId)

  useEffect(() => {
    if (detail.data) setLastBusiness(detail.data.id)
  }, [detail.data])

  const business = detail.data
  const businesses = useMemo(() => {
    const xs = list.data ?? []
    return business && !xs.some((b) => b.id === business.id) ? [business, ...xs] : xs
  }, [list.data, business])

  // Fallback when /me fails: derive from the role in the membership list (UI only; backend enforces).
  const me: BusinessMe | null = useMemo(() => {
    if (meQ.data) return meQ.data
    if (!meQ.error) return null
    const role = list.data?.find((b) => b.id === businessId)?.role ?? user?.memberships?.find((m) => m.business_id === businessId)?.role
    return role ? { role, permissions: ROLE_PERMISSIONS[role] } : { role: 'staff', permissions: ['business.view'] }
  }, [meQ.data, meQ.error, list.data, businessId, user])

  const base = `/business/${businessId}`
  const ctx = useMemo<BusinessContextValue | null>(() => (business ? { business, businesses, me, base } : null), [business, businesses, me, base])
  const can = useMemo(() => (p: Permission) => !!me?.permissions.includes(p), [me])
  const nav = useMemo(() => businessNav(base, can), [base, can])
  const tourSteps = useMemo(() => businessTourSteps(base), [base])
  useTour(BUSINESS_TOUR_ID, tourSteps, { ready: !!detail.data && !meQ.isLoading })

  if (detail.isLoading || (meQ.isLoading && !meQ.error)) return <FullPageSpinner />
  if (detail.error || !ctx) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-sm">
          <BizErrorState error={detail.error ?? new Error('Business not found')} onRetry={() => detail.refetch()} />
          <div className="flex justify-center border-t border-border px-4 py-3">
            <Link to="/business">
              <Button size="sm">Back to my businesses</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <BusinessContext.Provider value={ctx}>
      <DashboardShell
        nav={nav}
        homeTo={base}
        sidebarTop={
          <div data-tour="biz-switcher">
            <Switcher current={ctx.business} businesses={businesses} me={me} />
          </div>
        }
        header={
          <span className="hidden min-w-0 items-center gap-1.5 text-[13px] font-medium text-muted md:flex">
            <span className="truncate">{ctx.business.name}</span>
            {ctx.business.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-accent" aria-label="Verified" />}
          </span>
        }
        userMenuItems={[
          ...(user?.account_type === 'developer' || user?.role === 'admin'
            ? [{ label: 'Developer dashboard', icon: <Code2 className="h-4 w-4 text-subtle" />, onSelect: () => navigate('/dashboard') }]
            : []),
        ]}
      >
        <StatusBanners business={ctx.business} />
        <div className="min-w-0">
          <Outlet />
        </div>
      </DashboardShell>
    </BusinessContext.Provider>
  )
}
