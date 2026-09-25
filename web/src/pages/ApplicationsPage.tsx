import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AppWindow, Globe, Plus, Smartphone } from 'lucide-react'
import { useApplications } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { dateOnly } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ActiveBadge, Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { CreateApplicationModal } from '@/components/CreateApplicationModal'

export default function ApplicationsPage() {
  useDocumentTitle('Applications')
  const { data, isLoading, error, refetch } = useApplications()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  return (
    <>
      <PageHeader
        title="Applications"
        description="Each application has its own API keys, devices, endpoint and signing secret."
        actions={
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New application
          </Button>
        }
      />

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3.5 w-1/3" />
            </Card>
          ))}
        </div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={AppWindow}
            title="No applications yet"
            description="Create your first application to get an API key and start registering NFC readers."
            action={
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Create application
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((a) => (
            <Card
              key={a.id}
              className="group flex cursor-pointer flex-col p-5 transition-shadow hover:border-border-strong hover:shadow-md"
              onClick={() => navigate(`/dashboard/applications/${a.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/dashboard/applications/${a.id}`}
                    className="block truncate text-[15px] font-semibold tracking-tight group-hover:text-accent"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {a.name}
                  </Link>
                  <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{a.description || 'No description'}</p>
                </div>
                <ActiveBadge active={a.is_active} />
              </div>
              <div className="mt-4 space-y-2 text-[13px]">
                <div className="flex items-center gap-2 text-muted">
                  <Globe className="h-3.5 w-3.5 shrink-0 text-subtle" />
                  {a.endpoint.url ? (
                    <span className="truncate font-mono text-[12px]">{a.endpoint.url}</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">No endpoint configured</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <Smartphone className="h-3.5 w-3.5 text-subtle" />
                  {a.device_count} device{a.device_count === 1 ? '' : 's'}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Badge tone={a.delivery_mode === 'relay' ? 'accent' : 'info'}>{a.delivery_mode}</Badge>
                {a.endpoint.url && !a.endpoint.enabled && <Badge tone="warning">Delivery paused</Badge>}
                <span className="ml-auto text-xs text-subtle">Created {dateOnly(a.created_at)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
      <CreateApplicationModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
