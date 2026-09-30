import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, CreditCard, ExternalLink, KeyRound, PlugZap, Webhook } from 'lucide-react'
import { adminPaymentsApi, type AdminPayments } from '@/api/support'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Alert } from '@/components/ui/Alert'
import { CopyButton } from '@/components/ui/CopyButton'
import { ErrorState } from '@/components/ui/EmptyState'
import { Field, Input, PasswordInput, Switch } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'

const QK = ['admin', 'payments']

function Status({ p }: { p: AdminPayments }) {
  const missing = [!p.secret_key_hint && 'secret key', !p.publishable_key && 'publishable key'].filter(Boolean) as string[]
  const on = p.enabled
  return (
    <Card className="overflow-hidden">
      <div className={cn('flex flex-wrap items-center gap-4 p-5', on ? 'bg-gradient-to-br from-emerald-500/10 to-transparent' : 'bg-gradient-to-br from-amber-500/10 to-transparent')}>
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', on ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}>
          {on ? <CheckCircle2 className="h-6 w-6" /> : <CircleAlert className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold tracking-tight">{on ? 'Online payments are on' : 'Online payments are off'}</p>
          <p className="text-[13px] text-muted">
            {on
              ? 'Customers can upgrade with a card from their billing page.'
              : missing.length
                ? `Add your Stripe ${missing.join(' and ')} below, then save — customers see “Upgrade” as soon as both are set.`
                : 'Your keys are saved but payments are switched off. Turn them on below.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.mode && <Badge tone={p.mode === 'live' ? 'success' : 'warning'} dot>{p.mode === 'live' ? 'Live mode' : 'Test mode'}</Badge>}
          <Badge tone="neutral">{p.source === 'admin' ? 'Keys set here' : p.source === 'env' ? 'Keys from server .env' : 'No keys'}</Badge>
        </div>
      </div>
    </Card>
  )
}

function KeysForm({ p }: { p: AdminPayments }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [secret, setSecret] = useState('')
  const [publishable, setPublishable] = useState(p.publishable_key ?? '')
  const [webhook, setWebhook] = useState('')
  const save = useMutation({
    mutationFn: adminPaymentsApi.update,
    onSuccess: (data) => {
      qc.setQueryData(QK, data)
      qc.invalidateQueries({ queryKey: ['billing'] })
      setSecret('')
      setWebhook('')
      toast.success(data.enabled ? 'Online payments are on' : 'Payment settings saved')
    },
    onError: (e) => toast.fromError(e),
  })
  const test = useMutation({
    mutationFn: adminPaymentsApi.test,
    onSuccess: (r) => toast.success(`Connected to “${r.account}” (${r.mode} mode)`, 'Stripe works'),
    onError: (e) => toast.fromError(e, 'Stripe connection failed'),
  })

  const body: Parameters<typeof adminPaymentsApi.update>[0] = {}
  if (secret.trim()) body.secret_key = secret.trim()
  if (publishable.trim() !== (p.publishable_key ?? '')) body.publishable_key = publishable.trim()
  if (webhook.trim()) body.webhook_secret = webhook.trim()
  const dirty = Object.keys(body).length > 0
  const turnOn = !p.switched_on

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Saving keys also switches payments on (the usual intent when pasting keys).
    save.mutate({ ...body, ...(dirty ? { enabled: true } : {}) })
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader
          title="Stripe keys"
          description={
            <>
              From{' '}
              <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                Stripe → Developers → API keys <ExternalLink className="h-3 w-3" />
              </a>
              . Use test keys (sk_test_ / pk_test_) until you’re ready to take real payments.
            </>
          }
        />
        <CardBody className="space-y-5">
          <Field label="Publishable key" hint="Starts with pk_test_ or pk_live_. Safe to show in the browser.">
            {(a) => <Input {...a} value={publishable} onChange={(e) => setPublishable(e.target.value)} placeholder="pk_test_…" spellCheck={false} autoComplete="off" className="font-mono text-[13px]" />}
          </Field>
          <Field
            label="Secret key"
            hint={p.secret_key_hint ? <>Saved: <span className="font-mono">{p.secret_key_hint}</span>. Paste a new key to replace it.</> : 'Starts with sk_test_ or sk_live_. Stored encrypted and never shown again.'}
          >
            {(a) => <PasswordInput {...a} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={p.secret_key_hint ? '•••••••• (unchanged)' : 'sk_test_…'} spellCheck={false} autoComplete="new-password" className="font-mono text-[13px]" />}
          </Field>
        </CardBody>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <Button onClick={() => test.mutate()} loading={test.isPending} disabled={!p.secret_key_hint} leftIcon={<PlugZap className="h-4 w-4" />}>
            Test connection
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty} leftIcon={<KeyRound className="h-4 w-4" />}>
            {turnOn || !p.enabled ? 'Save and turn on payments' : 'Save keys'}
          </Button>
        </CardFooter>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Webhook" description="Lets Stripe tell nexTap about renewals, failed payments and cancellations." />
        <CardBody className="space-y-5">
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted">
            <li>
              In Stripe, open <span className="font-medium text-fg">Developers → Webhooks → Add endpoint</span> and paste this URL:
            </li>
          </ol>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
            <Webhook className="h-4 w-4 shrink-0 text-subtle" />
            <code className="min-w-0 flex-1 truncate text-[13px]">{p.webhook_url}</code>
            <CopyButton value={p.webhook_url} />
          </div>
          <ol start={2} className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted">
            <li>
              Select the events <span className="font-mono text-fg">checkout.session.*</span> and <span className="font-mono text-fg">customer.subscription.*</span>.
            </li>
            <li>Copy the endpoint’s signing secret (whsec_…) below.</li>
          </ol>
          <Field label="Signing secret" hint={p.webhook_secret_set ? 'A signing secret is saved. Paste a new one to replace it.' : 'Optional for a first test — payments still activate the plan without it.'}>
            {(a) => <PasswordInput {...a} value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder={p.webhook_secret_set ? '•••••••• (unchanged)' : 'whsec_…'} spellCheck={false} autoComplete="new-password" className="font-mono text-[13px]" />}
          </Field>
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function Toggle({ p }: { p: AdminPayments }) {
  const qc = useQueryClient()
  const toast = useToast()
  const m = useMutation({
    mutationFn: (enabled: boolean) => adminPaymentsApi.update({ enabled }),
    onSuccess: (data) => {
      qc.setQueryData(QK, data)
      qc.invalidateQueries({ queryKey: ['billing'] })
      toast.success(data.switched_on ? 'Online payments switched on' : 'Online payments switched off')
    },
    onError: (e) => toast.fromError(e),
  })
  const ready = !!p.secret_key_hint && !!p.publishable_key
  return (
    <Card>
      <CardBody className="flex items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <CreditCard className="h-4 w-4 text-accent" /> Accept online payments
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {ready ? 'When off, the Upgrade buttons are disabled. Existing subscriptions keep renewing in Stripe.' : 'Add both Stripe keys to turn this on.'}
          </p>
        </div>
        <Switch checked={p.switched_on && ready} disabled={!ready || m.isPending} onChange={(v: boolean) => m.mutate(v)} label="Accept online payments" />
      </CardBody>
    </Card>
  )
}

export default function AdminPaymentsPage() {
  useDocumentTitle('Payments')
  const q = useQuery({ queryKey: QK, queryFn: adminPaymentsApi.get })
  return (
    <>
      <PageHeader title="Payments" description="Connect Stripe so customers can upgrade their plan by card." />
      {q.error ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : !q.data ? (
        <div className="space-y-6">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="max-w-3xl space-y-6">
          <Status p={q.data} />
          <Toggle p={q.data} />
          {q.data.mode === 'live' && (
            <Alert tone="warning" title="Live mode">
              Real cards are charged. Switch to test keys to try things out safely.
            </Alert>
          )}
          <KeysForm key={`${q.data.publishable_key}:${q.data.secret_key_hint}`} p={q.data} />
          <Alert tone="info" title="Customer portal">
            For the “Manage billing” button, save the customer portal once in Stripe: Settings → Billing → Customer portal.
          </Alert>
        </div>
      )}
    </>
  )
}
