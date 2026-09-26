import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, FlaskConical, Plus, Send, Smartphone } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ActiveBadge, Badge } from '@/components/ui/Badge'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import { Alert } from '@/components/ui/Alert'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/toastContext'
import { EndpointForm } from '@/components/EndpointForm'
import { AllowedDomainsCard } from '@/components/AllowedDomains'
import { DeliveriesTable, WebhookSecretPanel } from '@/components/Webhooks'
import { ApiKeysTable, CreateApiKeyModal } from '@/components/ApiKeys'
import { DevicesTable } from '@/components/Devices'
import { PairPhoneButton } from '@/components/PairPhoneModal'
import { RunConsole } from '@/components/RunConsole'
import type { Application } from '@/api/types'
import { useApiKeys, useApplication, useDeliveries, useDevices, useUpdateApplication } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { dateTime } from '@/lib/format'
import { useBusiness, useCan } from '../hooks/context'
import { useErrorToast } from '../hooks/useErrorToast'
import { PageSkeleton } from '../components/bits'
import { BizErrorState, NoAccess } from '../components/BizError'

type Tab = 'endpoint' | 'live' | 'keys' | 'devices' | 'deliveries' | 'settings'

function KeysTab({ app }: { app: Application }) {
  const { data, isLoading, error, refetch } = useApiKeys(app.id)
  const [creating, setCreating] = useState(false)
  return (
    <Card>
      <CardHeader
        title="API keys"
        description="Used only to register devices (or pair them by QR code instead)."
        actions={
          <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            New key
          </Button>
        }
      />
      {error ? <BizErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <SkeletonRows rows={3} /> : <ApiKeysTable keys={data ?? []} showApp={false} onCreate={() => setCreating(true)} />}
      <CreateApiKeyModal open={creating} onClose={() => setCreating(false)} applicationId={app.id} />
    </Card>
  )
}

function DevicesTab({ app }: { app: Application }) {
  const can = useCan()
  const { data, isLoading, error, refetch } = useDevices({ application_id: app.id })
  return (
    <Card>
      <CardHeader
        title="Devices"
        description="Phones registered with this application."
        actions={can('devices.manage') && <PairPhoneButton applicationId={app.id} size="sm" disabled={!app.is_active} />}
      />
      {error ? (
        <BizErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={3} />
      ) : !data?.length ? (
        <EmptyState icon={Smartphone} title="No devices yet" description="Pair an Android phone running nexTap by scanning a QR code." />
      ) : (
        <DevicesTable devices={data} showApp={false} />
      )}
    </Card>
  )
}

