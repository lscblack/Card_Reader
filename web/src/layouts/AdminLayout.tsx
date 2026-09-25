import { ArrowLeftRight } from 'lucide-react'
import { Link } from 'react-router'
import { DashboardShell } from './DashboardShell'
import { adminNav } from './nav'

/** Admin console layout (/admin/*). */
export function AdminLayout() {
  return (
    <DashboardShell
      nav={adminNav}
      label="Admin"
      homeTo="/admin"
      settingsPath="/dashboard/settings"
      sidebarFooter={
        <Link to="/dashboard" className="flex items-center gap-2 text-xs font-medium text-muted hover:text-fg">
          <ArrowLeftRight className="h-3.5 w-3.5" /> Developer dashboard
        </Link>
      }
    />
  )
}
