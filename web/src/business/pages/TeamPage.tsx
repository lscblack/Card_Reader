import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Ban, LogOut, MailPlus, RefreshCw, ShieldCheck, Trash2, UserCog, UserMinus, UsersRound } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Input'
import { Menu } from '@/components/ui/Menu'
import { Alert } from '@/components/ui/Alert'
import { CopyButton } from '@/components/ui/CopyButton'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { dateOnly, relativeTime } from '@/lib/format'
import type { BusinessRole, Invitation, Member, Permission } from '../api/types'
import { teamApi } from '../api/team'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, useInvitations, useMembers } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { fieldErrorsOf, formLevelError } from '../lib/errors'
import { GRANTABLE_PERMISSIONS, PERMISSION_LABELS, ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS } from '../lib/permissions'
import { Avatar, RoleBadge } from '../components/bits'
import { BizErrorState, FormError } from '../components/BizError'

function EditMemberModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const { business, me } = useBusiness()
  const toast = useToast()
  const [role, setRole] = useState<BusinessRole>(member.role)
  const [extra, setExtra] = useState<Permission[]>(member.extra_permissions)
  const save = useBizMutation(business.id, () => teamApi.updateMember(business.id, member.id, { role, extra_permissions: extra.filter((p) => !ROLE_PERMISSIONS[role].includes(p)) }))
  const isOwner = me?.role === 'owner'
  const roles = ROLES.filter((r) => r !== 'owner' || isOwner)
  const grantable = GRANTABLE_PERMISSIONS.filter((p) => !ROLE_PERMISSIONS[role].includes(p))
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Role & permissions — ${member.full_name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync(undefined)
                toast.success('Member updated')
                onClose()
              } catch {
                /* inline */
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormError error={save.error} />
        <div className="space-y-2" role="radiogroup" aria-label="Role">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors', role === r ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}
            >
              <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', role === r ? 'border-accent' : 'border-border-strong')}>
                {role === r && <span className="h-2 w-2 rounded-full bg-accent" />}
              </span>
              <span>
                <span className="block text-[13.5px] font-semibold">{ROLE_LABELS[r]}</span>
                <span className="block text-[13px] text-muted">{ROLE_DESCRIPTIONS[r]}</span>
              </span>
            </button>
          ))}
        </div>
        {grantable.length > 0 && (
          <div>
            <p className="mb-1 text-[13px] font-medium">Extra permissions</p>
            <p className="mb-2 text-xs text-subtle">Grant specific abilities on top of the role. Billing, deleting the business and ownership transfer can’t be granted.</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {grantable.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={extra.includes(p)}
                    onChange={(e) => setExtra(e.target.checked ? [...extra, p] : extra.filter((x) => x !== p))}
                    className="h-4 w-4 rounded border-border-strong accent-[var(--accent)]"
                  />
                  {PERMISSION_LABELS[p]}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function InviteForm({ onInvited }: { onInvited: (i: Invitation) => void }) {
  const { business, me } = useBusiness()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<BusinessRole>('staff')
  const invite = useBizMutation(business.id, () => teamApi.invite(business.id, { email: email.trim(), role }))
  const errs = fieldErrorsOf(invite.error)
  const bad = email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const inv = await invite.mutateAsync(undefined)
      toast.success(`Invitation sent to ${inv.email}`)
      setEmail('')
      onInvited(inv)
    } catch {
      /* inline */
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError error={formLevelError(invite.error, ['email'])} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Email" error={errs.email ?? (bad ? 'Enter a valid email address.' : null)} className="min-w-0 flex-1">
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />}
        </Field>
        <Field label="Role" className="sm:w-40">
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as BusinessRole)}>
              {ROLES.filter((r) => r !== 'owner' || me?.role === 'owner').map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="primary" leftIcon={<MailPlus className="h-4 w-4" />} loading={invite.isPending} disabled={!email || !!bad}>
          Send invite
        </Button>
      </div>
      <p className="text-xs text-subtle">{ROLE_DESCRIPTIONS[role]} The link expires after 7 days.</p>
    </form>
  )
}

const INV_TONE = { pending: 'info', accepted: 'success', revoked: 'neutral', expired: 'warning' } as const

