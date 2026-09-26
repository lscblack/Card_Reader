import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, Plus, Power, Smartphone, Trash2 } from 'lucide-react'
import type { Application } from '@/api/types'
import { ApiError } from '@/api/client'
import { useApiKeys, useApplication, useDeleteApplication, useDevices, useUpdateApplication } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { dateTime } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ActiveBadge, Badge } from '@/components/ui/Badge'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import { ConfirmDialog } from '@/components/ui/Modal'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToast } from '@/components/ui/toastContext'
import { EndpointForm } from '@/components/EndpointForm'
import { WebhookSecretPanel } from '@/components/Webhooks'
import { AllowedDomainsCard } from '@/components/AllowedDomains'
import { ApiKeysTable, CreateApiKeyModal } from '@/components/ApiKeys'
import { DevicesTable } from '@/components/Devices'
import { RunConsole } from '@/components/RunConsole'
import { PairPhoneButton } from '@/components/PairPhoneModal'

type Tab = 'settings' | 'live' | 'endpoint' | 'keys' | 'devices'

function SettingsTab({ app }: { app: Application }) {
  const update = useUpdateApplication(app.id)
  const del = useDeleteApplication()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState(app.name)
  const [description, setDescription] = useState(app.description ?? '')
  const [err, setErr] = useState<unknown>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')
  const dirty = name.trim() !== app.name || description.trim() !== (app.description ?? '')

  async function onSave(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await update.mutateAsync({ name: name.trim(), description: description.trim() })
      toast.success('Application updated')
    } catch (e2) {
      setErr(e2)
    }
  }

  const fieldErrors = err instanceof ApiError ? err.fieldErrors : {}

  return (
    <div className="space-y-6">
      <form onSubmit={onSave} noValidate>
        <Card>
          <CardHeader title="General" />
          <CardBody className="space-y-4">
            {err != null && <ErrorAlert error={err} />}
            <Field label="Name" error={fieldErrors.name}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Description" optional error={fieldErrors.description}>
              {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />}
            </Field>
            <div className="grid gap-3 text-[13px] sm:grid-cols-3">
              <div>
                <p className="text-xs text-subtle">Application ID</p>
                <p className="flex items-center gap-1 font-mono text-[12px]">
                  <span className="truncate">{app.id}</span>
                  <CopyButton value={app.id} label="Copy application ID" />
                </p>
              </div>
              <div>
                <p className="text-xs text-subtle">Created</p>
                <p>{dateTime(app.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-subtle">Updated</p>
                <p>{dateTime(app.updated_at)}</p>
              </div>
            </div>
          </CardBody>
          <CardFooter>
            <Button type="submit" variant="primary" loading={update.isPending} disabled={!dirty || !name.trim()}>
              Save changes
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card className="border-red-200 dark:border-red-900/50">
        <CardHeader title="Danger zone" />
        <CardBody className="divide-y divide-border p-0 sm:p-0">
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <p className="text-[13.5px] font-medium">{app.is_active ? 'Deactivate application' : 'Reactivate application'}</p>
              <p className="text-[13px] text-muted">
                {app.is_active
                  ? 'Devices stop sending events and new registrations are rejected. Keys and devices are kept.'
                  : 'Allow devices to send events and register again.'}
              </p>
            </div>
            <Button
              variant={app.is_active ? 'danger-soft' : 'secondary'}
              leftIcon={<Power className="h-4 w-4" />}
              loading={update.isPending && !dirty}
              onClick={async () => {
                if (app.is_active) return setConfirmDeactivate(true)
                try {
                  await update.mutateAsync({ is_active: true })
                  toast.success('Application reactivated')
                } catch (e) {
                  toast.fromError(e)
                }
              }}
            >
              {app.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <p className="text-[13.5px] font-medium">Delete application</p>
              <p className="text-[13px] text-muted">Permanently deletes the application and revokes all its API keys and devices.</p>
            </div>
            <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        title="Deactivate application?"
        description={`Devices of “${app.name}” will stop delivering card events until you reactivate it.`}
        confirmLabel="Deactivate"
        loading={update.isPending}
        onConfirm={async () => {
          try {
            await update.mutateAsync({ is_active: false })
            toast.success('Application deactivated')
            setConfirmDeactivate(false)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false)
          setTyped('')
        }}
        title="Delete application?"
        description="This revokes all of its API keys and devices. This cannot be undone."
        confirmLabel="Delete application"
        confirmText={app.name}
        typed={typed}
        onTypedChange={setTyped}
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(app.id)
            toast.success(`“${app.name}” deleted`)
            navigate('/dashboard/applications', { replace: true })
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
    </div>
  )
}

function KeysTab({ app }: { app: Application }) {
  const { data, isLoading, error, refetch } = useApiKeys(app.id)
  const [creating, setCreating] = useState(false)
  return (
    <Card>
      <CardHeader
        title="API keys"
        description="Used by the phone app only to register a device."
        actions={
          <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            New key
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={3} />
      ) : (
        <ApiKeysTable keys={data ?? []} showApp={false} onCreate={() => setCreating(true)} />
      )}
      <CreateApiKeyModal open={creating} onClose={() => setCreating(false)} applicationId={app.id} />
    </Card>
  )
}

function DevicesTab({ app }: { app: Application }) {
  const { data, isLoading, error, refetch } = useDevices({ application_id: app.id })
  return (
    <Card>
      <CardHeader
        title="Devices"
        description="Phones registered as NFC readers for this application."
        actions={<PairPhoneButton applicationId={app.id} size="sm" disabled={!app.is_active} />}
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={3} />
      ) : !data?.length ? (
        <EmptyState
          icon={Smartphone}
          title="No devices yet"
          description="Install the nexTap app on an Android phone, then pair it by scanning a QR code (or register it with one of this application's API keys)."
          action={
            <div className="flex flex-col items-center gap-2">
              <PairPhoneButton applicationId={app.id} disabled={!app.is_active} />
              <Link to="/docs#pairing" className="text-[13px] font-medium text-accent hover:underline">
                How pairing works
              </Link>
            </div>
          }
        />
      ) : (
        <DevicesTable devices={data} showApp={false} />
      )}
    </Card>
  )
}