function DeliveriesTab({ app }: { app: Application }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useDeliveries({ application_id: app.id, page, page_size: 20 })
  return (
    <Card>
      <CardHeader title="Webhook deliveries" description="Every signed delivery attempt to this application’s endpoint." />
      {error ? (
        <BizErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={5} cols={5} />
      ) : !data?.items.length ? (
        <EmptyState icon={Send} title="No deliveries yet" description={app.endpoint.url ? 'Deliveries appear when a tap runs a developer webhook action or a reader sends an event.' : 'Set an endpoint URL to start receiving webhooks.'} />
      ) : (
        <>
          <DeliveriesTable deliveries={data.items} />
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  )
}

function SettingsTab({ app }: { app: Application }) {
  const toast = useToast()
  const onError = useErrorToast()
  const update = useUpdateApplication(app.id)
  const [name, setName] = useState(app.name)
  const [description, setDescription] = useState(app.description ?? '')
  const dirty = name.trim() !== app.name || description.trim() !== (app.description ?? '')
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="General" />
        <CardBody className="space-y-4">
          <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
          <Field label="Description" optional>
            {(p) => <Textarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}
          </Field>
          <p className="text-xs text-subtle">
            Application ID <span className="font-mono">{app.id}</span> · created {dateTime(app.created_at)}
          </p>
        </CardBody>
        <CardFooter>
          <Button
            variant="primary"
            loading={update.isPending}
            disabled={!dirty || !name.trim()}
            onClick={async () => {
              try {
                await update.mutateAsync({ name: name.trim(), description: description.trim() })
                toast.success('Application updated')
              } catch (e) {
                onError(e)
              }
            }}
          >
            Save changes
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13.5px] font-medium">{app.is_active ? 'Pause application' : 'Resume application'}</p>
            <p className="text-[13px] text-muted">{app.is_active ? 'Devices stop sending events until you resume it. Keys and devices are kept.' : 'Let devices send events again.'}</p>
          </div>
          <Button
            variant={app.is_active ? 'danger-soft' : 'primary'}
            loading={update.isPending}
            onClick={async () => {
              try {
                await update.mutateAsync({ is_active: !app.is_active })
                toast.success(app.is_active ? 'Application paused' : 'Application resumed')
              } catch (e) {
                onError(e)
              }
            }}
          >
            {app.is_active ? 'Pause' : 'Resume'}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}

export default function IntegrationAppPage() {
  const { appId } = useParams()
  const { business, base } = useBusiness()
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const tabs: Tab[] = ['endpoint', 'live', 'keys', 'devices', 'deliveries', 'settings']
  const tab = (tabs.includes(params.get('tab') as Tab) ? params.get('tab') : 'endpoint') as Tab
  const { data: app, error, isLoading, refetch } = useApplication(appId)
  useDocumentTitle(app?.name ?? 'Application')
  const back = (
    <Link to={`${base}/integrations`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
      <ArrowLeft className="h-3.5 w-3.5" /> API / Integrations
    </Link>
  )
  if (!can('api.view'))
    return (
      <>
        {back}
        <Card>
          <NoAccess permission="api.view" />
        </Card>
      </>
    )
  if (error)
    return (
      <>
        {back}
        <Card>
          <BizErrorState error={error} onRetry={() => refetch()} />
        </Card>
      </>
    )
  if (isLoading || !app)
    return (
      <>
        {back}
        <PageSkeleton />
      </>
    )
  const manage = can('api.manage')
  return (
    <>
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {app.name} <ActiveBadge active={app.is_active} />
            <Badge tone={app.delivery_mode === 'relay' ? 'accent' : 'info'}>{app.delivery_mode}</Badge>
          </span>
        }
        description={app.description || undefined}
        actions={
          manage && (
            <Link to={`/dashboard/sandbox?business_id=${business.id}`}>
              <Button leftIcon={<FlaskConical className="h-4 w-4" />}>Test with Sandbox</Button>
            </Link>
          )
        }
      />
      {!manage && (
        <Alert tone="info" className="mb-4">
          You have read-only access. Managing endpoints, keys and webhooks requires “Manage API keys, endpoints &amp; webhooks”.
        </Alert>
      )}
      <Tabs<Tab>
        className="mb-6"
        value={tab}
        onChange={(t) => setParams(t === 'endpoint' ? {} : { tab: t }, { replace: true })}
        tabs={[
          { value: 'endpoint', label: 'Endpoint & webhooks' },
          { value: 'live', label: 'Live' },
          ...(manage ? [{ value: 'keys' as Tab, label: 'API keys' }] : []),
          { value: 'devices', label: 'Devices', count: app.device_count },
          { value: 'deliveries', label: 'Deliveries' },
          ...(manage ? [{ value: 'settings' as Tab, label: 'Settings' }] : []),
        ]}
      />
      {tab === 'endpoint' &&
        (manage ? (
          <div className="space-y-6">
            {!app.endpoint.url && (
              <Alert tone="info" title="No endpoint configured">
                That’s fine for a business terminal: reader taps are still recorded (status “logged”). Add an endpoint to receive signed webhooks in your own system.
              </Alert>
            )}
            <EndpointForm key={app.id} app={app} />
            <AllowedDomainsCard key={`ad-${app.id}`} app={app} />
            <WebhookSecretPanel app={app} />
          </div>
        ) : (
          <Card>
            <CardBody className="text-[13px]">
              <p className="text-muted">Endpoint</p>
              <p className="font-mono">{app.endpoint.url ?? '—'}</p>
            </CardBody>
          </Card>
        ))}
      {tab === 'live' && (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            Press <span className="font-medium text-fg">Run</span>, then tap a card on one of this application’s devices — each read, the business result and every webhook delivery
            appear here as they happen.
          </p>
          <RunConsole key={app.id} fixedAppId={app.id} />
        </div>
      )}
      {tab === 'keys' && manage && <KeysTab app={app} />}
      {tab === 'devices' && <DevicesTab app={app} />}
      {tab === 'deliveries' && <DeliveriesTab app={app} />}
      {tab === 'settings' && manage && <SettingsTab key={app.updated_at} app={app} />}
    </>
  )
}