export default function TeamPage() {
  const { business, me } = useBusiness()
  const { user } = useAuth()
  const can = useCan()
  const now = useNow()
  const toast = useToast()
  const onError = useErrorToast()
  useDocumentTitle('Team Members')
  const members = useMembers(business.id)
  const manage = can('team.manage')
  const invitations = useInvitations(business.id, manage)
  const [editing, setEditing] = useState<Member | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'suspend' | 'leave'; m: Member } | null>(null)
  const navigate = useNavigate()
  const [devUrl, setDevUrl] = useState<string | null>(null)
  const update = useBizMutation(business.id, (v: { m: Member; status: 'active' | 'suspended' }) => teamApi.updateMember(business.id, v.m.id, { status: v.status }))
  const remove = useBizMutation(business.id, (m: Member) => teamApi.removeMember(business.id, m.id))
  const revoke = useBizMutation(business.id, (i: Invitation) => teamApi.revoke(business.id, i.id))
  const resend = useBizMutation(business.id, (i: Invitation) => teamApi.resend(business.id, i.id))
  const isSelf = (m: Member) => !!user && (m.user_id === user.id || m.email.toLowerCase() === user.email.toLowerCase())
  const canEdit = (m: Member) => manage && !isSelf(m) && (m.role !== 'owner' || me?.role === 'owner')

  return (
    <>
      <PageHeader title="Team Members" description="People who can sign in to this business dashboard, and what they’re allowed to do." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Members" description={members.data ? `${members.data.length} people` : undefined} />
          {members.error ? (
            <BizErrorState error={members.error} onRetry={() => members.refetch()} />
          ) : members.isLoading ? (
            <SkeletonRows rows={4} cols={4} />
          ) : !members.data?.length ? (
            <EmptyState icon={UsersRound} title="No members" />
          ) : (
            <TableWrap>
              <Table className="min-w-[760px]">
                <THead>
                  <tr>
                    <TH>Member</TH>
                    <TH>Role</TH>
                    <TH>Extra permissions</TH>
                    <TH>Status</TH>
                    <TH>Joined</TH>
                    <TH>Last active</TH>
                    <TH className="text-right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {members.data.map((m) => (
                    <TR key={m.id}>
                      <TD className="max-w-[260px]">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={m.full_name} size={32} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium">
                              <span className="truncate">{m.full_name}</span>
                              {isSelf(m) && <Badge tone="accent">You</Badge>}
                            </span>
                            <span className="block truncate text-xs text-subtle">{m.email}</span>
                          </span>
                        </span>
                      </TD>
                      <TD>
                        <RoleBadge role={m.role} />
                      </TD>
                      <TD className="max-w-[240px]">
                        {m.extra_permissions.length ? (
                          <span className="flex flex-wrap gap-1">
                            {m.extra_permissions.map((p) => (
                              <Badge key={p} title={PERMISSION_LABELS[p]}>
                                {p}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={m.status === 'active' ? 'success' : 'warning'} dot>
                          {m.status === 'active' ? 'Active' : 'Suspended'}
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-muted">{dateOnly(m.joined_at)}</TD>
                      <TD className="whitespace-nowrap text-muted">{relativeTime(m.last_active_at, now)}</TD>
                      <TD className="text-right">
                        {isSelf(m) && !(m.role === 'owner' && (members.data ?? []).filter((x) => x.role === 'owner' && x.status === 'active').length <= 1) && (
                          <Button size="sm" variant="ghost" leftIcon={<LogOut className="h-3.5 w-3.5" />} onClick={() => setConfirm({ kind: 'leave', m })}>
                            Leave
                          </Button>
                        )}
                        {canEdit(m) && (
                          <Menu
                            label={`Actions for ${m.full_name}`}
                            items={[
                              { label: 'Change role & permissions', icon: <UserCog className="h-4 w-4 text-subtle" />, onSelect: () => setEditing(m) },
                              m.status === 'active'
                                ? { label: 'Suspend', icon: <Ban className="h-4 w-4 text-subtle" />, onSelect: () => setConfirm({ kind: 'suspend', m }) }
                                : {
                                    label: 'Reactivate',
                                    icon: <ShieldCheck className="h-4 w-4 text-subtle" />,
                                    onSelect: async () => {
                                      try {
                                        await update.mutateAsync({ m, status: 'active' })
                                        toast.success(`${m.full_name} reactivated`)
                                      } catch (e) {
                                        onError(e)
                                      }
                                    },
                                  },
                              { label: 'Remove from business', icon: <UserMinus className="h-4 w-4" />, danger: true, onSelect: () => setConfirm({ kind: 'remove', m }) },
                            ]}
                          />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        {manage && (
          <Card>
            <CardHeader title="Invite people" description="They get an email with a link to join. New users can create an account from the link." />
            <CardBody className="space-y-4">
              <InviteForm onInvited={(i) => setDevUrl(i.dev_invite_url ?? null)} />
              {devUrl && (
                <Alert tone="info" title="Development: invitation link">
                  <span className="flex items-center gap-1">
                    <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{devUrl}</code>
                    <CopyButton value={devUrl} label="Copy invite link" />
                  </span>
                </Alert>
              )}
            </CardBody>
            {invitations.error ? (
              <BizErrorState error={invitations.error} onRetry={() => invitations.refetch()} />
            ) : invitations.isLoading ? (
              <SkeletonRows rows={2} cols={4} />
            ) : invitations.data?.length ? (
              <div className="border-t border-border">
                <TableWrap>
                  <Table className="min-w-[640px]">
                    <THead>
                      <tr>
                        <TH>Email</TH>
                        <TH>Role</TH>
                        <TH>Status</TH>
                        <TH>Expires</TH>
                        <TH className="text-right">
                          <span className="sr-only">Actions</span>
                        </TH>
                      </tr>
                    </THead>
                    <TBody>
                      {invitations.data.map((i) => (
                        <TR key={i.id}>
                          <TD className="font-medium">{i.email}</TD>
                          <TD>
                            <RoleBadge role={i.role} />
                          </TD>
                          <TD>
                            <Badge tone={INV_TONE[i.status]} className="capitalize">
                              {i.status}
                            </Badge>
                          </TD>
                          <TD className="whitespace-nowrap text-muted">{i.status === 'pending' ? relativeTime(i.expires_at, now) : '—'}</TD>
                          <TD className="text-right whitespace-nowrap">
                            {(i.status === 'pending' || i.status === 'expired') && (
                              <span className="inline-flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                                  onClick={async () => {
                                    try {
                                      const r = await resend.mutateAsync(i)
                                      setDevUrl(r.dev_invite_url ?? null)
                                      toast.success(`Invitation re-sent to ${i.email}`)
                                    } catch (e) {
                                      onError(e)
                                    }
                                  }}
                                >
                                  Resend
                                </Button>
                                {i.status === 'pending' && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                                    onClick={async () => {
                                      try {
                                        await revoke.mutateAsync(i)
                                        toast.success('Invitation revoked')
                                      } catch (e) {
                                        onError(e)
                                      }
                                    }}
                                  >
                                    Revoke
                                  </Button>
                                )}
                              </span>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
            ) : null}
          </Card>
        )}

        <Card>
          <CardHeader title="Roles" description="What each role can do." />
          <CardBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ROLES.map((r) => (
              <div key={r} className="rounded-lg border border-border p-3">
                <RoleBadge role={r} />
                <p className="mt-2 text-[13px] text-muted">{ROLE_DESCRIPTIONS[r]}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {editing && <EditMemberModal member={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'leave' ? `Leave ${business.name}?` : confirm?.kind === 'remove' ? `Remove ${confirm.m.full_name}?` : `Suspend ${confirm?.m.full_name}?`}
        description={
          confirm?.kind === 'leave'
            ? 'You lose access to this business immediately. An owner or admin can invite you again. (The last owner can’t leave.)'
            : confirm?.kind === 'remove'
              ? 'They lose access to this business immediately. Their own account is not deleted.'
              : 'They can’t access this business until you reactivate them.'
        }
        confirmLabel={confirm?.kind === 'leave' ? 'Leave business' : confirm?.kind === 'remove' ? 'Remove member' : 'Suspend'}
        loading={remove.isPending || update.isPending}
        onConfirm={async () => {
          if (!confirm) return
          try {
            if (confirm.kind === 'leave') {
              await remove.mutateAsync(confirm.m)
              toast.success(`You left ${business.name}`)
              navigate('/business', { replace: true })
              return
            }
            if (confirm.kind === 'remove') await remove.mutateAsync(confirm.m)
            else await update.mutateAsync({ m: confirm.m, status: 'suspended' })
            toast.success(confirm.kind === 'remove' ? 'Member removed' : 'Member suspended')
            setConfirm(null)
          } catch (e) {
            onError(e)
          }
        }}
      />
    </>
  )
}
