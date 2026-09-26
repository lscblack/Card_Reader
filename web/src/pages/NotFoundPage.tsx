import { Link, useLocation } from 'react-router'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/auth/context'
import { homePathFor } from '@/api/auth'

export default function NotFoundPage() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  // Inside a dashboard area → that area's overview; elsewhere → the account's home (or the landing page when signed out).
  const area = /^\/(dashboard|admin|me)(\/|$)/.exec(pathname)?.[1]
  const home = area ? `/${area}` : user ? homePathFor(user) : '/'
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or was moved."
        action={
          <Link to={home} className="text-[13px] font-medium text-accent hover:underline">
            {area || user ? 'Back to overview' : 'Back to home'}
          </Link>
        }
      />
    </Card>
  )
}
