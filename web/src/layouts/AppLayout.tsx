import { DashboardShell } from './DashboardShell'
import { developerNav } from './nav'

/** Developer dashboard layout (/dashboard/*). */
export function AppLayout() {
  return <DashboardShell nav={developerNav} homeTo="/dashboard" settingsPath="/dashboard/settings" />
}
