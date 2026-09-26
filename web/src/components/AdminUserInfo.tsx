import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Mail, MailCheck, Pencil, Trash2 } from 'lucide-react'
import type { AdminAccountDetail } from '@/api/types'
import { ApiError } from '@/api/client'
import { adminEmailsApi } from '@/api/emails'
import { useAdminMutations } from '@/hooks/useConsole'
import { countries } from '@/lib/countries'
import { dateTime, num, relativeTime } from '@/lib/format'
import { Card, CardBody, CardHeader } from './ui/Card'
import { Avatar } from './ui/Avatar'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ErrorAlert } from './ui/ErrorMeta'
import { Field, Input, Select } from './ui/Input'
import { ConfirmDialog, Drawer } from './ui/Modal'
import { useToast } from './ui/toastContext'

const FIELDS = ['full_name', 'job_title', 'company', 'phone', 'country'] as const
type F = (typeof FIELDS)[number]

function EditDrawer({ a, open, onClose }: { a: AdminAccountDetail; open: boolean; onClose: () => void }) {
  const { patchAccount } = useAdminMutations()
  const toast = useToast()
  const countryList = useMemo(() => countries(), [])
  const init = Object.fromEntries(FIELDS.map((k) => [k, (a[k] as string | null | undefined) ?? ''])) as Record<F, string>
  const [f, setF] = useState(init)
  const [err, setErr] = useState<unknown>(null)
  const fe = err instanceof ApiError ? err.fieldErrors : {}
  const dirty = FIELDS.some((k) => f[k].trim() !== init[k])
  const label: Record<F, string> = { full_name: 'Full name', job_title: 'Job title', company: 'Company', phone: 'Phone', country: 'Country' }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit ${a.email}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!dirty || !f.full_name.trim()}
            loading={patchAccount.isPending}
            onClick={async () => {
              setErr(null)
              try {
                await patchAccount.mutateAsync({
                  id: a.id,
                  body: { full_name: f.full_name.trim(), job_title: f.job_title.trim() || null, company: f.company.trim() || null, phone: f.phone.trim() || null, country: f.country || null },
                })
                toast.success('Profile updated')
                onClose()
              } catch (e) {
                setErr(e)
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err != null && <ErrorAlert error={err} />}
        {FIELDS.map((k) => (
          <Field key={k} label={label[k]} optional={k !== 'full_name'} error={fe[k]}>
            {(p) =>
              k === 'country' ? (
                <Select {...p} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
                  <option value="">—</option>
                  {countryList.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...p} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={120} />
              )
            }
          </Field>
        ))}
      </div>
    </Drawer>
  )
}

/** Admin: user profile card with contact info, logins, memberships and quick actions (Part 3 §4). */
export function AdminUserInfo({ a }: { a: AdminAccountDetail }) {
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmAvatar, setConfirmAvatar] = useState(false)
  const [busy, setBusy] = useState<'verify' | 'avatar' | null>(null)
  const country = a.country ? (countries().find((c) => c.code === a.country)?.name ?? a.country) : null
  const rows: [string, string | null | undefined][] = [
    ['Job title', a.job_title],
    ['Company', a.company],
    ['Phone', a.phone],
    ['Country', country],
    ['Last login', a.last_login_at ? `${relativeTime(a.last_login_at)} · ${dateTime(a.last_login_at)}` : null],
    ['Logins', a.login_count != null ? num(a.login_count) : null],
  ]

  async function sendVerification() {
    setBusy('verify')
    try {
      const r = await adminEmailsApi.sendVerification(a.id)
      toast.success(r?.dev_verification_url ? `Sent. Dev link: ${r.dev_verification_url}` : `Verification link sent to ${a.email}.`)
      void qc.invalidateQueries({ queryKey: ['admin', 'account', a.id] })
    } catch (e) {
      toast.fromError(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Profile"
        actions={
          <Button size="sm" variant="ghost" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
            Edit
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar src={a.avatar_url} name={a.full_name} email={a.email} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{a.full_name || '—'}</p>
            <p className="truncate text-[13px] text-muted">{a.email}</p>
          </div>
          {a.avatar_url && (
            <Button size="icon-sm" variant="ghost" aria-label="Remove avatar" title="Remove avatar" onClick={() => setConfirmAvatar(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" leftIcon={<Mail className="h-3.5 w-3.5" />} onClick={() => navigate(`/admin/emails?tab=compose&users=${a.id}`)}>
            Send email
          </Button>
          {a.email_verified === false && (
            <Button size="sm" leftIcon={<MailCheck className="h-3.5 w-3.5" />} onClick={sendVerification} loading={busy === 'verify'}>
              Send verification link
            </Button>
          )}
        </div>
        <dl className="divide-y divide-border rounded-lg border border-border px-3">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[110px_1fr] gap-3 py-2 text-[13px]">
              <dt className="text-subtle">{k}</dt>
              <dd className="min-w-0 break-words">{v || <span className="text-subtle">—</span>}</dd>
            </div>
          ))}
        </dl>
        {!!a.memberships?.length && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-subtle uppercase">Memberships</p>
            <ul className="space-y-1.5">
              {a.memberships.map((m) => (
                <li key={m.business_id} className="flex items-center gap-2 text-[13px]">
                  <Building2 className="h-3.5 w-3.5 text-subtle" /> <span className="min-w-0 flex-1 truncate">{m.business_name}</span>
                  <Badge className="capitalize">{m.role}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!a.recent_logins?.length && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-subtle uppercase">Recent logins</p>
            <ul className="space-y-1 text-xs text-muted">
              {a.recent_logins.slice(0, 5).map((l, i) => (
                <li key={`${l.at}-${i}`} className="flex justify-between gap-2">
                  <span className="truncate" title={l.user_agent ?? undefined}>
                    {l.ip_address ?? '—'}
                  </span>
                  <span className="shrink-0">{relativeTime(l.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!a.email_logs?.length && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-subtle uppercase">Email history</p>
            <ul className="space-y-1.5">
              {a.email_logs.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-xs">
                  <Badge tone={e.status === 'failed' ? 'danger' : e.status === 'sent' ? 'success' : 'neutral'}>{e.status}</Badge>
                  <span className="min-w-0 flex-1 truncate">{e.subject}</span>
                  <span className="shrink-0 text-subtle">{relativeTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
      {editing && <EditDrawer a={a} open onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={confirmAvatar}
        onClose={() => setConfirmAvatar(false)}
        title="Remove this user’s avatar?"
        description="Use this for inappropriate images. The user can upload a new one."
        confirmLabel="Remove avatar"
        loading={busy === 'avatar'}
        onConfirm={async () => {
          setBusy('avatar')
          try {
            await adminEmailsApi.deleteAccountAvatar(a.id)
            toast.success('Avatar removed')
            setConfirmAvatar(false)
            void qc.invalidateQueries({ queryKey: ['admin'] })
          } catch (e) {
            toast.fromError(e)
          } finally {
            setBusy(null)
          }
        }}
      />
    </Card>
  )
}
