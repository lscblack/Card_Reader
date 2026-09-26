import { useState, type FormEvent } from 'react'
import { BadgeCheck, CreditCard, Lock, Send } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToast } from '@/components/ui/toastContext'
import { dateOnly } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isV2, type CardTemplate } from '@/personal/api/types'
import { DigitalCardRender } from '@/personal/components/DigitalCardRender'
import { TemplateGallery } from '@/personal/components/TemplateGallery'
import { ColorField } from '@/personal/components/editorBits'
import { DEFAULT_DESIGN } from '@/personal/lib/design'
import type { Employee } from '../api/types'
import { employeesApi } from '../api/people'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation } from '../hooks/queries'
import { fieldErrorsOf, formLevelError } from '../lib/errors'
import { FormError } from './BizError'

const LOCKABLE: { key: string; label: string }[] = [
  { key: 'company', label: 'Company' },
  { key: 'job_title', label: 'Job title' },
  { key: 'department', label: 'Department' },
  { key: 'logo', label: 'Logo' },
  { key: 'websites', label: 'Websites' },
  { key: 'emails', label: 'Work email' },
  { key: 'phones', label: 'Work phone' },
  { key: 'id_number', label: 'ID number' },
  { key: 'valid_until', label: 'Valid until' },
  { key: 'barcode_value', label: 'Barcode' },
]
const BADGE_LOCKS = ['company', 'id_number', 'valid_until', 'barcode_value']
const inAYear = () => {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

const STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  invited: { label: 'Invitation sent', tone: 'info' },
  inactive: { label: 'Inactive', tone: 'warning' },
  declined: { label: 'Declined', tone: 'neutral' },
}

function IssueModal({ employee, onClose, mode }: { employee: Employee; onClose: () => void; mode: 'card' | 'badge' }) {
  const { business } = useBusiness()
  const toast = useToast()
  const badgeMode = mode === 'badge'
  const [email, setEmail] = useState(employee.digital_card?.user_email ?? employee.email ?? '')
  const [tpl, setTpl] = useState<CardTemplate | null>(null)
  const [primary, setPrimary] = useState(DEFAULT_DESIGN.primary)
  const [locked, setLocked] = useState<string[]>(badgeMode ? BADGE_LOCKS : ['company', 'job_title', 'logo'])
  const [idNumber, setIdNumber] = useState(employee.employee_number ?? '')
  const [validUntil, setValidUntil] = useState(inAYear())
  const [barcode, setBarcode] = useState(employee.employee_number ?? '')
  const [devUrl, setDevUrl] = useState<string | null>(null)
  const badge = badgeMode ? { id_number: idNumber.trim() || undefined, valid_from: new Date().toISOString().slice(0, 10), valid_until: validUntil || undefined, barcode_value: (barcode || idNumber).trim() || undefined } : undefined
  const issue = useBizMutation(business.id, () =>
    employeesApi.issueDigitalCard(business.id, employee.id, { email: email.trim(), template_id: tpl?.id, design: { primary, accent: primary }, locked_fields: locked, ...(badge ? { badge } : {}) }),
  )
  const errs = fieldErrorsOf(issue.error)
  const bad = email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  const fields = {
    full_name: employee.full_name,
    job_title: employee.position,
    company: business.name,
    department: employee.department,
    phones: employee.phone ? [{ label: 'Work', value: employee.phone }] : [],
    emails: employee.email ? [{ label: 'Work', value: employee.email }] : [],
    websites: business.website ? [{ label: 'Website', url: business.website }] : [],
    socials: employee.social_links,
    custom_links: [],
    ...(badge ?? {}),
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const res = await issue.mutateAsync(undefined)
      toast.success(`Invitation sent to ${email.trim()}`)
      if (res?.dev_invite_url) setDevUrl(res.dev_invite_url)
      else onClose()
    } catch {
      /* inline */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={badgeMode ? `Issue an ID badge to ${employee.full_name}` : `Issue a digital card to ${employee.full_name}`}
      description="They get an email to accept it into their personal account (or create one). You keep company details and branding up to date."
      footer={
        devUrl ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="issue-card" leftIcon={<Send className="h-4 w-4" />} loading={issue.isPending} disabled={!email || !!bad}>
              Send invitation
            </Button>
          </>
        )
      }
    >
      {devUrl ? (
        <Alert tone="success" title="Invitation sent">
          <p>Development link (the email isn’t sent in development):</p>
          <span className="mt-1 flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{devUrl}</code>
            <CopyButton value={devUrl} label="Copy invite link" />
          </span>
        </Alert>
      ) : (
        <form id="issue-card" onSubmit={submit} className="space-y-5" noValidate>
          <FormError error={formLevelError(issue.error, ['email'])} />
          <Field label="Employee’s email" error={errs.email ?? (bad ? 'Enter a valid email address.' : null)} hint="Use the address they’ll sign in with.">
            {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus />}
          </Field>
          <div className="grid gap-5 md:grid-cols-[1fr_240px]">
            <div className="min-w-0 space-y-4">
              <div>
                <p className="mb-2 text-[13px] font-medium">Template</p>
                <TemplateGallery value={tpl?.id} onPick={setTpl} sample={{ fields, logo_url: business.logo_url, business: { name: business.name, logo_url: business.logo_url, verified: business.verified } }} columns="grid-cols-2" only={badgeMode ? ['badge'] : ['business', 'minimal', 'classic']} />
              </div>
              {badgeMode && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="ID number" hint={employee.employee_number ? 'From the employee number.' : undefined}>
                    {(p) => <Input {...p} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} maxLength={40} className="font-mono" />}
                  </Field>
                  <Field label="Valid until">{(p) => <Input {...p} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}</Field>
                  <Field label="Barcode" hint="Code 128; defaults to the ID number.">
                    {(p) => <Input {...p} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder={idNumber} maxLength={48} className="font-mono" />}
                  </Field>
                </div>
              )}
              <ColorField label="Company colour" value={primary} onChange={setPrimary} against="#ffffff" againstLabel="white" />
              <div>
                <p className="mb-1 text-[13px] font-medium">Locked fields</p>
                <p className="mb-2 text-xs text-subtle">The employee can’t change these; you update them for everyone.</p>
                <div className="flex flex-wrap gap-1.5">
                  {LOCKABLE.map((l) => {
                    const on = locked.includes(l.key)
                    return (
                      <button
                        key={l.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setLocked(on ? locked.filter((x) => x !== l.key) : [...locked, l.key])}
                        className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors', on ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-fg')}
                      >
                        {on && <Lock className="h-3 w-3" />} {l.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-[13px] font-medium">Preview</p>
              <DigitalCardRender
                template={tpl}
                layout={tpl && !isV2(tpl) ? tpl.layout : 'centered'}
                audience="all"
                qrValue={business.public_url ?? business.website ?? 'https://nexventures.net'}
                card={{ design: { ...(tpl?.default_design ?? DEFAULT_DESIGN), primary, accent: primary }, fields, photo_url: employee.photo_url, logo_url: business.logo_url, business: { name: business.name, logo_url: business.logo_url, verified: business.verified } }}
              />
            </div>
          </div>
        </form>
      )}
    </Modal>
  )
}

