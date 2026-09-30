/* eslint-disable react-refresh/only-export-components -- route table module, not hot-reloaded as a component */
import { lazy, Suspense, type ReactNode } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Navigate, Route } from 'react-router'
import { GuestOnly, LegacyRedirect, RequireAdmin, RequireAuth } from '@/auth/guards'
import { AppLayout } from '@/layouts/AppLayout'
import { AdminLayout } from '@/layouts/AdminLayout'
import { Spinner } from '@/components/ui/Spinner'

/*
 * Routes owned by "web-core": auth pages, the developer dashboard (/dashboard/*), the admin console
 * (/admin/*) and redirects from the old top-level dashboard paths. Mounted in App.tsx via {coreRoutes()}.
 */

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'))
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage'))
const OverviewPage = lazy(() => import('@/pages/OverviewPage'))
const ApplicationsPage = lazy(() => import('@/pages/ApplicationsPage'))
const ApplicationDetailPage = lazy(() => import('@/pages/ApplicationDetailPage'))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeysPage'))
const DevicesPage = lazy(() => import('@/pages/DevicesPage'))
const EventsPage = lazy(() => import('@/pages/EventsPage'))
const EndpointsPage = lazy(() => import('@/pages/EndpointsPage'))
const WebhooksPage = lazy(() => import('@/pages/WebhooksPage'))
const SandboxPage = lazy(() => import('@/pages/SandboxPage'))
const RequestLogsPage = lazy(() => import('@/pages/RequestLogsPage'))
const UsagePage = lazy(() => import('@/pages/UsagePage'))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const SupportPage = lazy(() => import('@/pages/SupportPage'))
const AdminSupportPage = lazy(() => import('@/pages/admin/AdminSupportPage'))
const AdminPaymentsPage = lazy(() => import('@/pages/admin/AdminPaymentsPage'))
const CheckoutPage = lazy(() => import('@/pages/checkout/CheckoutPage'))
const CheckoutCompletePage = lazy(() => import('@/pages/checkout/CheckoutCompletePage'))
const AdminOverviewPage = lazy(() => import('@/pages/admin/AdminOverviewPage'))
const AdminAccountsPage = lazy(() => import('@/pages/admin/AdminAccountsPage'))
const AdminDemographicsPage = lazy(() => import('@/pages/admin/AdminDemographicsPage'))
const AdminAccountDetailPage = lazy(() => import('@/pages/admin/AdminAccountDetailPage'))
const AdminBusinessesPage = lazy(() => import('@/pages/admin/AdminBusinessesPage'))
const AdminDevicesPage = lazy(() => import('@/pages/admin/AdminDevicesPage'))
const AdminRequestLogsPage = lazy(() => import('@/pages/admin/AdminRequestLogsPage'))
const AdminDeliveriesPage = lazy(() => import('@/pages/admin/AdminDeliveriesPage'))
const AdminSystemPage = lazy(() => import('@/pages/admin/AdminSystemPage'))
const AdminSettingsPage = lazy(() => import('@/pages/admin/AdminSettingsPage'))
const AdminOriginsPage = lazy(() => import('@/pages/admin/AdminOriginsPage'))
const AdminBrandingPage = lazy(() => import('@/pages/admin/AdminBrandingPage'))
const AdminPlansPage = lazy(() => import('@/pages/admin/AdminPlansPage'))
const AdminPromotionsPage = lazy(() => import('@/pages/admin/AdminPromotionsPage'))
const AdminErrorsPage = lazy(() => import('@/pages/admin/AdminErrorsPage'))
const AdminErrorDetailPage = lazy(() => import('@/pages/admin/AdminErrorDetailPage'))
const AdminEmailsPage = lazy(() => import('@/pages/admin/AdminEmailsPage'))
const AdminReleasesPage = lazy(() => import('@/pages/admin/AdminReleasesPage'))

function PageFallback() {
  return (
    <div className="flex justify-center py-24 text-subtle" role="status" aria-label="Loading">
      <Spinner />
    </div>
  )
}

