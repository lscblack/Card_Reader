import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Plug, Plus } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { getLastBusiness } from '@/business/lib/lastBusiness'
import { ApiError } from '@/api/client'
import type { DeliveryMode } from '@/api/types'
import { useCreateApplication } from '@/hooks/queries'
import { checkEndpointUrl } from '@/lib/url'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Field, Input, Textarea } from './ui/Input'
import { ErrorAlert } from './ui/ErrorMeta'
import { SecretsModal, type OneTimeSecret } from './SecretsModal'
import { DeliveryModePicker } from './DeliveryModePicker'

export function CreateApplicationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateApplication()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [mode, setMode] = useState<DeliveryMode>('relay')
  const [error, setError] = useState<unknown>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // One-time secrets live ONLY here, and are cleared as soon as the dialog is dismissed.
  const [secrets, setSecrets] = useState<{ appId: string; items: OneTimeSecret[] } | null>(null)

  const urlCheck = checkEndpointUrl(endpointUrl)

  const reset = () => {
    setName('')
    setDescription('')
    setEndpointUrl('')
    setMode('relay')
    setError(null)
    setFieldErrors({})
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    try {
      const res = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        delivery_mode: mode,
        endpoint_url: endpointUrl.trim() || undefined,
      })
      reset()
      onClose()
      setSecrets({
        appId: res.application.id,
        items: [
          { label: 'API key', value: res.api_key_plaintext, hint: 'Used once by the phone app to register' },
          { label: 'Webhook signing secret', value: res.webhook_secret_plaintext, hint: 'Verify X-NFC-Signature on your server' },
        ],
      })
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors)
      setError(err)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          reset()
          onClose()
        }}
        title="Create application"
        description="An application groups devices, API keys and a delivery endpoint."
        size="lg"
        footer={
          <>
            <Button onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-app-form"
              loading={create.isPending}
              disabled={!name.trim() || urlCheck.level === 'error'}
            >
              Create application
            </Button>
          </>
        }
      >
        <form id="create-app-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          {error != null && (
            <ErrorAlert error={error} />
          )}
          <Field label="Name" error={fieldErrors.name}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Front desk check-in" maxLength={120} data-autofocus />}
          </Field>
          <Field label="Description" optional error={fieldErrors.description}>
            {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />}
          </Field>
          <Field
            label="Endpoint URL"
            optional
            error={fieldErrors.endpoint_url ?? (urlCheck.level === 'error' ? urlCheck.message : null)}
            hint={urlCheck.level === 'warn' ? urlCheck.message : 'Where card events are POSTed. You can set this later.'}
          >
            {(p) => (
              <Input
                {...p}
                type="url"
                inputMode="url"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
                placeholder="https://api.example.com/nfc/card"
                spellCheck={false}
              />
            )}
          </Field>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Delivery mode</p>
            <DeliveryModePicker value={mode} onChange={setMode} compact />
          </div>
          <p className="text-xs text-subtle">
            A first API key and a webhook signing secret are generated automatically and shown once.
          </p>
        </form>
      </Modal>

      <SecretsModal
        open={!!secrets}
        title="Application created"
        description="Save these credentials now."
        secrets={secrets?.items ?? []}
        warning="The API key is stored only as a hash and the signing secret only encrypted — neither can be shown again. If you lose one, create a new API key or rotate the secret."
        onClose={() => {
          const id = secrets?.appId
          setSecrets(null)
          if (id) navigate(`/dashboard/applications/${id}`)
        }}
      />
    </>
  )
}

/**
 * "New application" action for the developer dashboard. Business accounts can't create developer applications
 * (the API answers 403) — their applications live in the business dashboard's API / Integrations page instead.
 */
export function NewApplicationButton({ onCreate, label = 'New application', variant = 'primary', ...rest }: { onCreate: () => void; label?: string; variant?: 'primary' | 'secondary'; 'data-tour'?: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  if (user?.account_type === 'business' && user.role !== 'admin') {
    const bid = user.memberships?.find((m) => m.business_id === getLastBusiness())?.business_id ?? user.memberships?.[0]?.business_id
    return (
      <Button variant={variant} leftIcon={<Plug className="h-4 w-4" />} onClick={() => navigate(bid ? `/business/${bid}/integrations` : '/business')} data-tour={rest['data-tour']}>
        Business integrations
      </Button>
    )
  }
  return (
    <Button variant={variant} leftIcon={<Plus className="h-4 w-4" />} onClick={onCreate} data-tour={rest['data-tour']}>
      {label}
    </Button>
  )
}
