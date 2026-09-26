import { RequireArea } from '@/auth/guards'
import { DashboardShell } from './DashboardShell'
import { developerNav } from './nav'

/** Developer dashboard layout (/dashboard/*). Other account types are sent to their own area. */
export function AppLayout() {
  return (
    <RequireArea area="dashboard">
      <DashboardShell nav={developerNav} homeTo="/dashboard" settingsPath="/dashboard/settings" />
    </RequireArea>
  )
}
