import { Navigate } from 'react-router'
import { useAuth } from '@/auth/context'
import { DashboardShell } from './DashboardShell'
import { developerNav } from './nav'

/** Developer dashboard layout (/dashboard/*). Personal accounts have their own area (/me). */
export function AppLayout() {
  const { user } = useAuth()
  if (user?.account_type === 'personal' && user.role !== 'admin') return <Navigate to="/me" replace />
  return <DashboardShell nav={developerNav} homeTo="/dashboard" settingsPath="/dashboard/settings" />
}
