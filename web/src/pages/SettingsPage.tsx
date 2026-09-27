import { useState, type FormEvent } from 'react'
import { ScrollText } from 'lucide-react'
import { authApi } from '@/api/auth'
import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/context'
import { useAuditLogs } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { dateTime, shortId } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Input'
import { CountrySelect } from '@/components/CountrySelect'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { AvatarUploader } from '@/components/AvatarUploader'
import { Button } from '@/components/ui/Button'
import { Badge, type Tone } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/toastContext'
import { PasswordCard } from '@/components/PasswordCard'
import { AccountSecurity } from '@/components/AccountSecurity'

function ProfileCard() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const initial = {
    full_name: user?.full_name ?? '',
    phone: user?.phone ?? '',
    company: user?.company ?? '',
    country: user?.country ?? '',
    job_title: user?.job_title ?? '',
  }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k].trim() !== initial[k])
  const fe = err instanceof ApiError ? err.fieldErrors : {}
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setSaving(true)
    try {
      setUser(
        await authApi.updateMe({
          full_name: form.full_name.trim(),
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          country: form.country || undefined,
          job_title: form.job_title.trim() || null,
        }),
      )
      toast.success('Profile updated')
    } catch (e2) {
      setErr(e2)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardHeader title="Profile" description="Shown to your team and in the admin console." />
        <CardBody className="space-y-5">
          {err != null && <ErrorAlert error={err} />}
          <AvatarUploader
            src={user?.avatar_url}
            name={user?.full_name}
            email={user?.email}
            uploading={uploading}
            removing={removing}
            onUpload={async (file) => {
              setUploading(true)
              try {
                setUser(await authApi.uploadAvatar(file))
                toast.success('Photo updated')
              } catch (e2) {
                toast.fromError(e2, 'Upload failed')
                throw e2
              } finally {
                setUploading(false)
              }
            }}
            onRemove={async () => {
              setRemoving(true)
              try {
                setUser(await authApi.deleteAvatar())
                toast.success('Photo removed')
              } catch (e2) {
                toast.fromError(e2)
              } finally {
                setRemoving(false)
              }
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={fe.full_name}>
              {(p) => <Input {...p} value={form.full_name} onChange={set('full_name')} autoComplete="name" maxLength={120} />}
            </Field>
            <Field label="Email" hint="Contact support to change it.">
              {(p) => <Input {...p} value={user?.email ?? ''} disabled readOnly />}
            </Field>
            <Field label="Job title" optional error={fe.job_title}>
              {(p) => <Input {...p} value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" maxLength={120} />}
            </Field>
            <Field label="Company" optional error={fe.company}>
              {(p) => <Input {...p} value={form.company} onChange={set('company')} autoComplete="organization" maxLength={120} />}
            </Field>
            <Field label="Phone" optional error={fe.phone}>
              {(p) => <Input {...p} type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" maxLength={40} />}
            </Field>
            <Field label="Country" error={fe.country}>
              {(p) => <CountrySelect {...p} value={form.country} onChange={(country) => setForm((f) => ({ ...f, country }))} />}
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 text-[13px] text-muted">
            <Badge tone="accent" className="capitalize">
              {user?.role}
            </Badge>
            <Badge className="capitalize">{user?.plan} plan</Badge>
            <span>Member since {dateTime(user?.created_at)}</span>
            {user?.last_login_at && <span>· Last sign-in {dateTime(user.last_login_at)}</span>}
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty || !form.full_name.trim()}>
            Save profile
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function actionTone(action: string): Tone {
  if (/delete|revoke/.test(action)) return 'danger'
  if (/rotate|password/.test(action)) return 'warning'
  if (/create|register/.test(action)) return 'success'
  if (/login/.test(action)) return 'info'
  return 'neutral'
}

function AuditLogCard() {
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useAuditLogs(page)
  return (
    <Card>
      <CardHeader title="Audit log" description="Security-relevant activity on your account." />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={5} cols={4} />
      ) : !data?.items.length ? (
        <EmptyState icon={ScrollText} title="No activity yet" />
      ) : (
        <>
          <TableWrap>
            <Table className="min-w-[680px]">
              <THead>
                <tr>
                  <TH>Action</TH>
                  <TH>Resource</TH>
                  <TH>IP address</TH>
                  <TH>When</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <Badge tone={actionTone(l.action)} className="font-mono">
                        {l.action}
                      </Badge>
                    </TD>
                    <TD className="text-muted">
                      {l.resource_type ?? '—'}
                      {l.resource_id && <span className="ml-1.5 font-mono text-[11.5px] text-subtle" title={l.resource_id}>{shortId(l.resource_id)}</span>}
                    </TD>
                    <TD className="font-mono text-[12px] text-muted" title={l.user_agent ?? undefined}>
                      {l.ip_address ?? '—'}
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{dateTime(l.created_at, true)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  )
}

export default function SettingsPage() {
  useDocumentTitle('Account Settings')
  return (
    <>
      <PageHeader title="Account Settings" description="Your profile, password, sign-in and account activity." />
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <ProfileCard />
          <PasswordCard />
        </div>
        <AccountSecurity />
        <AuditLogCard />
        <Card className="border-red-200 dark:border-red-900/50">
          <CardHeader title="Danger zone" />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[13.5px] font-medium">Delete account</p>
              <p className="text-[13px] text-muted">
                Self-service account deletion isn&apos;t available yet. Contact support to close your account and erase its data.
              </p>
            </div>
            <Button variant="danger-soft" disabled>
              Delete account
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
