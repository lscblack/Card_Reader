import { useState, type FormEvent } from 'react'
import { CheckCircle2, Plus, Send, Trash2, XCircle } from 'lucide-react'
import type { Application, DeliveryMode, EndpointTestResult } from '@/api/types'
import { ApiError, errorMessage } from '@/api/client'
import { useTestEndpoint, useUpdateEndpoint } from '@/hooks/queries'
import { checkEndpointUrl, endpointOutsideAllowlist } from '@/lib/url'
import { dateTime, deliveryError } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Card, CardBody, CardFooter, CardHeader } from './ui/Card'
import { Field, Input, Switch } from './ui/Input'
import { Button } from './ui/Button'
import { Alert } from './ui/Alert'
import { Badge } from './ui/Badge'
import { useToast } from './ui/toastContext'
import { DeliveryModePicker } from './DeliveryModePicker'

interface HeaderRow {
  id: number
  key: string
  value: string
}

const RESERVED = /^(host|content-length|content-type|user-agent|connection|transfer-encoding|x-nfc-.*)$/i
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

let rowSeq = 1
const toRows = (h: Record<string, string>): HeaderRow[] => Object.entries(h).map(([key, value]) => ({ id: rowSeq++, key, value }))

function HeadersEditor({ rows, onChange, disabled }: { rows: HeaderRow[]; onChange: (r: HeaderRow[]) => void; disabled?: boolean }) {
  const update = (id: number, patch: Partial<HeaderRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-[13px] text-subtle">No custom headers.</p>}
      {rows.map((r) => {
        const k = r.key.trim()
        const err = k && !HEADER_NAME.test(k) ? 'Invalid header name' : k && RESERVED.test(k) ? 'Reserved header' : null
        return (
          <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-start sm:border-0 sm:p-0">
            <div className="flex-1 sm:max-w-[240px]">
              <Input
                aria-label="Header name"
                placeholder="X-Api-Token"
                value={r.key}
                onChange={(e) => update(r.id, { key: e.target.value })}
                disabled={disabled}
                aria-invalid={!!err}
                spellCheck={false}
                className="font-mono text-[12.5px]"
              />
              {err && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{err}</p>}
            </div>
            <Input
              aria-label="Header value"
              placeholder="value"
              value={r.value}
              onChange={(e) => update(r.id, { value: e.target.value })}
              disabled={disabled}
              spellCheck={false}
              className="flex-1 font-mono text-[12.5px]"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove header"
              onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
              disabled={disabled}
              className="self-end sm:self-auto"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      })}
      <Button
        size="sm"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        onClick={() => onChange([...rows, { id: rowSeq++, key: '', value: '' }])}
        disabled={disabled || rows.length >= 20}
      >
        Add header
      </Button>
    </div>
  )
}

export function TestResultPanel({ result }: { result: EndpointTestResult }) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        result.success
          ? 'border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/5'
          : 'border-red-300/70 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/5',
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        {result.success ? <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" /> : <XCircle className="h-4.5 w-4.5 text-red-500" />}
        <span className="font-semibold">{result.success ? 'Test event delivered' : 'Test event failed'}</span>
        {result.status_code != null && (
          <Badge tone={result.success ? 'success' : 'danger'} className="font-mono">
            HTTP {result.status_code}
          </Badge>
        )}
        {result.latency_ms != null && <Badge>{result.latency_ms} ms</Badge>}
      </div>
      {result.error && <p className="mt-2 text-[13px] text-red-700 dark:text-red-300">{deliveryError(result.error)?.text}</p>}
      {result.response_excerpt && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-subtle">Response excerpt</p>
          <pre className="max-h-40 overflow-auto rounded-lg bg-surface p-2.5 text-[12px] whitespace-pre-wrap text-muted ring-1 ring-border">
            {result.response_excerpt}
          </pre>
        </div>
      )}
      <p className="mt-3 text-xs text-subtle">
        Sent <code>endpoint.test</code> with <code>&quot;test&quot;: true</code> and <code>card_id</code> <code>TEST0000</code> and an all-zero <code>device_id</code>, signed like a real event.
      </p>
    </div>
  )
}

