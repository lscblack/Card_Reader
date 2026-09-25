/* eslint-disable react-refresh/only-export-components -- route table module, not hot-reloaded as a component */
import { lazy, Suspense, type ReactNode } from 'react'
import { Route } from 'react-router'
import { RequireAuth } from '@/auth/guards'
import { FullPageSpinner } from '@/components/ui/Spinner'

/*
 * Routes owned by "web-business" for Part 4: the personal dashboard (/me/*) and the public digital-card page
 * (/p/:slug — its own light chunk, no dashboard code). Mounted in App.tsx via {personalRoutes()}.
 */
const PersonalApp = lazy(() => import('@/personal/PersonalApp'))
const PublicCardPage = lazy(() => import('@/public/PublicCardPage'))

const s = (el: ReactNode) => <Suspense fallback={<FullPageSpinner />}>{el}</Suspense>

export function personalRoutes() {
  return (
    <>
      <Route path="/me/*" element={s(<RequireAuth><PersonalApp /></RequireAuth>)} />
      <Route path="/p/:slug" element={s(<PublicCardPage />)} />
    </>
  )
}
