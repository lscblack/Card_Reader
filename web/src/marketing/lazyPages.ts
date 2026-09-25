import { lazy } from 'react'

/** Lazy chunks for the public marketing surface (kept apart from routes.tsx for fast refresh). */
export const LandingPage = lazy(() => import('./LandingPage'))
export const DocsApp = lazy(() => import('@/docs/DocsApp'))
