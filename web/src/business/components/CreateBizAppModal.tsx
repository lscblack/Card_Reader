import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { DeliveryModePicker } from '@/components/DeliveryModePicker'
import { checkEndpointUrl } from '@/lib/url'
import type { CreateApplicationResponse, DeliveryMode } from '@/api/types'
import { bizAppsApi } from '../api/integrations'
import { useBusiness } from '../hooks/context'
import { useBizMutation } from '../hooks/queries'
import { fieldErrorsOf } from '../lib/errors'
import { FormError } from './BizError'

/** `POST /businesses/{id}/applications` — the caller shows the one-time secrets. */
export function CreateBizAppModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: CreateApplicationResponse) => void }) {
  const { business } = useBusiness()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<DeliveryMode>('relay')
  const [url, setUrl] = useState('')
  const check = checkEndpointUrl(url)
  const create = useBizMutation(business.id, () =>
    bizAppsApi.create(business.id, { name: name.trim(), description: description.trim() || undefined, delivery_mode: mode, endpoint_url: url.trim() || undefined }),
  )
  const errs = fieldErrorsOf(create.error)
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      onCreated(await create.mutateAsync(undefined))
    } catch {
      /* shown inline */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New application"
      description="Connects your readers and card taps to your own systems with signed webhooks."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-biz-app" loading={create.isPending} disabled={!name.trim() || check.level === 'error'}>
            Create application
          </Button>
        </>
      }
    >
      <form id="new-biz-app" onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={create.error && !Object.keys(errs).length ? create.error : null} />
        <Field label="Name" error={errs.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="POS loyalty integration" data-autofocus />}
        </Field>
        <Field label="Description" optional error={errs.description}>
          {(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />}
        </Field>
        <Field
          label="Endpoint URL"
          optional
          error={errs.endpoint_url ?? (check.level === 'error' ? check.message : null)}
          hint={check.level === 'warn' ? (check.message ?? undefined) : 'Where signed events are delivered. You can set it later, or test with the Sandbox.'}
        >
          {(p) => <Input {...p} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/nfc" />}
        </Field>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium">Delivery mode</p>
          <DeliveryModePicker value={mode} onChange={setMode} compact />
        </div>
      </form>
    </Modal>
  )
}
