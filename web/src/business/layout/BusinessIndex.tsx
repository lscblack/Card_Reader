import { Link, Navigate } from 'react-router'
import { Building2, Code2 } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { Logo } from '@/components/Logo'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useBusinesses } from '../hooks/queries'
import { getLastBusiness } from '../lib/lastBusiness'
import { BizErrorState } from '../components/BizError'

/** `/business` → the last used (or first) business the user belongs to. */
export function BusinessIndex() {
  useDocumentTitle('Business')
  const { user, logout } = useAuth()
  const { data, error, isLoading, refetch } = useBusinesses()
  if (isLoading) return <FullPageSpinner />
  if (data?.length) {
    const last = getLastBusiness()
    const target = data.find((b) => b.id === last) ?? data[0]
    return <Navigate to={`/business/${target.id}`} replace />
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Logo className="mb-8" />
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-sm">
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : (
          <EmptyState
            icon={Building2}
            title="No business workspace yet"
            description={`${user?.email ?? 'Your account'} isn’t a member of any business. Ask a business owner to invite you, or create a business account.`}
            action={
              <div className="flex flex-col items-center gap-2">
                <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
                  <Code2 className="h-4 w-4" /> Go to the developer dashboard
                </Link>
                <Button variant="ghost" size="sm" onClick={logout}>
                  Log out
                </Button>
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}
