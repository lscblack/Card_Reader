import { useState } from 'react'
import { Send } from 'lucide-react'
import { useAdminDeliveries } from '@/hooks/useConsole'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { SkeletonRows } from '@/components/ui/Spinner'
import { DeliveriesTable } from '@/components/Webhooks'

const CODES = [
  'delivery_timeout',
  'delivery_connection_refused',
  'delivery_dns_failure',
  'delivery_tls_error',
  'delivery_http_4xx',
  'delivery_http_5xx',
  'delivery_redirect_blocked',
  'domain_not_allowed',
  'delivery_ssrf_blocked',
  'endpoint_disabled',
  'endpoint_not_configured',
  'delivery_response_too_large',
]

export default function AdminDeliveriesPage() {
  useDocumentTitle('Admin · Deliveries')
  const [success, setSuccess] = useState<'' | 'true' | 'false'>('')
  const [code, setCode] = useState('')
  const dcode = useDebounced(code.trim(), 300)
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useAdminDeliveries({
    success: success === '' ? undefined : success === 'true',
    error_code: dcode || undefined,
    page,
  })
  return (
    <>
      <PageHeader title="Deliveries" description="Webhook delivery attempts across all applications (relay and direct)." />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:px-5">
          <Select aria-label="Result" value={success} onChange={(e) => { setSuccess(e.target.value as typeof success); setPage(1) }} className="sm:w-40">
            <option value="">All results</option>
            <option value="true">Succeeded</option>
            <option value="false">Failed</option>
          </Select>
          <Input
            aria-label="Error code"
            list="delivery-error-codes"
            placeholder="Error code"
            value={code}
            onChange={(e) => { setCode(e.target.value); setPage(1) }}
            className="font-mono text-[12.5px] sm:w-72"
          />
          <datalist id="delivery-error-codes">
            {CODES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : !data?.items.length ? (
          <EmptyState icon={Send} title="No deliveries match" />
        ) : (
          <>
            <DeliveriesTable deliveries={data.items} />
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
