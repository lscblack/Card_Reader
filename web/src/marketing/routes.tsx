import { Suspense, type ReactNode } from 'react'
import { Route } from 'react-router'
import { DocsApp, LandingPage } from './lazyPages'

/*
 * Routes owned by "web-marketing": the public landing page at "/" and the public docs at /docs/*.
 * Both are lazy-loaded chunks with their own layouts. Mounted in App.tsx via {marketingRoutes()}.
 */

const blank = (dark: boolean) => (
  <div className={dark ? 'dark min-h-screen bg-bg' : 'min-h-screen bg-bg'} role="status" aria-label="Loading" />
)
const s = (el: ReactNode, dark = false) => <Suspense fallback={blank(dark)}>{el}</Suspense>

export function marketingRoutes() {
  return (
    <>
      <Route path="/" element={s(<LandingPage />, true)} />
      <Route path="/docs/*" element={s(<DocsApp />)} />
    </>
  )
}
