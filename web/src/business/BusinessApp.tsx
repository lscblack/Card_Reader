import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import { Spinner } from "@/components/ui/Spinner";
import { RequireArea } from "@/auth/guards";
import { BusinessLayout } from "./layout/BusinessLayout";
import { BusinessIndex } from "./layout/BusinessIndex";

const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const CardsPage = lazy(() => import("./pages/CardsPage"));
const CardDetailPage = lazy(() => import("./pages/CardDetailPage"));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage"));
const EmployeeDetailPage = lazy(() => import("./pages/EmployeeDetailPage"));
const CustomersPage = lazy(() => import("./pages/CustomersPage"));
const CustomerDetailPage = lazy(() => import("./pages/CustomerDetailPage"));
const DevicesPage = lazy(() => import("./pages/DevicesPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const ProfilesPage = lazy(() => import("./pages/ProfilesPage"));
const ProfileEditorPage = lazy(() => import("./pages/ProfileEditorPage"));
const FormResponsesPage = lazy(() => import("./pages/FormResponsesPage"));
const ActionsPage = lazy(() => import("./pages/ActionsPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage"));
const IntegrationAppPage = lazy(() => import("./pages/IntegrationAppPage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const BillingPage = lazy(() => import("./pages/BillingPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

function PageFallback() {
  return (
    <div
      className="flex justify-center py-24 text-subtle"
      role="status"
      aria-label="Loading"
    >
      <Spinner />
    </div>
  );
}

const page = (el: ReactNode) => (
  <Suspense fallback={<PageFallback />}>{el}</Suspense>
);

/** The business dashboard area, mounted at /business/*. Active business lives in the URL. */
export default function BusinessApp() {
  return (
    <RequireArea area="business">
      <Routes>
        <Route index element={<BusinessIndex />} />
        <Route path=":businessId" element={<BusinessLayout />}>
          <Route index element={page(<OverviewPage />)} />
          <Route path="cards" element={page(<CardsPage kind="card" />)} />
          <Route path="cards/:cardId" element={page(<CardDetailPage />)} />
          <Route path="tags" element={page(<CardsPage kind="tag" />)} />
          <Route path="tags/:cardId" element={page(<CardDetailPage />)} />
          <Route path="employees" element={page(<EmployeesPage />)} />
          <Route
            path="employees/:employeeId"
            element={page(<EmployeeDetailPage />)}
          />
          <Route path="customers" element={page(<CustomersPage />)} />
          <Route
            path="customers/:customerId"
            element={page(<CustomerDetailPage />)}
          />
          <Route path="devices" element={page(<DevicesPage />)} />
          <Route path="events" element={page(<EventsPage />)} />
          <Route path="profiles" element={page(<ProfilesPage />)} />
          <Route
            path="profiles/:profileId"
            element={page(<ProfileEditorPage />)}
          />
          <Route path="pages" element={<Navigate to="../profiles" replace />} />
          <Route path="pages/:profileId" element={<PagesRedirect />} />
          <Route path="pages/:profileId/responses" element={<ResponsesRedirect />} />
          <Route path="responses" element={page(<FormResponsesPage />)} />
          <Route path="actions" element={page(<ActionsPage />)} />
          <Route path="analytics" element={page(<AnalyticsPage />)} />
          <Route path="integrations" element={page(<IntegrationsPage />)} />
          <Route
            path="integrations/:appId"
            element={page(<IntegrationAppPage />)}
          />
          <Route path="team" element={page(<TeamPage />)} />
          <Route path="billing" element={page(<BillingPage />)} />
          <Route path="settings" element={page(<SettingsPage />)} />
          <Route path="notifications" element={page(<NotificationsPage />)} />
          <Route path="*" element={page(<NotFound />)} />
        </Route>
      </Routes>
    </RequireArea>
  );
}

/** Part 6: "Pages" is the UI name; the routes keep /profiles. */
/** Older "new form response" notifications linked to /pages/:id/responses. */
function ResponsesRedirect() {
  const { profileId } = useParams();
  return <Navigate to={`../responses${profileId ? `?profile_id=${profileId}` : ""}`} replace />;
}

function PagesRedirect() {
  const { profileId } = useParams();
  return <Navigate to={`../profiles/${profileId ?? ""}`} replace />;
}
