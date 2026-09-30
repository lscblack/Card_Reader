import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, Mail, Phone, Search, User as UserIcon } from 'lucide-react'
import { adminSupportApi, SUPPORT_CATEGORIES, SUPPORT_STATUS_LABEL, type SupportStatus, type SupportTicket } from '@/api/support'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { dateTime, relativeTime } from '@/lib/format'

const TONE: Record<SupportStatus, Tone> = { open: 'info', in_progress: 'warning', resolved: 'success' }
const categoryLabel = (c: string) => SUPPORT_CATEGORIES.find((x) => x.value === c)?.label ?? c

function TicketDrawer({ ticket, onClose }: { ticket: SupportTicket | null; onClose: () => void }) {
  return (
    <Drawer open={!!ticket} onClose={onClose} title={ticket?.subject ?? ''}>
      {ticket && <TicketDetail key={ticket.id} t={ticket} onClose={onClose} />}
    </Drawer>
  )
}

function TicketDetail({ t, onClose }: { t: SupportTicket; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState<SupportStatus>(t.status)
  const [note, setNote] = useState(t.admin_note ?? '')
  const save = useMutation({
    mutationFn: () => adminSupportApi.update(t.id, { status, admin_note: note.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'support'] })
      toast.success('Support request updated')
      onClose()
    },
    onError: (e) => toast.fromError(e),
  })
  const contact = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="flex items-center gap-3 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-subtle">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-subtle">{label}</p>
        <div className="truncate text-[14px] font-medium">{value}</div>
      </div>
    </div>
  )
  const mailto = `mailto:${t.email}?subject=${encodeURIComponent(`Re: ${t.subject}`)}`
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[t.status]} dot>
          {SUPPORT_STATUS_LABEL[t.status]}
        </Badge>
        <Badge tone="neutral">{categoryLabel(t.category)}</Badge>
        <span className="text-xs text-subtle">{dateTime(t.created_at)}</span>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border px-3">
        {contact(<UserIcon className="h-4 w-4" />, 'Name', t.name)}
        {contact(<Mail className="h-4 w-4" />, 'Email', <a href={mailto} className="text-accent hover:underline">{t.email}</a>)}
        {contact(<Phone className="h-4 w-4" />, 'Phone', t.phone ? <a href={`tel:${t.phone.replace(/\s/g, '')}`} className="text-accent hover:underline">{t.phone}</a> : <span className="text-subtle">Not given</span>)}
        {contact(
          <UserIcon className="h-4 w-4" />,
          'Account',
          t.user ? (
            <Link to={`/admin/accounts/${t.user.id}`} className="text-accent hover:underline">
              {t.user.full_name || t.user.email} · <span className="capitalize">{t.user.account_type}</span>
            </Link>
          ) : (
            <span className="text-subtle">Guest (not signed in)</span>
          ),
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold tracking-wider text-subtle uppercase">Message</p>
        <p className="rounded-xl bg-surface-2 p-4 text-[14px] leading-relaxed whitespace-pre-wrap">{t.message}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={mailto}>
          <Button variant="primary" leftIcon={<Mail className="h-4 w-4" />}>Reply by email</Button>
        </a>
        {t.phone && (
          <a href={`tel:${t.phone.replace(/\s/g, '')}`}>
            <Button leftIcon={<Phone className="h-4 w-4" />}>Call</Button>
          </a>
        )}
      </div>

      <div className="space-y-4 border-t border-border pt-5">
        <div>
          <p className="mb-2 text-[13px] font-medium">Status</p>
          <div className="flex gap-1 rounded-xl bg-surface-2 p-1 ring-1 ring-border ring-inset">
            {(['open', 'in_progress', 'resolved'] as SupportStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn('flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium', status === s ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg')}
              >
                {SUPPORT_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <Field label="Internal note" optional hint="Only admins see this.">
          {(a) => <Textarea {...a} rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, who is following up…" />}
        </Field>
        <Button variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate()} disabled={status === t.status && note.trim() === (t.admin_note ?? '')}>
          Save
        </Button>
      </div>
    </div>
  )
}

export default function AdminSupportPage() {
  useDocumentTitle('Support')
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<SupportStatus | 'all'>('open')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useQuery({
    queryKey: ['admin', 'support', status, search, page],
    queryFn: () => adminSupportApi.list({ status: status === 'all' ? null : status, q: search.trim() || undefined, page }),
    placeholderData: keepPreviousData,
  })
  const openId = params.get('ticket')
  const selected = q.data?.items.find((t) => t.id === openId) ?? null
  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('ticket', id)
    else next.delete('ticket')
    setParams(next, { replace: true })
  }
  const c = q.data?.counts
  const total = c ? c.open + c.in_progress + c.resolved : undefined

  return (
    <>
      <PageHeader title="Support" description="Requests sent from the Support page, with the customer’s contact details." />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          tabs={[
            { value: 'open', label: 'Open', count: c?.open },
            { value: 'in_progress', label: 'In progress', count: c?.in_progress },
            { value: 'resolved', label: 'Resolved', count: c?.resolved },
            { value: 'all', label: 'All', count: total },
          ]}
        />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search name, email, phone, subject"
            className="pl-9"
            aria-label="Search support requests"
          />
        </div>
      </div>

      <Card>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={Inbox} title="No support requests" description={search ? 'Nothing matches your search.' : 'New requests from customers show up here.'} />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Customer</TH>
                  <TH>Phone</TH>
                  <TH>Subject</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Received</TH>
                </tr>
              </THead>
              <TBody>
                {q.data.items.map((t) => (
                  <TR key={t.id} onClick={() => select(t.id)} className="cursor-pointer">
                    <TD>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-xs text-muted">{t.email}</p>
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{t.phone ?? '—'}</TD>
                    <TD>
                      <p className="max-w-xs truncate font-medium">{t.subject}</p>
                      <p className="text-xs text-subtle">{categoryLabel(t.category)}{t.user ? '' : ' · guest'}</p>
                    </TD>
                    <TD>
                      <Badge tone={TONE[t.status]} dot>
                        {SUPPORT_STATUS_LABEL[t.status]}
                      </Badge>
                    </TD>
                    <TD className="text-right whitespace-nowrap text-muted" title={dateTime(t.created_at)}>
                      {relativeTime(t.created_at)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
      {q.data && q.data.total > q.data.page_size && (
        <div className="mt-4">
          <Pagination page={page} pageSize={q.data.page_size} total={q.data.total} onPage={setPage} />
        </div>
      )}
      <TicketDrawer ticket={selected} onClose={() => select(null)} />
    </>
  )
}
