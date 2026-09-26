import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, CheckCircle2, Loader2, Smartphone, Trash2, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useDebounced } from '@/hooks/useDebounce'
import { countries } from '@/lib/countries'
import { checkEndpointUrl } from '@/lib/url'
import { ApiError } from '@/api/client'
import type { Business, UpdateBusinessRequest } from '../api/types'
import { businessApi } from '../api/business'
import { useBusiness, useCan } from '../hooks/context'
import { bk, useBizMutation, useCategories } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { fieldErrorsOf, formLevelError } from '../lib/errors'
import { SLUG_RE, isE164, normalizePhone } from '../lib/format'
import { FormError } from '../components/BizError'
import { ImageUpload } from '../components/inputs'

function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Africa/Kigali', 'Asia/Tokyo']
  }
}

type Form = Required<Pick<Business, 'name' | 'slug'>> & {
  email: string
  phone: string
  country: string
  category: string
  description: string
  website: string
  address: string
  timezone: string
}

const toForm = (b: Business): Form => ({
  name: b.name,
  slug: b.slug,
  email: b.email ?? '',
  phone: b.phone ?? '',
  country: b.country ?? '',
  category: b.category ?? '',
  description: b.description ?? '',
  website: b.website ?? '',
  address: b.address ?? '',
  timezone: b.settings.timezone || 'UTC',
})

