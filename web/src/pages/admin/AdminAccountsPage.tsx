import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Mail, MailCheck, Search, Users } from 'lucide-react'
import { useAdminAccounts } from '@/hooks/useConsole'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { num, percent, relativeTime } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toastContext'
import { adminEmailsApi } from '@/api/emails'

export default function AdminAccountsPage() {
  useDocumentTitle('Admin · Accounts')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const now = useNow()
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q.trim(), 350)
  const type = params.get('type') ?? ''
  const status = params.get('status') ?? ''
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useAdminAccounts({ q: dq || undefined, type: type || undefined, status: status || undefined, page })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmVerify, setConfirmVerify] = useState(false)
  const [sending, setSending] = useState(false)
  const toast = useToast()
  const pageIds = data?.items.map((u) => u.id) ?? []
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s)
      for (const id of pageIds) {
        if (allOnPage) n.delete(id)
        else n.add(id)
      }
      return n
    })

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
    setPage(1)
  }

  return (
    <>
      <PageHeader title="Accounts" description="Every developer and business user. Open an account to inspect its apps, devices, logs and audit trail." />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:px-5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              aria-label="Search accounts"
              placeholder="Search name or email"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              className="pl-8"
            />
          </div>
          <Select aria-label="Account type" value={type} onChange={(e) => set('type', e.target.value)} className="sm:w-40">
            <option value="">All types</option>
            <option value="developer">Developers</option>
            <option value="business">Businesses</option>
            <option value="personal">Personal</option>
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)} className="sm:w-40">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Disabled</option>
          </Select>
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft/40 px-4 py-2.5 sm:px-5" role="region" aria-label="Bulk actions">
            <span className="text-[13px] font-medium">{selected.size} selected</span>
            <Button size="sm" variant="primary" leftIcon={<Mail className="h-3.5 w-3.5" />} onClick={() => navigate(`/admin/emails?tab=compose&users=${[...selected].join(',')}`)}>
              Send email
            </Button>
            <Button size="sm" leftIcon={<MailCheck className="h-3.5 w-3.5" />} onClick={() => setConfirmVerify(true)}>
              Send verification link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : !data?.items.length ? (
          <EmptyState icon={Users} title="No accounts match" />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[900px]">
                <THead>
                  <tr>
                    <TH className="w-10">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--accent-solid)]" checked={allOnPage} onChange={togglePage} aria-label="Select all on this page" />
                    </TH>
                    <TH>Account</TH>
                    <TH>Type</TH>
                    <TH>Plan</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Req 24h</TH>
                    <TH className="text-right">Errors 24h</TH>
                    <TH className="text-right">Apps / devices</TH>
                    <TH>Last active</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.items.map((u) => (
                    <TR
                      key={u.id}
                      onClick={() => navigate(`/admin/accounts/${u.id}`)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/admin/accounts/${u.id}`)}
                    >
                      <TD onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--accent-solid)]"
                          checked={selected.has(u.id)}
                          onChange={() => toggle(u.id)}
                          aria-label={`Select ${u.email}`}
                        />
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <Avatar src={u.avatar_url} name={u.full_name} email={u.email} size="md" />
                          <div className="min-w-0">
                            <p className="font-medium">{u.full_name || '—'}</p>
                            <p className="text-xs text-subtle">{u.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={u.account_type === 'business' ? 'info' : u.account_type === 'personal' ? 'success' : 'neutral'}>{u.account_type ?? 'developer'}</Badge>
                          {u.role === 'admin' && <Badge tone="accent">admin</Badge>}
                        </div>
                        {u.business && <p className="mt-0.5 truncate text-xs text-subtle">{u.business.name}</p>}
                      </TD>
                      <TD className="text-muted capitalize">{u.plan}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={u.is_active ? 'success' : 'danger'} dot>
                            {u.is_active ? 'Active' : 'Disabled'}
                          </Badge>
                          {u.email_verified === false && <Badge tone="warning">Unverified</Badge>}
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums">{num(u.stats.requests_24h)}</TD>
                      <TD className="text-right text-muted tabular-nums">{u.stats.error_rate_24h == null ? '—' : percent(u.stats.error_rate_24h)}</TD>
                      <TD className="text-right text-muted tabular-nums">
                        {num(u.stats.applications)} / {num(u.stats.devices)}
                      </TD>
                      <TD className="whitespace-nowrap text-muted">{relativeTime(u.stats.last_active_at, now)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ConfirmDialog
        open={confirmVerify}
        onClose={() => setConfirmVerify(false)}
        title={`Send verification links to ${selected.size} account${selected.size === 1 ? '' : 's'}?`}
        description="Already-verified accounts are skipped automatically."
        danger={false}
        confirmLabel="Send links"
        loading={sending}
        onConfirm={async () => {
          setSending(true)
          try {
            const r = await adminEmailsApi.sendVerificationBulk([...selected])
            toast.success(`${r.sent} sent · ${r.skipped_already_verified} already verified`, 'Verification links')
            setConfirmVerify(false)
            setSelected(new Set())
          } catch (e) {
            toast.fromError(e)
          } finally {
            setSending(false)
          }
        }}
      />
    </>
  )
}