export default function ApplicationDetailPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (['settings', 'live', 'endpoint', 'keys', 'devices'].includes(params.get('tab') ?? '') ? params.get('tab') : 'settings') as Tab
  const { data: app, isLoading, error, refetch } = useApplication(id)
  useDocumentTitle(app?.name ?? 'Application')

  return (
    <>
      <Link to="/dashboard/applications" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Applications
      </Link>
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !app ? (
        <div className="space-y-4">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="mt-6 h-64 w-full" />
        </div>
      ) : (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-2.5">
                {app.name} <ActiveBadge active={app.is_active} />
                <Badge tone={app.delivery_mode === 'relay' ? 'accent' : 'info'}>{app.delivery_mode}</Badge>
              </span>
            }
            description={app.description || undefined}
          />
          <Tabs<Tab>
            className="mb-6"
            value={tab}
            onChange={(t) => setParams(t === 'settings' ? {} : { tab: t }, { replace: true })}
            tabs={[
              { value: 'settings', label: 'Settings' },
              { value: 'live', label: 'Live' },
              { value: 'endpoint', label: 'Endpoint & webhooks' },
              { value: 'keys', label: 'API keys' },
              { value: 'devices', label: 'Devices', count: app.device_count },
            ]}
          />
          {tab === 'settings' && <SettingsTab key={app.id} app={app} />}
          {tab === 'endpoint' && (
            <div className="space-y-6">
              <EndpointForm key={app.id} app={app} />
              <AllowedDomainsCard key={`ad-${app.id}`} app={app} />
              <WebhookSecretPanel app={app} />
            </div>
          )}
          {tab === 'live' && <RunConsole key={app.id} fixedAppId={app.id} />}
          {tab === 'keys' && <KeysTab app={app} />}
          {tab === 'devices' && <DevicesTab app={app} />}
        </>
      )}
    </>
  )
}
