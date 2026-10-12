import { Link, Route, Routes } from 'react-router'
import DocsLayout from './DocsLayout'
import Introduction from './pages/Introduction'
import QuickstartDevelopers from './pages/QuickstartDevelopers'
import QuickstartBusinesses from './pages/QuickstartBusinesses'
import QuickstartPersonal from './pages/QuickstartPersonal'
import Concepts from './pages/Concepts'
import TapLifecycle from './pages/TapLifecycle'
import RunMode from './pages/RunMode'
import DigitalCards from './pages/DigitalCards'
import PersonalGuide from './pages/PersonalGuide'
import MobileApp from './pages/MobileApp'
import DeviceApi from './pages/DeviceApi'
import Webhooks from './pages/Webhooks'
import Polling from './pages/Polling'
import Sandbox from './pages/Sandbox'
import BusinessGuide from './pages/BusinessGuide'
import ApiReference from './pages/ApiReference'
import Errors from './pages/Errors'
import RateLimits from './pages/RateLimits'
import SecurityPage from './pages/Security'
import Changelog from './pages/Changelog'

function DocsNotFound() {
  return (
    <div className="py-20 text-center">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-fg">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-muted">It may have moved. Try the search (Ctrl/⌘ K) or start from the introduction.</p>
      <Link to="/docs" className="mt-6 inline-block rounded-lg bg-accent-solid px-4 py-2 font-semibold text-accent-fg hover:bg-accent-solid-hover">
        Docs home
      </Link>
    </div>
  )
}

/** Mounted at /docs/* (public, own layout). */
export default function DocsApp() {
  return (
    <Routes>
      <Route element={<DocsLayout />}>
        <Route index element={<Introduction />} />
        <Route path="quickstart-developers" element={<QuickstartDevelopers />} />
        <Route path="quickstart-businesses" element={<QuickstartBusinesses />} />
        <Route path="quickstart-personal" element={<QuickstartPersonal />} />
        <Route path="concepts" element={<Concepts />} />
        <Route path="tap-lifecycle" element={<TapLifecycle />} />
        <Route path="run-mode" element={<RunMode />} />
        <Route path="personal-guide" element={<PersonalGuide />} />
        <Route path="digital-cards" element={<DigitalCards />} />
        <Route path="mobile-app" element={<MobileApp />} />
        <Route path="device-api" element={<DeviceApi />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="polling" element={<Polling />} />
        <Route path="sandbox" element={<Sandbox />} />
        <Route path="business-guide" element={<BusinessGuide />} />
        <Route path="api-reference" element={<ApiReference />} />
        <Route path="errors" element={<Errors />} />
        <Route path="rate-limits" element={<RateLimits />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="changelog" element={<Changelog />} />
        <Route path="*" element={<DocsNotFound />} />
      </Route>
    </Routes>
  )
}
