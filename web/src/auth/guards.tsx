import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { areaOf, canEnter, homePathFor, type Area } from '@/api/auth'
import { safeNext } from '@/lib/url'
import { useAuth } from './context'
import { SessionRestoring } from './SessionRestoring'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <SessionRestoring />
  if (status === 'anonymous') {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  }
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to={homePathFor(user)} replace />
  return <>{children}</>
}

/** Keeps each account in its own area; anything else goes to the account's home dashboard. */
export function RequireArea({ area, children }: { area: Area; children: ReactNode }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!canEnter(user, area, loc.pathname)) return <Navigate to={homePathFor(user)} replace />
  return <>{children}</>
}

/** Login/register pages: once authenticated, go to ?next= (same-origin only) or the account's home. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <SessionRestoring />
  if (status === 'authenticated') {
    const raw = new URLSearchParams(loc.search).get('next')
    const next = raw ? safeNext(raw) : null
    // Only follow ?next= into an area this account may use (e.g. never send a developer to /me).
    const target = next && canEnter(user, areaOf(next), next) ? next : homePathFor(user)
    return <Navigate to={target} replace />
  }
  return <>{children}</>
}

/** Redirects an old top-level dashboard path (e.g. /applications/:id) to its /dashboard equivalent. */
export function LegacyRedirect({ to }: { to: string }) {
  const loc = useLocation()
  const params = useParams()
  const path = to.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''))
  return <Navigate to={path + loc.search + loc.hash} replace />
}

/** Sends a signed-in user to their home area (developer → /dashboard, business → /business, admin → /admin). */
export function HomeRedirect() {
  const { status, user } = useAuth()
  if (status === 'loading') return <SessionRestoring />
  return <Navigate to={homePathFor(user)} replace />
}
