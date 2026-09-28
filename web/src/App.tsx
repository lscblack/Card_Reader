import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { coreRoutes } from '@/routes/coreRoutes'
import { businessRoutes } from '@/business/routes'
import { personalRoutes } from '@/personal/routes'
import { marketingRoutes } from '@/marketing/routes'

const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

/*
 * Route table. Each area keeps its routes in its own module and mounts them here:
 *   - web-core:      src/routes/coreRoutes.tsx (auth, /dashboard/*, /admin/*, legacy redirects)
 *   - web-business:  /business/*, public profile pages, /invite/*
 *   - web-marketing: "/" landing and /docs/*
 */
export default function App() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          {coreRoutes()}
          {businessRoutes()}
          {personalRoutes()}
          {marketingRoutes()}
          <Route
            path="*"
            element={
              <div className="mx-auto w-11/12 max-w-lg py-24">
                <NotFoundPage />
              </div>
            }
          />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
