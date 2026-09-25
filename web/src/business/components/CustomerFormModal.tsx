import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { useToast } from '@/components/ui/toastContext'
import type { Customer, CustomerInput } from '../api/types'
import { customersApi } from '../api/people'
import { useBusiness } from '../hooks/context'
import { useBizMutation } from '../hooks/queries'
import { fieldErrorsOf } from '../lib/errors'
import { normalizePhone } from '../lib/format'
import { FormError } from './BizError'
import { TagsInput } from './inputs'

export function CustomerFormModal({ customer, onClose, onCreated }: { customer: Customer | null; onClose: () => void; onCreated?: (c: Customer) => void }) {
  const { business } = useBusiness()
  const toast = useToast()
  const [f, setF] = useState<Required<CustomerInput>>(() => ({
    full_name: customer?.full_name ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    company: customer?.company ?? '',
    notes: customer?.notes ?? '',
    tags: customer?.tags ?? [],
  }))
  const save = useBizMutation(business.id, (body: CustomerInput) => (customer ? customersApi.update(business.id, customer.id, body) : customersApi.create(business.id, body)))
  const errs = fieldErrorsOf(save.error)
  const emailBad = f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) ? 'Enter a valid email address.' : null
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const saved = await save.mutateAsync({
        full_name: f.full_name.trim(),
        email: f.email?.trim() || null,
        phone: f.phone?.trim() ? normalizePhone(f.phone) : null,
        company: f.company?.trim() || null,
        notes: f.notes?.trim() || null,
        tags: f.tags,
      })
      toast.success(customer ? 'Customer updated' : `${saved.full_name} added`)
      if (!customer) onCreated?.(saved)
      onClose()
    } catch {
      /* inline */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={customer ? `Edit ${customer.full_name}` : 'Add customer'}
      description={customer ? undefined : 'Customers can hold loyalty or membership cards. Taps are attributed to them.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="customer-form" loading={save.isPending} disabled={!f.full_name.trim() || !!emailBad}>
            {customer ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={save.error && !Object.keys(errs).length ? save.error : null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errs.full_name} className="sm:col-span-2">
            {(p) => <Input {...p} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} maxLength={120} data-autofocus />}
          </Field>
          <Field label="Email" optional error={errs.email ?? emailBad}>
            {(p) => <Input {...p} type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} />}
          </Field>
          <Field label="Phone" optional error={errs.phone}>
            {(p) => <Input {...p} type="tel" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+14155550123" />}
          </Field>
          <Field label="Company" optional error={errs.company} className="sm:col-span-2">
            {(p) => <Input {...p} value={f.company ?? ''} onChange={(e) => setF({ ...f, company: e.target.value })} maxLength={120} />}
          </Field>
          <Field label="Tags" optional hint="e.g. VIP, loyalty, wholesale. Press Enter to add." className="sm:col-span-2">
            {(p) => <TagsInput id={p.id} value={f.tags ?? []} onChange={(tags) => setF({ ...f, tags })} />}
          </Field>
          <Field label="Notes" optional hint="Internal only — never shown to the customer." className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={3} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />}
          </Field>
        </div>
      </form>
    </Modal>
  )
}
