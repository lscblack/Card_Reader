import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes } from "react-router";
import { Spinner } from "@/components/ui/Spinner";
import { RequireArea } from "@/auth/guards";
import { PersonalLayout } from "./layout/PersonalLayout";

const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const CardsPage = lazy(() => import("./pages/CardsPage"));
const CardEditorPage = lazy(() => import("./pages/CardEditorPage"));
const ContactsPage = lazy(() => import("./pages/ContactsPage"));
const PhysicalCardsPage = lazy(() => import("./pages/PhysicalCardsPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const SharePage = lazy(() => import("./pages/SharePage"));
const InvitesPage = lazy(() => import("./pages/InvitesPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

const page = (el: ReactNode) => (
  <Suspense
    fallback={
      <div
        className="flex justify-center py-24 text-subtle"
        role="status"
        aria-label="Loading"
      >
        <Spinner />
      </div>
    }
  >
    {el}
  </Suspense>
);

/** Personal dashboard (`/me/*`). */
export default function PersonalApp() {
  return (
    <Routes>
      <Route
        element={
          <RequireArea area="me">
            <PersonalLayout />
          </RequireArea>
        }
      >
        <Route index element={page(<OverviewPage />)} />
        <Route path="cards" element={page(<CardsPage />)} />
        <Route path="cards/:cardId" element={page(<CardEditorPage />)} />
        <Route path="physical-cards" element={page(<PhysicalCardsPage />)} />
        <Route path="contacts" element={page(<ContactsPage />)} />
        <Route path="contacts/:contactId" element={page(<ContactsPage />)} />
        <Route path="activity" element={page(<ActivityPage />)} />
        <Route path="share" element={page(<SharePage />)} />
        <Route path="invites" element={page(<InvitesPage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="notifications" element={page(<NotificationsPage />)} />
        <Route path="*" element={page(<NotFoundPage />)} />
      </Route>
    </Routes>
  );
}
