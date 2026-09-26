import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Activity, AlertTriangle, AppWindow, ArrowLeft, Clock, Smartphone } from 'lucide-react'
import type { AdminAccountDetail, AdminAccountPatch, RequestLog } from '@/api/types'
import { useAuth } from '@/auth/context'
import { usePlans } from '@/hooks/queries'
import { useAdminAccount, useAdminMutations } from '@/hooks/useConsole'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { dateTime, num, percent, relativeTime } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ActiveBadge, Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Select, Switch } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Spinner'
import { Tabs } from '@/components/ui/Tabs'
import { Table, TableWrap, TBody, TD, TH, THead } from '@/components/ui/Table'
import { useToast } from '@/components/ui/toastContext'
import { CopyButton } from '@/components/ui/CopyButton'
import { StatCard } from '@/components/StatCard'
import { AdminUserInfo } from '@/components/AdminUserInfo'
import { AdminDeviceTable } from '@/components/AdminDevices'
import { RequestLogDrawer, RequestLogTable } from '@/components/RequestLogs'

type Tab = 'apps' | 'devices' | 'logs' | 'audit'

interface Pending {
  body: AdminAccountPatch
  title: string
  description: string
  danger: boolean
}

function ManageCard({ a }: { a: AdminAccountDetail }) {
  const { user: me } = useAuth()
  const plans = usePlans()
  const { patchAccount } = useAdminMutations()
  const toast = useToast()
  const [pending, setPending] = useState<Pending | null>(null)
  const self = me?.id === a.id
  const audience = a.account_type ?? 'developer'
  const planOptions = (plans.data ?? []).filter((p) => !p.audience || p.audience === audience)

  const rows = [
    {
      label: 'Account active',
      hint: a.is_active ? 'Disabling signs the user out and blocks their API keys and devices.' : 'The user cannot sign in.',
      control: (
        <Switch
          checked={a.is_active}
          label="Account active"
          disabled={self}
          onChange={(v) =>
            setPending({
              body: { is_active: v },
              title: v ? 'Re-activate account?' : 'Disable account?',
              description: v ? `${a.email} will be able to sign in again.` : `${a.email} is signed out immediately and can no longer sign in.`,
              danger: !v,
            })
          }
        />
      ),
    },
    {
      label: 'Email verified',
      hint: 'Mark as verified if the user can’t receive the email.',
      control: (
        <Switch
          checked={!!a.email_verified}
          label="Email verified"
          onChange={(v) =>
            setPending({
              body: { email_verified: v },
              title: v ? 'Mark email as verified?' : 'Mark email as unverified?',
              description: v ? `${a.email} will be treated as verified.` : `${a.email} will be asked to verify again.`,
              danger: false,
            })
          }
        />
      ),
    },
    {
      label: 'Role',
      hint: 'Admins can see and change everything on the platform.',
      control: (
        <Select
          aria-label="Role"
          value={a.role}
          disabled={self}
          onChange={(e) => {
            const role = e.target.value as AdminAccountPatch['role']
            setPending({
              body: { role },
              title: role === 'admin' ? 'Grant admin access?' : 'Remove admin access?',
              description: role === 'admin' ? `${a.email} will get full access to the admin console.` : `${a.email} loses admin access.`,
              danger: role === 'admin',
            })
          }}
          className="w-36"
        >
          <option value="developer">User</option>
          <option value="admin">Admin</option>
        </Select>
      ),
    },
    {
      label: 'Plan',
      hint: 'Changes limits immediately. No payment is collected.',
      control: (
        <Select
          aria-label="Plan"
          value={a.plan}
          onChange={(e) =>
            setPending({
              body: { plan_code: e.target.value },
              title: 'Change plan?',
              description: `${a.email} moves from “${a.plan}” to “${e.target.value}”.`,
              danger: false,
            })
          }
          className="w-36"
        >
          {!planOptions.some((p) => p.code === a.plan) && <option value={a.plan}>{a.plan}</option>}
          {planOptions.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader title="Manage" description={self ? 'You can’t disable or demote your own account.' : 'Every change is confirmed and audited.'} />
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">{r.label}</p>
              <p className="text-xs text-subtle">{r.hint}</p>
            </div>
            {r.control}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending?.title ?? ''}
        description={pending?.description}
        danger={pending?.danger}
        confirmLabel="Confirm"
        loading={patchAccount.isPending}
        onConfirm={async () => {
          if (!pending) return
          try {
            await patchAccount.mutateAsync({ id: a.id, body: pending.body })
            toast.success('Account updated')
            setPending(null)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
    </Card>
  )
}

export default function AdminAccountDetailPage() {
  const { id } = useParams()
  const { data: a, isLoading, error, refetch } = useAdminAccount(id)
  const [tab, setTab] = useState<Tab>('apps')
  const [log, setLog] = useState<RequestLog | null>(null)
  useDocumentTitle(a ? `Admin · ${a.email}` : 'Admin · Account')

  return (
    <>
      <Link to="/admin/accounts" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Accounts
      </Link>
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !a ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-2.5">
                {a.full_name || a.email}
                <ActiveBadge active={a.is_active} inactiveLabel="Disabled" />
                <Badge tone={a.account_type === 'business' ? 'info' : a.account_type === 'personal' ? 'success' : 'neutral'}>{a.account_type ?? 'developer'}</Badge>
                {a.role === 'admin' && <Badge tone="accent">admin</Badge>}
                {a.email_verified === false && <Badge tone="warning">Unverified</Badge>}
              </span>
            }
            description={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{a.email}</span>
                <span className="inline-flex items-center gap-1 font-mono text-xs">
                  {a.id} <CopyButton value={a.id} label="Copy user ID" />
                </span>
                <span>Joined {dateTime(a.created_at)}</span>
                {a.business && (
                  <span>
                    Business: <span className="font-medium text-fg">{a.business.name}</span> ({a.business.status})
                  </span>
                )}
              </span>
            }
          />
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard label="Requests (24h)" value={num(a.stats.requests_24h)} icon={Activity} />
              <StatCard label="Error rate (24h)" value={a.stats.error_rate_24h == null ? '—' : percent(a.stats.error_rate_24h)} icon={AlertTriangle} />
              <StatCard label="Apps / devices" value={`${num(a.stats.applications)} / ${num(a.stats.devices)}`} icon={AppWindow} />
              <StatCard label="Last active" value={relativeTime(a.stats.last_active_at)} icon={Clock} hint={`${num(a.stats.events_30d)} events in 30 days`} />
            </div>
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0">
                <Tabs<Tab>
                  className="mb-4"
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { value: 'apps', label: 'Applications', count: a.applications?.length },
                    { value: 'devices', label: 'Devices', count: a.devices?.length },
                    { value: 'logs', label: 'Recent requests', count: a.recent_request_logs?.length },
                    { value: 'audit', label: 'Audit log', count: a.audit_logs?.length },
                  ]}
                />
                <Card>
                  {tab === 'apps' &&
                    (!a.applications?.length ? (
                      <EmptyState icon={AppWindow} title="No applications" />
                    ) : (
                      <TableWrap>
                        <Table className="min-w-[560px]">
                          <THead>
                            <tr>
                              <TH>Name</TH>
                              <TH>Mode</TH>
                              <TH>Endpoint</TH>
                              <TH className="text-right">Devices</TH>
                            </tr>
                          </THead>
                          <TBody>
                            {a.applications.map((app) => (
                              <tr key={app.id}>
                                <TD>
                                  <p className="font-medium">{app.name}</p>
                                  {app.deleted ? <Badge tone="danger">Deleted</Badge> : <ActiveBadge active={app.is_active} />}
                                </TD>
                                <TD>
                                  <Badge tone={app.delivery_mode === 'relay' ? 'accent' : 'info'}>{app.delivery_mode}</Badge>
                                </TD>
                                <TD className="max-w-[260px] truncate font-mono text-[12px] text-muted">{app.endpoint.url ?? '—'}</TD>
                                <TD className="text-right tabular-nums">{app.device_count}</TD>
                              </tr>
                            ))}
                          </TBody>
                        </Table>
                      </TableWrap>
                    ))}
                  {tab === 'devices' && (!a.devices?.length ? <EmptyState icon={Smartphone} title="No devices" /> : <AdminDeviceTable devices={a.devices} />)}
                  {tab === 'logs' &&
                    (!a.recent_request_logs?.length ? (
                      <EmptyState icon={Activity} title="No recent requests" />
                    ) : (
                      <>
                        <RequestLogTable logs={a.recent_request_logs} onSelect={setLog} showActor />
                        <div className="border-t border-border px-4 py-2.5 text-right sm:px-5">
                          <Link to={`/admin/logs?user_id=${a.id}`} className="text-[13px] font-medium text-accent hover:underline">
                            All requests for this account
                          </Link>
                        </div>
                      </>
                    ))}
                  {tab === 'audit' &&
                    (!a.audit_logs?.length ? (
                      <EmptyState title="No audit entries" />
                    ) : (
                      <TableWrap>
                        <Table className="min-w-[560px]">
                          <THead>
                            <tr>
                              <TH>Action</TH>
                              <TH>Resource</TH>
                              <TH>When</TH>
                            </tr>
                          </THead>
                          <TBody>
                            {a.audit_logs.map((l) => (
                              <tr key={l.id}>
                                <TD>
                                  <Badge className="font-mono">{l.action}</Badge>
                                </TD>
                                <TD className="text-muted">{l.resource_type ?? '—'}</TD>
                                <TD className="whitespace-nowrap text-muted">{dateTime(l.created_at, true)}</TD>
                              </tr>
                            ))}
                          </TBody>
                        </Table>
                      </TableWrap>
                    ))}
                </Card>
              </div>
              <div className="space-y-6">
                <AdminUserInfo key={a.id} a={a} />
                <ManageCard a={a} />
                <Card>
                  <CardBody className="text-[13px] text-muted">
                    Need everything this account did? Filter the{' '}
                    <Link to={`/admin/logs?user_id=${a.id}`} className="font-medium text-accent hover:underline">
                      request log explorer
                    </Link>{' '}
                    by user ID.
                  </CardBody>
                </Card>
              </div>
            </div>
          </div>
        </>
      )}
      <RequestLogDrawer log={log} onClose={() => setLog(null)} />
    </>
  )
}
