import { useState } from 'react'
import { Link } from 'react-router'
import { AppWindow, Webhook } from 'lucide-react'
import { useDeliveries } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useSelectedApp } from '@/hooks/useSelectedApp'
import { verifySamples } from '@/lib/snippets'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { Select } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { CodeTabs } from '@/components/ui/CodeBlock'
import { AppSelect } from '@/components/AppSelect'
import { DeliveriesTable, WebhookSecretPanel } from '@/components/Webhooks'

const PAGE_SIZE = 20

function DeliveryLog({ appId }: { appId: string }) {
  const [success, setSuccess] = useState<'' | 'true' | 'false'>('')
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useDeliveries({
    application_id: appId,
    success: success === '' ? undefined : success === 'true',
    page,
    page_size: PAGE_SIZE,
  })
  return (
    <Card>
      <CardHeader
        title="Delivery log"
        description="Every attempt to POST an event (or test) to your endpoint."
        actions={
          <Select
            aria-label="Result"
            value={success}
            onChange={(e) => {
              setSuccess(e.target.value as typeof success)
              setPage(1)
            }}
            className="w-40"
          >
            <option value="">All results</option>
            <option value="true">Successful</option>
            <option value="false">Failed</option>
          </Select>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={5} cols={5} />
      ) : !data?.items.length ? (
        <EmptyState icon={Webhook} title="No deliveries" description="Deliveries appear here after a card tap or a test event." />
      ) : (
        <>
          <DeliveriesTable deliveries={data.items} />
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  )
}

export default function WebhooksPage() {
  useDocumentTitle('Webhooks')
  const { apps, app, select } = useSelectedApp()

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Signing secrets, delivery history and how to verify that requests really come from us."
        actions={app && <AppSelect value={app.id} onChange={select} />}
      />
      {apps.error ? (
        <Card>
          <ErrorState error={apps.error} onRetry={() => apps.refetch()} />
        </Card>
      ) : apps.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !app ? (
        <Card>
          <EmptyState
            icon={AppWindow}
            title="No applications"
            description="Create an application to get a webhook signing secret."
            action={
              <Link to="/dashboard/applications" className="text-[13px] font-medium text-accent hover:underline">
                Go to Applications
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <WebhookSecretPanel app={app} />
          <DeliveryLog key={app.id} appId={app.id} />
          <Card>
            <CardHeader title="Verifying signatures" description="Reject any request whose signature doesn't match." />
            <CardBody className="space-y-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted">
                <li>
                  Read the <strong className="text-fg">raw</strong> request body (bytes, before JSON parsing).
                </li>
                <li>
                  Reject if <code className="rounded bg-surface-2 px-1">X-NFC-Timestamp</code> is more than 5 minutes old.
                </li>
                <li>
                  Compute <code className="rounded bg-surface-2 px-1">HMAC_SHA256(secret, "&#123;timestamp&#125;.&#123;nonce&#125;.&#123;raw_body&#125;")</code> as
                  lowercase hex and compare it, in constant time, with the value after <code className="rounded bg-surface-2 px-1">v1=</code> in{' '}
                  <code className="rounded bg-surface-2 px-1">X-NFC-Signature</code>.
                </li>
                <li>
                  In <strong className="text-fg">direct</strong> mode the secret is the per-device key{' '}
                  <code className="rounded bg-surface-2 px-1">hex(HMAC_SHA256(webhook_secret, "device:" + X-NFC-Device-Id))</code>.
                </li>
                <li>
                  HMAC keys are the secret <strong className="text-fg">strings as UTF-8</strong>: the full <code className="rounded bg-surface-2 px-1">whsec_…</code>{' '}
                  value including the prefix (relay), or the 64-char lowercase hex device key string itself, not hex-decoded (direct). Device IDs
                  are lowercase hyphenated UUIDs; test deliveries use <code className="rounded bg-surface-2 px-1">00000000-0000-0000-0000-000000000000</code>.
                </li>
                <li>
                  Reject reused <code className="rounded bg-surface-2 px-1">X-NFC-Nonce</code> values and dedupe on{' '}
                  <code className="rounded bg-surface-2 px-1">X-NFC-Event-Id</code> (retries reuse it).
                </li>
              </ol>
              <CodeTabs samples={verifySamples} />
              <p className="text-xs text-subtle">
                More languages (PHP) and the full payload reference are in the{' '}
                <Link to="/docs#signatures" className="text-accent hover:underline">
                  API documentation
                </Link>
                .
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  )
}