/** Employee page panel: status of the business-issued digital card + issue/resend. */
export function EmployeeDigitalCardPanel({ employee }: { employee: Employee }) {
  const can = useCan()
  const [open, setOpen] = useState<'card' | 'badge' | null>(null)
  const dc = employee.digital_card
  const st = dc ? (STATUS[dc.status] ?? { label: dc.status, tone: 'neutral' as const }) : null
  return (
    <Card>
      <CardHeader
        title="Digital card"
        description="A phone-to-phone card on the employee’s own account, with your branding."
        actions={st && <Badge tone={st.tone} dot>{st.label}</Badge>}
      />
      <CardBody className="space-y-3">
        {dc ? (
          <p className="text-[13px] text-muted">
            {dc.status === 'active' ? `Accepted by ${dc.user_email}${dc.accepted_at ? ` on ${dateOnly(dc.accepted_at)}` : ''}.` : dc.status === 'invited' ? `Waiting for ${dc.user_email} to accept.` : `Sent to ${dc.user_email}.`}
            {employee.status === 'inactive' && ' The card is disabled while the employee is inactive.'}
          </p>
        ) : (
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-subtle" /> Let {employee.first_name} share their details by tapping phones — no physical card needed.
          </p>
        )}
        {can('people.manage') && employee.status === 'active' && dc?.status !== 'active' && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={dc ? 'secondary' : 'primary'} leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => setOpen('card')}>
              {dc ? 'Resend invitation' : 'Issue digital card'}
            </Button>
            <Button size="sm" leftIcon={<BadgeCheck className="h-3.5 w-3.5" />} onClick={() => setOpen('badge')}>
              Issue ID badge
            </Button>
          </div>
        )}
      </CardBody>
      {open && <IssueModal employee={employee} mode={open} onClose={() => setOpen(null)} />}
    </Card>
  )
}
