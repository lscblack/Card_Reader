import { Link } from 'react-router'
import { AppWindow } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useSelectedApp } from '@/hooks/useSelectedApp'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { AppSelect } from '@/components/AppSelect'
import { EndpointForm } from '@/components/EndpointForm'
import { AllowedDomainsCard } from '@/components/AllowedDomains'

export default function EndpointsPage() {
  useDocumentTitle('Endpoint Configuration')
  const { apps, app, select } = useSelectedApp()

  return (
    <>
      <PageHeader
        title="Endpoint Configuration"
        description="Choose where card events are delivered, how, and send a signed test event to check your integration."
        actions={app && <AppSelect value={app.id} onChange={select} />}
      />
      {apps.error ? (
        <Card>
          <ErrorState error={apps.error} onRetry={() => apps.refetch()} />
        </Card>
      ) : apps.isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : !app ? (
        <Card>
          <EmptyState
            icon={AppWindow}
            title="No applications"
            description="Create an application first — endpoints are configured per application."
            action={
              <Link to="/dashboard/applications" className="text-[13px] font-medium text-accent hover:underline">
                Go to Applications
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <EndpointForm key={app.id} app={app} />
          <AllowedDomainsCard key={`ad-${app.id}`} app={app} />
        </div>
      )}
    </>
  )
}
