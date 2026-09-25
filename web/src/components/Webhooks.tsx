import { useState } from 'react'
import { CheckCircle2, KeyRound, RefreshCw, ShieldX, XCircle } from 'lucide-react'
import type { Application, Delivery } from '@/api/types'
import { useRotateSecret } from '@/hooks/queries'
import { useNow } from '@/hooks/useNow'
import { dateTime, deliveryError, relativeTime } from '@/lib/format'
import { Card, CardBody, CardHeader } from './ui/Card'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { ConfirmDialog } from './ui/Modal'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from './ui/Table'
import { useToast } from './ui/toastContext'
import { SecretsModal } from './SecretsModal'
import { ErrorRef } from './ui/ErrorMeta'

export function WebhookSecretPanel({ app }: { app: Application }) {
  const rotate = useRotateSecret(app.id)
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const s = app.webhook_secret

  return (
    <Card>
      <CardHeader
        title="Signing secret"
        description="Used to compute X-NFC-Signature. Stored encrypted; only the last 4 characters are ever displayed."
        actions={
          <Button leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfirm(true)} size="sm">
            Rotate secret
          </Button>
        }
      />
      <CardBody>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-subtle">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-subtle">Secret</p>
              {s.configured ? (
                <code className="text-[13px]" translate="no">
                  whsec_••••••••{s.last4}
                </code>
              ) : (
                <span className="text-[13px] text-muted">Not configured</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-subtle">Status</p>
            {s.configured ? <Badge tone="success" dot>Configured</Badge> : <Badge tone="warning" dot>Missing</Badge>}
          </div>
          <div>
            <p className="text-xs text-subtle">Last rotated</p>
            <p className="text-[13px]" title={dateTime(s.rotated_at)}>
              {s.rotated_at ? dateTime(s.rotated_at) : 'Never (original secret)'}
            </p>
          </div>
        </div>
      </CardBody>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Rotate signing secret?"
        confirmLabel="Rotate now"
        loading={rotate.isPending}
        onConfirm={async () => {
          try {
            const res = await rotate.mutateAsync({})
            setConfirm(false)
            setPlaintext(res.webhook_secret_plaintext)
            toast.success('Signing secret rotated')
          } catch (e) {
            toast.fromError(e)
          }
        }}
      >
        <p className="text-[13px] text-muted">
          The old secret stops working <strong className="text-fg">immediately</strong>. Deliveries signed with the new secret will fail
          verification until you update your server.
          {app.delivery_mode === 'direct' && ' Devices in direct mode receive their new derived signing key on their next config refresh.'}
        </p>
      </ConfirmDialog>

      <SecretsModal
        open={!!plaintext}
        title="New signing secret"
        description={`For “${app.name}”. Update NFC_WEBHOOK_SECRET on your server.`}
        secrets={plaintext ? [{ label: 'Webhook signing secret', value: plaintext }] : []}
        onClose={() => setPlaintext(null)}
        warning="Only an encrypted copy is kept server-side and it is never shown again. Rotate again if you lose it."
      />
    </Card>
  )
}

export function DeliveriesTable({ deliveries, showApp, appNames }: { deliveries: Delivery[]; showApp?: boolean; appNames?: Record<string, string> }) {
  const now = useNow()
  return (
    <TableWrap>
      <Table className="min-w-[760px]">
        <THead>
          <tr>
            <TH>Result</TH>
            <TH>Status</TH>
            <TH>Attempt</TH>
            {showApp && <TH>Application</TH>}
            <TH>URL</TH>
            <TH className="text-right">Latency</TH>
            <TH>When</TH>
          </tr>
        </THead>
        <TBody>
          {deliveries.map((d) => (
            <TR key={d.id}>
              <TD>
                <span className="inline-flex items-center gap-1.5">
                  {d.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : d.error === 'domain_not_allowed' ? (
                    <ShieldX className="h-4 w-4 text-amber-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span className="font-medium">{d.success ? 'Delivered' : d.error === 'domain_not_allowed' ? 'Blocked' : 'Failed'}</span>
                </span>
                {d.error && (
                  <p className="mt-0.5 max-w-[260px] truncate text-xs text-red-600 dark:text-red-400" title={deliveryError(d.error)?.text}>
                    {d.error === 'domain_not_allowed' ? 'Host not in allowed domains' : d.error}
                  </p>
                )}
                <ErrorRef code={d.error_code} refId={d.error_ref} className="mt-1" />
              </TD>
              <TD>
                {d.status_code != null ? (
                  <Badge tone={d.success ? 'success' : 'danger'} className="font-mono">
                    {d.status_code}
                  </Badge>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </TD>
              <TD className="whitespace-nowrap text-muted">
                #{d.attempt} <Badge tone={d.mode === 'relay' ? 'accent' : 'info'} className="ml-1">{d.mode}</Badge>
              </TD>
              {showApp && <TD className="text-muted">{appNames?.[d.application_id] ?? '—'}</TD>}
              <TD className="max-w-[240px] truncate font-mono text-[12px] text-muted" title={d.url}>
                {d.url}
              </TD>
              <TD className="text-right tabular-nums text-muted">{d.latency_ms != null ? `${d.latency_ms} ms` : '—'}</TD>
              <TD className="whitespace-nowrap text-muted" title={dateTime(d.created_at, true)}>
                {relativeTime(d.created_at, now)}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  )
}
