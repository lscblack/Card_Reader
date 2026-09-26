import { Link, useSearchParams } from 'react-router'
import { Smartphone } from 'lucide-react'
import type { DeviceStatus } from '@/api/types'
import { useDevices } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Select } from '@/components/ui/Input'
import { AppSelect } from '@/components/AppSelect'
import { DevicesTable } from '@/components/Devices'
import { ServerUrlCard } from '@/components/ServerUrlCard'
import { DownloadAppCard } from '@/components/DownloadApp'
import { PairPhoneButton } from '@/components/PairPhoneModal'
import { useApplications } from '@/hooks/queries'

export default function DevicesPage() {
  useDocumentTitle('Devices')
  const apps = useApplications()
  const [params, setParams] = useSearchParams()
  const appId = params.get('app') ?? ''
  const status = (params.get('status') ?? '') as DeviceStatus | ''
  const { data, isLoading, error, refetch } = useDevices({ application_id: appId || undefined, status: status || undefined })

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Devices"
        description="Android phones registered as NFC card readers. Revoking a device invalidates its token immediately."
        actions={<PairPhoneButton key={appId} applicationId={appId || undefined} disabled={!apps.data?.length} />}
      />
      <ServerUrlCard />
      <DownloadAppCard className="mt-4" />
      <Card className="mt-4">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:px-5">
          <AppSelect allowAll value={appId} onChange={(v) => set('app', v)} />
          <Select aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)} className="sm:w-36">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : !data?.length ? (
          <EmptyState
            icon={Smartphone}
            title={appId || status ? 'No devices match these filters' : 'No devices registered'}
            description="Install the nexTap app on an NFC-capable Android phone, then register it with an API key."
            action={
              <Link to="/docs#quick-start" className="text-[13px] font-medium text-accent hover:underline">
                How to register a device
              </Link>
            }
          />
        ) : (
          <DevicesTable devices={data} />
        )}
      </Card>
    </>
  )
}
