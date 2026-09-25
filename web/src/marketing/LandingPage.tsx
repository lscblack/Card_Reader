import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { MotionConfig } from 'motion/react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { scrollToId, type NavTarget, useReducedMotionPref } from './lib'
import type { Audience as PlanAudience } from './plans'
import { MarketingNav } from './components/MarketingNav'
import { Hero } from './components/Hero'
import { UseCases } from './components/UseCases'
import { HowItWorks } from './components/HowItWorks'
import { Audience, type AudienceTab } from './components/Audience'
import { PromoBanner } from './components/PromoBanner'

const BelowFold = lazy(() => import('./BelowFold'))
const LandingFooter = lazy(() => import('./components/Footer').then((m) => ({ default: m.Footer })))

export default function LandingPage() {
  useDocumentTitle('Turn any NFC phone into a card reader')
  const location = useLocation()
  // Every animated component already renders a static version when reduced motion is requested, so in that
  // case motion's own global reduction is unnecessary ("never" also avoids its dev-only console warning).
  const reduce = useReducedMotionPref()
  const [tab, setTab] = useState<AudienceTab>('businesses')
  const [planAudience, setPlanAudience] = useState<PlanAudience>('business')

  const navigate = useCallback((t: NavTarget | string) => {
    if (t === 'developers' || t === 'businesses') {
      setTab(t)
      setPlanAudience(t === 'developers' ? 'developer' : 'business')
      // Let the tab panel render before scrolling.
      requestAnimationFrame(() => scrollToId('audience'))
      history.replaceState(null, '', `#${t}`)
      return
    }
    scrollToId(t)
  }, [])

  // Honour deep links like /#pricing or /#developers (also when navigating from another page).
  useEffect(() => {
    const id = location.hash.slice(1)
    if (!id) return
    const t = window.setTimeout(() => navigate(id), 50)
    return () => window.clearTimeout(t)
  }, [location.hash, navigate])

  return (
    <MotionConfig reducedMotion={reduce ? 'never' : 'user'}>
      {/* Follows the shared theme (dark by default via branding / user choice; toggle in the nav). */}
      <div className="min-h-screen overflow-x-clip bg-bg font-sans text-fg antialiased">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-accent-solid px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <PromoBanner onSeePricing={() => navigate('pricing')} />
        <MarketingNav onNavigate={navigate} />
        <main id="main">
          <Hero />
          <UseCases />
          <HowItWorks />
          <Audience
            tab={tab}
            onTab={(t) => {
              setTab(t)
              setPlanAudience(t === 'developers' ? 'developer' : 'business')
            }}
          />
          <Suspense fallback={<div className="min-h-[100vh]" aria-hidden="true" />}>
            <BelowFold planAudience={planAudience} onPlanAudience={setPlanAudience} />
          </Suspense>
        </main>
        <Suspense fallback={null}>
          <LandingFooter />
        </Suspense>
      </div>
    </MotionConfig>
  )
}
