import { useState, type FormEvent } from 'react'
import type { PlatformSettings } from '@/api/types'
import { useAdminMutations, usePlatformSettings } from '@/hooks/useConsole'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/EmptyState'
import { Field, Input, Switch, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Spinner'
import { Alert } from '@/components/ui/Alert'
import { useToast } from '@/components/ui/toastContext'

function SettingsForm({ s }: { s: PlatformSettings }) {
  const { patchSettings } = useAdminMutations()
  const toast = useToast()
  const [dev, setDev] = useState(s.signups_enabled.developer)
  const [biz, setBiz] = useState(s.signups_enabled.business)
  const personalWas = s.signups_enabled.personal ?? true
  const [personal, setPersonal] = useState(personalWas)
  const [retention, setRetention] = useState(String(s.request_log_retention_days))
  const [reqs, setReqs] = useState(String(s.default_rate_limit.requests))
  const [windowS, setWindowS] = useState(String(s.default_rate_limit.window_seconds))
  const [maint, setMaint] = useState(s.maintenance_message ?? '')
  const [confirm, setConfirm] = useState(false)

  const retentionN = Number(retention)
  const reqsN = Number(reqs)
  const windowN = Number(windowS)
  const errors = {
    retention: !Number.isInteger(retentionN) || retentionN < 1 || retentionN > 3650 ? 'Between 1 and 3650 days.' : null,
    reqs: !Number.isInteger(reqsN) || reqsN < 1 ? 'At least 1.' : null,
    window: !Number.isInteger(windowN) || windowN < 1 || windowN > 3600 ? '1 – 3600 seconds.' : null,
  }
  const next: PlatformSettings = {
    signups_enabled: { developer: dev, business: biz, personal },
    request_log_retention_days: retentionN,
    default_rate_limit: { requests: reqsN, window_seconds: windowN },
    maintenance_message: maint.trim() || null,
  }
  const baseline: PlatformSettings = { ...s, signups_enabled: { developer: s.signups_enabled.developer, business: s.signups_enabled.business, personal: personalWas }, maintenance_message: s.maintenance_message ?? null }
  const dirty = JSON.stringify(next) !== JSON.stringify(baseline)
  const invalid = Object.values(errors).some(Boolean)
  const risky = (!dev && s.signups_enabled.developer) || (!biz && s.signups_enabled.business) || (!personal && personalWas) || retentionN < s.request_log_retention_days || (!!maint.trim() && !s.maintenance_message)

  async function save() {
    try {
      await patchSettings.mutateAsync(next)
      toast.success('Platform settings saved')
      setConfirm(false)
    } catch (e) {
      toast.fromError(e)
    }
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        setConfirm(true)
      }}
      noValidate
      className="space-y-6"
    >
      <Card>
        <CardHeader title="Sign-ups" description="Turn off self-service registration per account type. Existing accounts are unaffected." />
        <ul className="divide-y divide-border">
          {[
            { label: 'Developer sign-ups', v: dev, set: setDev },
            { label: 'Business sign-ups', v: biz, set: setBiz },
            { label: 'Personal sign-ups', v: personal, set: setPersonal },
          ].map((r) => (
            <li key={r.label} className="flex items-center justify-between px-4 py-3 sm:px-5">
              <span className="text-[13.5px] font-medium">{r.label}</span>
              <span className="flex items-center gap-2 text-[13px] text-muted">
                {r.v ? 'Open' : 'Closed'}
                <Switch checked={r.v} onChange={r.set} label={r.label} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Limits & retention" />
        <CardBody className="grid gap-5 sm:grid-cols-3">
          <Field label="Request-log retention" hint="Days; purged daily by the worker." error={errors.retention}>
            {(p) => <Input {...p} type="number" min={1} value={retention} onChange={(e) => setRetention(e.target.value)} />}
          </Field>
          <Field label="Default rate limit" hint="Requests per window" error={errors.reqs}>
            {(p) => <Input {...p} type="number" min={1} value={reqs} onChange={(e) => setReqs(e.target.value)} />}
          </Field>
          <Field label="Window" hint="Seconds" error={errors.window}>
            {(p) => <Input {...p} type="number" min={1} value={windowS} onChange={(e) => setWindowS(e.target.value)} />}
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Maintenance message" description="Shown as a banner at the top of every dashboard (via GET /meta/status) while set. Leave empty to clear it." />
        <CardBody>
          <Field label="Message" optional>
            {(p) => <Textarea {...p} rows={2} maxLength={280} value={maint} onChange={(e) => setMaint(e.target.value)} placeholder="Scheduled maintenance on Sunday 02:00–03:00 UTC." />}
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" variant="primary" disabled={!dirty || invalid} loading={patchSettings.isPending}>
            Save settings
          </Button>
        </CardFooter>
      </Card>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Apply platform settings?"
        description="These settings affect every account on the platform."
        danger={risky}
        confirmLabel="Apply"
        loading={patchSettings.isPending}
        onConfirm={save}
      >
        {retentionN < s.request_log_retention_days && (
          <Alert tone="warning">Lowering retention to {retentionN} days permanently deletes older request logs at the next purge.</Alert>
        )}
      </ConfirmDialog>
    </form>
  )
}

export default function AdminSettingsPage() {
  useDocumentTitle('Admin · Platform settings')
  const { data, error, refetch, dataUpdatedAt } = usePlatformSettings()
  return (
    <>
      <PageHeader title="Platform settings" description="Global switches for sign-ups, retention, rate limits and maintenance." />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : !data ? (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : (
        <SettingsForm key={dataUpdatedAt} s={data} />
      )}
    </>
  )
}