function InfoForm() {
  const { business } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const onError = useErrorToast()
  const categories = useCategories()
  const tzs = useMemo(() => timezones(), [])
  const [f, setF] = useState<Form>(() => toForm(business))
  const initial = useMemo(() => JSON.stringify(toForm(business)), [business])
  const dirty = JSON.stringify(f) !== initial
  const save = useBizMutation(business.id, (body: UpdateBusinessRequest) => businessApi.update(business.id, body))
  const logo = useBizMutation(business.id, (file: File) => businessApi.uploadLogo(business.id, file))
  const errs = fieldErrorsOf(save.error)
  const slugTaken = save.error instanceof ApiError && save.error.status === 409 && /slug/.test(save.error.code + JSON.stringify(save.error.details ?? ''))
  const manage = can('settings.manage')
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }))

  // Live availability (debounced) for a changed, well-formed slug.
  const dSlug = useDebounced(f.slug, 400)
  const checkSlug = dSlug !== business.slug && SLUG_RE.test(dSlug)
  const avail = useQuery({ queryKey: ['slug-available', dSlug], queryFn: () => businessApi.slugAvailable(dSlug), enabled: checkSlug && manage, staleTime: 30_000, retry: false })
  const slugPending = f.slug !== business.slug && SLUG_RE.test(f.slug) && (f.slug !== dSlug || avail.isFetching)
  const slugUnavailable = checkSlug && f.slug === dSlug && avail.data?.available === false
  const slugErr = !SLUG_RE.test(f.slug)
    ? 'Use 3–48 lowercase letters, numbers or dashes.'
    : slugTaken
      ? 'That URL is already taken — try another.'
      : slugUnavailable
        ? `Not available${avail.data?.reason ? ` (${avail.data.reason.replace(/_/g, ' ')})` : ''} — try another.`
        : errs.slug
  const emailErr = f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) ? 'Enter a valid email address.' : errs.email
  const webCheck = f.website ? checkEndpointUrl(f.website) : null
  const webErr = f.website && !/^https?:\/\//.test(f.website) ? 'Start with https://' : errs.website
  const phoneHint = f.phone && !isE164(normalizePhone(f.phone)) ? 'Use international format, e.g. +14155550123.' : undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await save.mutateAsync({
        name: f.name.trim(),
        ...(f.slug !== business.slug ? { slug: f.slug } : {}),
        email: f.email.trim(),
        phone: f.phone.trim() ? normalizePhone(f.phone) : '',
        country: f.country,
        category: f.category,
        description: f.description.trim(),
        website: f.website.trim() || null,
        address: f.address.trim() || null,
        settings: { timezone: f.timezone },
      })
      toast.success('Business settings saved')
    } catch {
      /* inline */
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Business information"
          description="Shown on your public business page and in the nexTap app."
          actions={
            business.verified ? (
              <Badge tone="success" className="gap-1">
                <BadgeCheck className="h-3.5 w-3.5" /> Verified
              </Badge>
            ) : (
              <Badge tone="warning">Not verified</Badge>
            )
          }
        />
        <CardBody className="space-y-5">
          <FormError error={slugTaken ? null : formLevelError(save.error, ['address', 'category', 'country', 'description', 'email', 'name', 'phone', 'slug', 'website'])} />
          <ImageUpload
            name={business.name}
            src={business.logo_url}
            shape="square"
            label="Upload logo"
            disabled={!manage}
            loading={logo.isPending}
            onError={(m) => toast.error(m)}
            onUpload={async (file) => {
              try {
                await logo.mutateAsync(file)
                toast.success('Logo updated')
              } catch (err) {
                onError(err)
              }
            }}
          />
          <fieldset disabled={!manage} className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" error={errs.name}>
              {(p) => <Input {...p} value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />}
            </Field>
            <Field
              label="Public URL"
              error={slugErr}
              hint={
                f.slug !== business.slug && SLUG_RE.test(f.slug) ? (
                  <span className="inline-flex items-center gap-1 text-muted">
                    {slugPending ? 'Checking availability… ' : avail.data?.available ? 'Available. ' : ''}The old URL keeps redirecting for 90 days.
                  </span>
                ) : (
                  <span className="break-all">{`${window.location.origin}/b/${f.slug}`}</span>
                )
              }
            >
              {(p) => (
                <div className="relative">
                  <Input {...p} value={f.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))} className="pr-8 font-mono" maxLength={48} />
                  {f.slug !== business.slug && (
                    <span className="absolute top-1/2 right-2.5 -translate-y-1/2">
                      {slugErr ? (
                        <XCircle className="h-4 w-4 text-red-500" />
                      ) : slugPending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-subtle" aria-label="Checking" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Available" />
                      )}
                    </span>
                  )}
                </div>
              )}
            </Field>
            <Field label="Email" error={emailErr}>
              {(p) => <Input {...p} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />}
            </Field>
            <Field label="Phone" error={errs.phone} hint={phoneHint}>
              {(p) => <Input {...p} type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+14155550123" />}
            </Field>
            <Field label="Country" error={errs.country}>
              {(p) => (
                <Select {...p} value={f.country} onChange={(e) => set('country', e.target.value)}>
                  <option value="">Select a country…</option>
                  {countries().map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Category" error={errs.category}>
              {(p) => (
                <Select {...p} value={f.category} onChange={(e) => set('category', e.target.value)} disabled={categories.isLoading || !manage}>
                  <option value="">Select a category…</option>
                  {(categories.data ?? []).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                  {f.category && categories.data && !categories.data.some((c) => c.code === f.category) && <option value={f.category}>{f.category}</option>}
                </Select>
              )}
            </Field>
            <Field label="Description" error={errs.description} className="sm:col-span-2">
              {(p) => <Textarea {...p} rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} />}
            </Field>
            <Field label="Website" optional error={webErr} hint={webCheck?.level === 'warn' ? (webCheck.message ?? undefined) : undefined}>
              {(p) => <Input {...p} type="url" value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />}
            </Field>
            <Field label="Address" optional error={errs.address}>
              {(p) => <Input {...p} value={f.address} onChange={(e) => set('address', e.target.value)} />}
            </Field>
            <Field label="Time zone" hint="Used for analytics days and opening hours." className="sm:col-span-2">
              {(p) => (
                <Select {...p} value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  {!tzs.includes(f.timezone) && <option value={f.timezone}>{f.timezone}</option>}
                  {tzs.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </fieldset>
        </CardBody>
        {manage && (
          <CardFooter>
            {dirty && (
              <Button onClick={() => setF(toForm(business))} disabled={save.isPending}>
                Discard
              </Button>
            )}
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty || !f.name.trim() || !!slugErr || slugPending || !!emailErr || !!webErr}>
              Save changes
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}

function DeviceSettings() {
  const { business } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const onError = useErrorToast()
  const save = useBizMutation(business.id, (v: boolean) => businessApi.update(business.id, { settings: { devices_can_register_cards: v } }))
  const value = business.settings.devices_can_register_cards
  return (
    <Card id="devices">
      <CardHeader title="Device settings" description="What your nexTap phones are allowed to do." />
      <CardBody>
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-subtle" />
            <div>
              <p className="text-[13.5px] font-medium">Devices can register and program cards</p>
              <p className="text-[13px] text-muted">
                When on, staff can register an unknown card straight from the phone and write tap links to new cards. Turn off to manage cards only from this
                dashboard.
              </p>
            </div>
          </div>
          <Switch
            checked={value}
            disabled={!can('settings.manage') || save.isPending}
            label="Devices can register and program cards"
            onChange={async (v) => {
              try {
                await save.mutateAsync(v)
                toast.success(v ? 'Devices can now register cards' : 'Card registration from devices turned off')
              } catch (e) {
                onError(e)
              }
            }}
          />
        </div>
      </CardBody>
    </Card>
  )
}

function DangerZone() {
  const { business } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const onError = useErrorToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const del = useBizMutation(business.id, () => businessApi.remove(business.id))
  if (!can('business.delete')) return null
  return (
    <Card className="border-red-200 dark:border-red-900/50">
      <CardHeader title="Danger zone" />
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[13.5px] font-medium">Delete this business</p>
          <p className="text-[13px] text-muted">Revokes all devices and API keys, unpublishes every profile and disables every card and tag. Only owners can do this.</p>
        </div>
        <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setOpen(true)}>
          Delete business
        </Button>
      </CardBody>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false)
          setTyped('')
        }}
        title={`Delete ${business.name}?`}
        description="Customers tapping your cards will see a neutral page. Team members lose access. This can’t be undone from the dashboard."
        confirmLabel="Delete business"
        confirmText={business.name}
        typed={typed}
        onTypedChange={setTyped}
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(undefined)
            qc.removeQueries({ queryKey: bk.scope(business.id) })
            toast.success(`${business.name} deleted`)
            navigate('/business', { replace: true })
          } catch (e) {
            onError(e)
          }
        }}
      />
    </Card>
  )
}

export default function SettingsPage() {
  const { business } = useBusiness()
  const can = useCan()
  useDocumentTitle('Business Settings')
  return (
    <>
      <PageHeader title="Business Settings" description="Your business profile, URL, devices and more." />
      <div className="space-y-6">
        {!can('settings.manage') && <Alert tone="info">You can view these settings. Changing them requires the “Manage business settings” permission.</Alert>}
        <InfoForm key={JSON.stringify(toForm(business))} />
        <DeviceSettings />
        <DangerZone />
      </div>
    </>
  )
}