const page = (el: ReactNode) => (
  <ErrorBoundary>
    <Suspense fallback={<PageFallback />}>{el}</Suspense>
  </ErrorBoundary>
)

const LEGACY = ['applications', 'api-keys', 'devices', 'events', 'endpoints', 'webhooks', 'usage', 'settings']

export function coreRoutes() {
  return (
    <>
      <Route path="/login" element={page(<GuestOnly><LoginPage /></GuestOnly>)} />
      <Route path="/register" element={page(<GuestOnly><RegisterPage /></GuestOnly>)} />
      <Route path="/forgot-password" element={page(<GuestOnly><ForgotPasswordPage /></GuestOnly>)} />
      <Route path="/reset-password" element={page(<ResetPasswordPage />)} />
      <Route path="/verify-email" element={page(<VerifyEmailPage />)} />
      <Route path="/support" element={page(<SupportPage />)} />
      <Route path="/checkout" element={page(<RequireAuth><CheckoutPage /></RequireAuth>)} />
      <Route path="/checkout/complete" element={page(<RequireAuth><CheckoutCompletePage /></RequireAuth>)} />

      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={page(<OverviewPage />)} />
        <Route path="applications" element={page(<ApplicationsPage />)} />
        <Route path="applications/:id" element={page(<ApplicationDetailPage />)} />
        <Route path="api-keys" element={page(<ApiKeysPage />)} />
        <Route path="devices" element={page(<DevicesPage />)} />
        <Route path="events" element={page(<EventsPage />)} />
        <Route path="endpoints" element={page(<EndpointsPage />)} />
        <Route path="webhooks" element={page(<WebhooksPage />)} />
        <Route path="sandbox" element={page(<SandboxPage />)} />
        <Route path="logs" element={page(<RequestLogsPage />)} />
        <Route path="usage" element={page(<UsagePage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="notifications" element={page(<NotificationsPage />)} />
        <Route path="*" element={page(<NotFoundPage />)} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          </RequireAuth>
        }
      >
        <Route index element={page(<AdminOverviewPage />)} />
        <Route path="notifications" element={page(<NotificationsPage />)} />
        <Route path="accounts" element={page(<AdminAccountsPage />)} />
        <Route path="accounts/:id" element={page(<AdminAccountDetailPage />)} />
        <Route path="demographics" element={page(<AdminDemographicsPage />)} />
        <Route path="businesses" element={page(<AdminBusinessesPage />)} />
        <Route path="devices" element={page(<AdminDevicesPage />)} />
        <Route path="logs" element={page(<AdminRequestLogsPage />)} />
        <Route path="deliveries" element={page(<AdminDeliveriesPage />)} />
        <Route path="system" element={page(<AdminSystemPage />)} />
        <Route path="settings" element={page(<AdminSettingsPage />)} />
        <Route path="origins" element={page(<AdminOriginsPage />)} />
        <Route path="branding" element={page(<AdminBrandingPage />)} />
        <Route path="plans" element={page(<AdminPlansPage />)} />
        <Route path="promotions" element={page(<AdminPromotionsPage />)} />
        <Route path="payments" element={page(<AdminPaymentsPage />)} />
        <Route path="support" element={page(<AdminSupportPage />)} />
        <Route path="errors" element={page(<AdminErrorsPage />)} />
        <Route path="errors/:ref" element={page(<AdminErrorDetailPage />)} />
        <Route path="emails" element={page(<AdminEmailsPage />)} />
        <Route path="releases" element={page(<AdminReleasesPage />)} />
        {/* Build notifications link to /admin/app-releases/{id}; the releases page lists them all. */}
        <Route path="app-releases/*" element={<Navigate to="/admin/releases" replace />} />
        <Route path="*" element={page(<NotFoundPage />)} />
      </Route>

      {/* Old top-level dashboard paths → /dashboard/* */}
      {LEGACY.map((p) => (
        <Route key={p} path={`/${p}`} element={<LegacyRedirect to={`/dashboard/${p}`} />} />
      ))}
      <Route path="/applications/:id" element={<LegacyRedirect to="/dashboard/applications/:id" />} />
    </>
  )
}
