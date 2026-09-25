import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AlertTriangle, AppWindow, ArrowRight, FlaskConical, Plus, Server, Smartphone } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ActiveBadge, Badge } from '@/components/ui/Badge'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { num, percent } from '@/lib/format'
import type { ApiUsageRange } from '../api/types'
import { useQueries } from '@tanstack/react-query'
import { apiKeysApi } from '@/api/apiKeys'
import { cn } from '@/lib/cn'
import { CHART } from '../lib/chart'
import { useBusiness, useCan } from '../hooks/context'
import { useApiUsage, useBizApps, useBizDevices } from '../hooks/queries'
import { KpiCard } from '../components/bits'
import { BizErrorState, NoAccess } from '../components/BizError'
import { BarList } from '../components/charts'
import { CreateBizAppModal } from '../components/CreateBizAppModal'
import { SecretsModal } from '@/components/SecretsModal'
import type { CreateApplicationResponse } from '@/api/types'

const USAGE_RANGES: { value: ApiUsageRange; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

function ApiUsageCard() {
  const { business } = useBusiness()
  const [range, setRange] = useState<ApiUsageRange>('7d')
  const { data, error, isLoading, refetch } = useApiUsage(business.id, range)
  const devices = useBizDevices(business.id)
  const apps = useBizApps(business.id)
  // Business keys aren't in the developer `/api-keys` listing — fetch per business application.
  const keyLists = useQueries({ queries: (apps.data ?? []).map((a) => ({ queryKey: ['api-keys', a.id], queryFn: () => apiKeysApi.list(a.id) })) })
  const keys = { data: keyLists.flatMap((q) => q.data ?? []) }
  const deviceName = (id: string | null, name: string | null) => name ?? devices.data?.find((d) => d.id === id)?.name ?? (id ? `Device ${id.slice(0, 8)}` : 'Unknown device')
  const keyName = (id: string | null, name?: string | null) => {
    const k = keys.data?.find((x) => x.id === id)
    return name ?? (k ? `${k.application_name} · ${k.name}` : id ? `Key ${id.slice(0, 8)}` : 'Unknown key')
  }
  return (
    <Card>
      <CardHeader
        title="API usage"
        description="Requests from your devices, API keys and public taps (from request logs)."
        actions={
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="Usage range">
            {USAGE_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={range === r.value}
                onClick={() => setRange(r.value)}
                className={cn('h-7 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap', range === r.value ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg')}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      <CardBody className="space-y-6">
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <KpiCard label="Requests" value={data.totals.requests} />
              <KpiCard label="Errors" value={data.totals.errors} />
              <KpiCard label="Error rate" value={percent(data.totals.error_rate)} className="col-span-2 sm:col-span-1" />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-[13px] font-medium">By device</p>
                <BarList items={data.by_device.map((d, i) => ({ key: d.device_id ?? `d${i}`, label: deviceName(d.device_id, d.name), value: d.count }))} empty="No device requests in this period." />
              </div>
              <div>
                <p className="mb-2 text-[13px] font-medium">By API key</p>
                <BarList items={data.by_api_key.map((k, i) => ({ key: k.api_key_id ?? `k${i}`, label: keyName(k.api_key_id, k.name), value: k.count }))} color={CHART.secondary} empty="No API-key requests in this period." />
              </div>
            </div>
            <div>
              <p className="mb-2 text-[13px] font-medium">Top routes</p>
              {data.by_route.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-subtle">No requests in this period.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <TableWrap>
                    <Table className="min-w-[520px]">
                      <THead>
                        <tr>
                          <TH>Route</TH>
                          <TH className="text-right">Requests</TH>
                          <TH className="text-right">Error rate</TH>
                          <TH className="text-right">p95</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {data.by_route.map((r) => (
                          <TR key={r.route}>
                            <TD className="font-mono text-[12px]">{r.route}</TD>
                            <TD className="text-right tabular-nums">{num(r.count)}</TD>
                            <TD className="text-right tabular-nums">
                              <span className={r.error_rate && r.error_rate > 0.02 ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}>{percent(r.error_rate)}</span>
                            </TD>
                            <TD className="text-right text-muted tabular-nums">{r.p95_ms != null ? `${num(r.p95_ms)} ms` : '—'}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>
                </div>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

export default function IntegrationsPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const navigate = useNavigate()
  useDocumentTitle('API / Integrations')
  const allowed = can('api.view')
  const { data, error, isLoading, refetch } = useBizApps(business.id, allowed)
  const sandboxUrl = `/dashboard/sandbox?business_id=${business.id}`
  const [creating, setCreating] = useState(false)
  const [secrets, setSecrets] = useState<CreateApplicationResponse | null>(null)

  if (!allowed) {
    return (
      <>
        <PageHeader title="API / Integrations" />
        <Card>
          <NoAccess permission="api.view" what="API & integrations" />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="API / Integrations"
        description="Connect taps and reader events to your own systems. Webhooks are HMAC-signed, retried and logged."
        actions={
          <>
            {can('api.manage') && (
              <Link to={sandboxUrl}>
                <Button leftIcon={<FlaskConical className="h-4 w-4" />}>Sandbox</Button>
              </Link>
            )}
            {can('api.manage') && (
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New application
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Applications" description="Business Terminal is created with the workspace and used by your readers. Add more applications to send taps to other systems." />
          {error ? (
            <BizErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <SkeletonRows rows={2} cols={4} />
          ) : !data?.length ? (
            <EmptyState icon={AppWindow} title="No applications" description="Create an application to receive signed webhooks for taps." />
          ) : (
            <ul className="divide-y divide-border">
              {data.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`${base}/integrations/${a.id}`)}
                    className="flex w-full flex-col gap-2 px-4 py-3.5 text-left hover:bg-surface-2/70 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                        {a.name === 'Business Terminal' ? <Smartphone className="h-4.5 w-4.5" /> : <Server className="h-4.5 w-4.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                          {a.name} <ActiveBadge active={a.is_active} />
                          <Badge tone={a.delivery_mode === 'relay' ? 'accent' : 'info'}>{a.delivery_mode}</Badge>
                        </span>
                        <span className="block truncate font-mono text-[12px] text-subtle">
                          {a.endpoint.url ?? 'No endpoint — events are logged only'}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-4 pl-12 text-[13px] text-muted sm:pl-0">
                      {a.endpoint.url && a.endpoint.last_test_success === false && (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5" /> Last test failed
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Smartphone className="h-3.5 w-3.5" /> {a.device_count}
                      </span>
                      <ArrowRight className="h-4 w-4 text-subtle" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <ApiUsageCard />
      </div>
      {creating && (
        <CreateBizAppModal
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false)
            setSecrets(r)
          }}
        />
      )}
      <SecretsModal
        open={!!secrets}
        title="Application created"
        description="Store these secrets now — they are shown only once."
        secrets={
          secrets
            ? [
                { label: 'API key', value: secrets.api_key_plaintext, hint: 'Registers devices' },
                { label: 'Webhook signing secret', value: secrets.webhook_secret_plaintext, hint: 'Verifies webhook signatures' },
              ]
            : []
        }
        onClose={() => {
          const id = secrets?.application.id
          setSecrets(null)
          if (id) navigate(`${base}/integrations/${id}`)
        }}
      />
    </>
  )
}
