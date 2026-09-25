import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { homePathFor } from '@/api/auth'
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

/** Login/register pages: once authenticated, go to ?next= (same-origin only) or the account's home. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <SessionRestoring />
  if (status === 'authenticated') {
    const next = new URLSearchParams(loc.search).get('next')
    return <Navigate to={next ? safeNext(next) : homePathFor(user)} replace />
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
