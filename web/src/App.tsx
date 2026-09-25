import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { coreRoutes } from '@/routes/coreRoutes'
import { businessRoutes } from '@/business/routes'
import { marketingRoutes } from '@/marketing/routes'

const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

/*
 * Route table. Each area keeps its routes in its own module and mounts them here:
 *   - web-core:      src/routes/coreRoutes.tsx (auth, /dashboard/*, /admin/*, legacy redirects)
 *   - web-business:  /business/*, public profile pages, /invite/*
 *   - web-marketing: "/" landing and /docs/*
 */
export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {coreRoutes()}
        {businessRoutes()}
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
  )
}