export function EndpointForm({ app }: { app: Application }) {
  const toast = useToast()
  const update = useUpdateEndpoint(app.id)
  const test = useTestEndpoint(app.id)
  const [url, setUrl] = useState(app.endpoint.url ?? '')
  const [enabled, setEnabled] = useState(app.endpoint.enabled)
  const [mode, setMode] = useState<DeliveryMode>(app.delivery_mode)
  const [timeout, setTimeoutS] = useState(String(app.endpoint.timeout_seconds))
  const [rows, setRows] = useState<HeaderRow[]>(() => toRows(app.endpoint.custom_headers ?? {}))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<unknown>(null)
  const [testResult, setTestResult] = useState<EndpointTestResult | null>(null)

  const urlCheck = checkEndpointUrl(url)
  const allowlist = app.allowed_domains ?? []
  const outsideHost = urlCheck.level !== 'error' ? endpointOutsideAllowlist(url, allowlist) : null
  const timeoutNum = Number(timeout)
  const timeoutErr = !Number.isInteger(timeoutNum) || timeoutNum < 1 || timeoutNum > 30 ? 'Between 1 and 30 seconds.' : null
  const headerErr = rows.some((r) => {
    const k = r.key.trim()
    return (k && (!HEADER_NAME.test(k) || RESERVED.test(k))) || (!k && r.value.trim())
  })
  const dupHeaders = new Set(rows.map((r) => r.key.trim().toLowerCase()).filter(Boolean)).size !== rows.filter((r) => r.key.trim()).length

  const headersObj = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]))
  const dirty =
    (url.trim() || null) !== app.endpoint.url ||
    enabled !== app.endpoint.enabled ||
    mode !== app.delivery_mode ||
    timeoutNum !== app.endpoint.timeout_seconds ||
    JSON.stringify(headersObj) !== JSON.stringify(app.endpoint.custom_headers ?? {})

  const invalid = urlCheck.level === 'error' || !!outsideHost || !!timeoutErr || headerErr || dupHeaders || (enabled && !url.trim())

  async function onSave(e: FormEvent) {
    e.preventDefault()
    setSaveError(null)
    setFieldErrors({})
    try {
      await update.mutateAsync({
        url: url.trim() || null,
        enabled,
        timeout_seconds: timeoutNum,
        custom_headers: headersObj,
        delivery_mode: mode,
      })
      toast.success('Endpoint configuration saved')
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors)
      setSaveError(err)
    }
  }

  async function onTest() {
    setTestResult(null)
    try {
      setTestResult(await test.mutateAsync())
    } catch (err) {
      toast.fromError(err, 'Could not send test event')
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSave} noValidate>
        <Card>
          <CardHeader
            title="Endpoint"
            description="Where card events for this application are POSTed as signed JSON."
            actions={
              <label className="flex items-center gap-2 text-[13px] font-medium">
                <Switch checked={enabled} onChange={setEnabled} label="Deliveries enabled" />
                {enabled ? 'Enabled' : 'Disabled'}
              </label>
            }
          />
          <CardBody className="space-y-5">
            {saveError != null && (
              <Alert tone="danger" title={saveError instanceof ApiError && saveError.code === 'domain_not_allowed' ? 'Domain not allowed' : undefined}>
                {saveError instanceof ApiError && saveError.code === 'domain_not_allowed'
                  ? `This URL's host isn't in the application's allowed domains (${allowlist.join(', ') || 'none'}). Use an allowed host or edit the allowlist below.`
                  : errorMessage(saveError)}
              </Alert>
            )}
            {!app.is_active && <Alert tone="warning">This application is inactive — its devices can&apos;t send events until you reactivate it.</Alert>}
            <Field
              label="Endpoint URL"
              error={
                fieldErrors.url ??
                (urlCheck.level === 'error'
                  ? urlCheck.message
                  : outsideHost
                    ? `“${outsideHost}” is not in this application's allowed domains: ${allowlist.join(', ')}.`
                    : enabled && !url.trim()
                      ? 'Required while deliveries are enabled.'
                      : null)
              }
              hint={
                urlCheck.level === 'warn'
                  ? urlCheck.message
                  : allowlist.length
                    ? `Must be https:// and match an allowed domain: ${allowlist.join(', ')}.`
                    : 'Must be https://. Max 2048 characters, no credentials or #fragment.'
              }
            >
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com/nfc/card"
                  spellCheck={false}
                  className="font-mono text-[13px]"
                />
              )}
            </Field>

            <div className="grid gap-5 sm:grid-cols-[1fr_180px]">
              <div className="space-y-1.5">
                <p className="text-[13px] font-medium">Delivery mode</p>
                <DeliveryModePicker value={mode} onChange={setMode} />
              </div>
              <Field label="Timeout" hint="Seconds (1–30)" error={fieldErrors.timeout_seconds ?? timeoutErr}>
                {(p) => <Input {...p} type="number" min={1} max={30} step={1} value={timeout} onChange={(e) => setTimeoutS(e.target.value)} />}
              </Field>
            </div>

            <div className="space-y-2">
              <div>
                <p className="text-[13px] font-medium">Custom headers</p>
                <p className="text-xs text-subtle">
                  Added to every delivery (e.g. an auth token for your API). {mode === 'direct' ? 'In direct mode these are sent to the device.' : 'In relay mode they stay server-side.'}
                </p>
              </div>
              <HeadersEditor rows={rows} onChange={setRows} />
              {dupHeaders && <p className="text-xs text-red-600 dark:text-red-400">Header names must be unique.</p>}
            </div>
          </CardBody>
          <CardFooter className="justify-between">
            <p className="text-xs text-subtle">
              {app.endpoint.last_tested_at ? (
                <>
                  Last test {dateTime(app.endpoint.last_tested_at)} —{' '}
                  <span className={app.endpoint.last_test_success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    {app.endpoint.last_test_success ? 'succeeded' : 'failed'}
                  </span>
                </>
              ) : (
                'Never tested'
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                leftIcon={<Send className="h-4 w-4" />}
                onClick={onTest}
                loading={test.isPending}
                disabled={!app.endpoint.url || dirty}
                title={dirty ? 'Save your changes before testing' : !app.endpoint.url ? 'Save an endpoint URL first' : undefined}
              >
                Send test event
              </Button>
              <Button type="submit" variant="primary" loading={update.isPending} disabled={!dirty || invalid}>
                Save changes
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>
      {testResult && <TestResultPanel result={testResult} />}
    </div>
  )
}
