import { useState, type FormEvent } from 'react'
import { Ban, KeyRound, Plus } from 'lucide-react'
import type { ApiKey } from '@/api/types'
import { useCreateApiKey, useRevokeApiKey } from '@/hooks/queries'
import { dateTime, maskedKey, relativeTime } from '@/lib/format'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from './ui/Table'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ConfirmDialog, Modal } from './ui/Modal'
import { Field, Input } from './ui/Input'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { EmptyState } from './ui/EmptyState'
import { useToast } from './ui/toastContext'
import { SecretsModal } from './SecretsModal'
import { AppSelect } from './AppSelect'

export function ApiKeysTable({ keys, showApp = true, onCreate }: { keys: ApiKey[]; showApp?: boolean; onCreate?: () => void }) {
  const revoke = useRevokeApiKey()
  const toast = useToast()
  const [target, setTarget] = useState<ApiKey | null>(null)

  if (!keys.length) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No API keys"
        description="API keys let the phone app register devices for an application."
        action={
          onCreate && (
            <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={onCreate}>
              Create API key
            </Button>
          )
        }
      />
    )
  }

  return (
    <>
      <TableWrap>
        <Table className="min-w-[640px]">
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Key</TH>
              {showApp && <TH>Application</TH>}
              <TH>Status</TH>
              <TH>Last used</TH>
              <TH>Created</TH>
              <TH className="text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {keys.map((k) => (
              <TR key={k.id}>
                <TD className="font-medium">{k.name}</TD>
                <TD>
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" translate="no">
                    {maskedKey(k.prefix, k.last4)}
                  </code>
                </TD>
                {showApp && <TD className="text-muted">{k.application_name}</TD>}
                <TD>
                  {k.is_active ? (
                    <Badge tone="success" dot>
                      Active
                    </Badge>
                  ) : (
                    <Badge tone="neutral" dot title={k.revoked_at ? `Revoked ${dateTime(k.revoked_at)}` : undefined}>
                      Revoked
                    </Badge>
                  )}
                </TD>
                <TD className="whitespace-nowrap text-muted" title={dateTime(k.last_used_at)}>
                  {relativeTime(k.last_used_at)}
                </TD>
                <TD className="whitespace-nowrap text-muted">{dateTime(k.created_at)}</TD>
                <TD className="text-right">
                  {k.is_active && (
                    <Button size="sm" variant="danger-soft" leftIcon={<Ban className="h-3.5 w-3.5" />} onClick={() => setTarget(k)}>
                      Revoke
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Revoke API key?"
        description={target ? `“${target.name}” (${maskedKey(target.prefix, target.last4)}) will stop working immediately.` : undefined}
        confirmLabel="Revoke key"
        loading={revoke.isPending}
        onConfirm={async () => {
          if (!target) return
          try {
            await revoke.mutateAsync(target.id)
            toast.success('API key revoked')
            setTarget(null)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      >
        <p className="text-[13px] text-muted">
          Devices that already registered keep working — they use their own device tokens. Revoke devices separately if needed.
        </p>
      </ConfirmDialog>
    </>
  )
}

export function CreateApiKeyModal({
  open,
  onClose,
  applicationId,
}: {
  open: boolean
  onClose: () => void
  /** Pre-select (and lock) an application. */
  applicationId?: string
}) {
  const create = useCreateApiKey()
  const [appId, setAppId] = useState(applicationId ?? '')
  const [name, setName] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const effectiveApp = applicationId ?? appId

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await create.mutateAsync({ application_id: effectiveApp, name: name.trim() })
      setName('')
      onClose()
      setPlaintext(res.plaintext)
    } catch (err) {
      setError(err)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Create API key"
        description="Use it in the phone app to register a device. It can't be retrieved later."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="create-key-form" loading={create.isPending} disabled={!effectiveApp || !name.trim()}>
              Create key
            </Button>
          </>
        }
      >
        <form id="create-key-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          {error != null && <ErrorAlert error={error} />}
          {!applicationId && (
            <Field label="Application">{(p) => <AppSelect id={p.id} value={appId} onChange={setAppId} className="sm:w-full" />}</Field>
          )}
          <Field label="Key name" hint="E.g. “Warehouse tablets” — helps you know what to revoke later.">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-autofocus />}
          </Field>
        </form>
      </Modal>
      <SecretsModal
        open={!!plaintext}
        title="API key created"
        secrets={plaintext ? [{ label: 'API key', value: plaintext }] : []}
        onClose={() => setPlaintext(null)}
      >
        <p className="text-[13px] text-muted">
          In the NFC Terminal app, choose <span className="font-medium text-fg">Register device</span> and paste this key (or scan it).
          The app exchanges it for a device token and then discards it.
        </p>
      </SecretsModal>
    </>
  )
}
