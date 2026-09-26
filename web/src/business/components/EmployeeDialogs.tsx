import { useState, type FormEvent } from 'react'
import { CreditCard, FileX2, RotateCcw } from 'lucide-react'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/toastContext'
import type { Employee, EmployeeInput, SocialLink } from '../api/types'
import { employeesApi } from '../api/people'
import { useBusiness } from '../hooks/context'
import { useBizMutation, useEmployees } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { fieldErrorsOf, formLevelError } from '../lib/errors'
import { isE164, normalizePhone } from '../lib/format'
import { FormError } from './BizError'
import { ImageUpload, SocialLinksEditor } from './inputs'

/** Create (employee = null) or edit an employee, including photo upload and social links. */
export function EmployeeFormModal({ open, onClose, employee, onCreated }: { open: boolean; onClose: () => void; employee: Employee | null; onCreated?: (e: Employee) => void }) {
  const { business } = useBusiness()
  const toast = useToast()
  const all = useEmployees(business.id, { page_size: 100 })
  const departments = [...new Set((all.data?.items ?? []).map((e) => e.department).filter(Boolean))] as string[]
  const [f, setF] = useState<EmployeeInput>(() => ({
    first_name: employee?.first_name ?? '',
    last_name: employee?.last_name ?? '',
    position: employee?.position ?? '',
    department: employee?.department ?? '',
    employee_number: employee?.employee_number ?? '',
    phone: employee?.phone ?? '',
    email: employee?.email ?? '',
    social_links: employee?.social_links ?? [],
  }))
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(employee?.photo_url ?? null)
  // Set once the employee exists: if the photo upload fails after a successful create, retrying must update that
  // employee instead of creating a duplicate.
  const [created, setCreated] = useState<Employee | null>(null)
  const save = useBizMutation(business.id, async (body: EmployeeInput) => {
    const target = employee ?? created
    const saved = target ? await employeesApi.update(business.id, target.id, body) : await employeesApi.create(business.id, body)
    if (!target) setCreated(saved)
    if (photo) return employeesApi.uploadPhoto(business.id, saved.id, photo)
    return saved
  })
  const errs = fieldErrorsOf(save.error)
  const set = (k: keyof EmployeeInput, v: string | SocialLink[]) => setF((x) => ({ ...x, [k]: v }))
  const phoneWarn = f.phone && !isE164(normalizePhone(f.phone)) ? 'Tip: use international format, e.g. +14155550123, so “Call” and WhatsApp work everywhere.' : undefined
  const emailBad = f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) ? 'Enter a valid email address.' : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    const body: EmployeeInput = {
      first_name: f.first_name.trim(),
      last_name: f.last_name.trim(),
      position: f.position?.trim() || null,
      department: f.department?.trim() || null,
      employee_number: f.employee_number?.trim() || null,
      phone: f.phone?.trim() ? normalizePhone(f.phone) : null,
      email: f.email?.trim() || null,
      social_links: (f.social_links ?? []).filter((l) => l.url.trim()),
    }
    try {
      const saved = await save.mutateAsync(body)
      toast.success(employee ? 'Employee updated' : `${saved.full_name} added. Their profile page is live.`)
      if (!employee) onCreated?.(saved)
      onClose()
    } catch {
      /* shown inline */
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={employee ? `Edit ${employee.full_name}` : 'Add employee'}
      description={employee ? undefined : 'Each employee gets a public digital business card. Assign them an NFC card afterwards.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="employee-form" loading={save.isPending} disabled={!f.first_name.trim() || !f.last_name.trim() || !!emailBad}>
            {employee ? 'Save changes' : 'Add employee'}
          </Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={formLevelError(save.error, ['department', 'employee_number', 'email', 'first_name', 'last_name', 'phone', 'position'])} />
        <ImageUpload
          name={`${f.first_name} ${f.last_name}`}
          src={preview}
          onUpload={(file) => {
            setPhoto(file)
            setPreview(URL.createObjectURL(file))
          }}
          onError={(m) => toast.error(m)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={errs.first_name}>
            {(p) => <Input {...p} value={f.first_name} onChange={(e) => set('first_name', e.target.value)} maxLength={80} autoComplete="off" data-autofocus />}
          </Field>
          <Field label="Last name" error={errs.last_name}>
            {(p) => <Input {...p} value={f.last_name} onChange={(e) => set('last_name', e.target.value)} maxLength={80} autoComplete="off" />}
          </Field>
          <Field label="Position" optional error={errs.position}>
            {(p) => <Input {...p} value={f.position ?? ''} onChange={(e) => set('position', e.target.value)} placeholder="Sales Manager" maxLength={120} />}
          </Field>
          <Field label="Department" optional error={errs.department}>
            {(p) => (
              <>
                <Input {...p} list="departments" value={f.department ?? ''} onChange={(e) => set('department', e.target.value)} placeholder="Sales" maxLength={80} />
                <datalist id="departments">
                  {departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Employee number" optional error={errs.employee_number} hint="Used as the ID number and barcode on ID badges.">
            {(p) => <Input {...p} value={f.employee_number ?? ''} onChange={(e) => set('employee_number', e.target.value)} placeholder="EMP-0042" maxLength={40} className="font-mono" />}
          </Field>
          <Field label="Phone" optional error={errs.phone} hint={phoneWarn}>
            {(p) => <Input {...p} type="tel" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} onBlur={() => f.phone && set('phone', normalizePhone(f.phone))} placeholder="+14155550123" />}
          </Field>
          <Field label="Email" optional error={errs.email ?? emailBad}>
            {(p) => <Input {...p} type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="john@company.com" />}
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">
            Social links <span className="font-normal text-subtle">(optional)</span>
          </p>
          <SocialLinksEditor value={f.social_links ?? []} onChange={(v) => set('social_links', v)} />
        </div>
      </form>
    </Modal>
  )
}

/** Strong confirmation: deactivation disables cards and unpublishes the profile immediately. */
export function EmployeeStatusDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const { business } = useBusiness()
  const toast = useToast()
  const onError = useErrorToast()
  const [typed, setTyped] = useState('')
  const toggle = useBizMutation(business.id, (e: Employee) => (e.status === 'active' ? employeesApi.deactivate(business.id, e.id) : employeesApi.activate(business.id, e.id)))
  if (!employee) return null
  const deactivating = employee.status === 'active'
  const activeCards = employee.cards.filter((c) => c.status === 'active').length
  const close = () => {
    setTyped('')
    onClose()
  }
  return (
    <ConfirmDialog
      open
      onClose={close}
      danger={deactivating}
      title={deactivating ? `Deactivate ${employee.full_name}?` : `Reactivate ${employee.full_name}?`}
      confirmLabel={deactivating ? 'Deactivate employee' : 'Reactivate'}
      confirmText={deactivating ? employee.full_name : undefined}
      typed={typed}
      onTypedChange={setTyped}
      loading={toggle.isPending}
      onConfirm={async () => {
        try {
          await toggle.mutateAsync(employee)
          toast.success(deactivating ? `${employee.full_name} deactivated. Their cards are disabled.` : `${employee.full_name} reactivated. Cards and profile restored.`)
          close()
        } catch (e) {
          onError(e)
        }
      }}
    >
      {deactivating ? (
        <div className="space-y-2.5 text-[13px]">
          <p className="text-muted">This takes effect immediately:</p>
          <ul className="space-y-2">
            <li className="flex gap-2.5">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <span>
                <strong>{activeCards === 1 ? '1 card stops' : `${activeCards} cards stop`} working.</strong> Anyone tapping them sees a neutral “not available” page.
              </span>
            </li>
            <li className="flex gap-2.5">
              <FileX2 className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <span>
                <strong>Their public profile is unpublished.</strong> Shared links stop working.
              </span>
            </li>
            <li className="flex gap-2.5">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
              <span className="text-muted">Reactivating restores both. Tap history is kept.</span>
            </li>
          </ul>
        </div>
      ) : (
        <p className="text-[13px] text-muted">Their cards start working again and their profile is republished right away.</p>
      )}
    </ConfirmDialog>
  )
}
