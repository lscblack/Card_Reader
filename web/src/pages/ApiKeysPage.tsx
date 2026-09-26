import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Plus, ShieldAlert } from 'lucide-react'
import { useApiKeys, useApplications } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Select } from '@/components/ui/Input'
import { AppSelect } from '@/components/AppSelect'
import { ApiKeysTable, CreateApiKeyModal } from '@/components/ApiKeys'

export default function ApiKeysPage() {
  useDocumentTitle('API Keys')
  const [params, setParams] = useSearchParams()
  const appId = params.get('app') ?? ''
  const [status, setStatus] = useState<'all' | 'active' | 'revoked'>('active')
  const { data, isLoading, error, refetch } = useApiKeys(appId || undefined)
  const apps = useApplications()
  const [creating, setCreating] = useState(false)

  const keys = (data ?? []).filter((k) => (status === 'all' ? true : status === 'active' ? k.is_active : !k.is_active))

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Keys let the nexTap app register a phone for an application. The full key is shown only once, at creation."
        actions={
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} disabled={!apps.data?.length}>
            New API key
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <AppSelect allowAll value={appId} onChange={(v) => setParams(v ? { app: v } : {}, { replace: true })} />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="sm:w-36">
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
            <option value="all">All statuses</option>
          </Select>
          <p className="flex items-center gap-1.5 text-xs text-subtle sm:ml-auto">
            <ShieldAlert className="h-3.5 w-3.5" /> Only the prefix and last 4 characters are stored for display.
          </p>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : (
          <ApiKeysTable keys={keys} onCreate={apps.data?.length ? () => setCreating(true) : undefined} />
        )}
      </Card>
      <CreateApiKeyModal key={appId} open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
