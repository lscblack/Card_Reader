/* eslint-disable react-refresh/only-export-components -- route table module, not hot-reloaded as a component */
import { lazy, Suspense, type ReactNode } from 'react'
import { Route } from 'react-router'
import { RequireAuth } from '@/auth/guards'
import { FullPageSpinner } from '@/components/ui/Spinner'

/*
 * Routes owned by "web-business": the business dashboard (/business/*, code-split as one area with
 * per-page chunks), the public customer-facing pages (/b/*, /w/*, /tap/unavailable — no dashboard code)
 * and the invitation accept page. Mounted in App.tsx via {businessRoutes()}.
 */

const BusinessApp = lazy(() => import('@/business/BusinessApp'))
const InviteAcceptPage = lazy(() => import('@/business/pages/InviteAcceptPage'))
const PublicProfilePage = lazy(() => import('@/public/PublicProfilePage'))
const WifiPage = lazy(() => import('@/public/WifiPage'))
const TapUnavailablePage = lazy(() => import('@/public/TapUnavailablePage'))

const s = (el: ReactNode) => <Suspense fallback={<FullPageSpinner />}>{el}</Suspense>

export function businessRoutes() {
  return (
    <>
      <Route path="/business/*" element={s(<RequireAuth><BusinessApp /></RequireAuth>)} />
      <Route path="/invite/:token" element={s(<InviteAcceptPage />)} />
      <Route path="/b/:slug" element={s(<PublicProfilePage />)} />
      <Route path="/b/:slug/:profileSlug" element={s(<PublicProfilePage />)} />
      <Route path="/w/:code" element={s(<WifiPage />)} />
      <Route path="/tap/unavailable" element={s(<TapUnavailablePage />)} />
    </>
  )
}
