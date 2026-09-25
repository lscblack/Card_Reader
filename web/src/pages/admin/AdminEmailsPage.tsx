import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Bold, Heading2, Italic, Link2, List, Mail, MailCheck, Search, Send, X } from 'lucide-react'
import type { AccountType, EmailFilter, EmailLog, EmailStatus, SendEmailRequest } from '@/api/types'
import { adminConsoleApi } from '@/api/admin'
import { adminEmailsApi } from '@/api/emails'
import { usePlans } from '@/hooks/queries'
import { useEmailCampaigns, useEmailLog, useEmailLogs, useEmailTemplates, useSendEmail, useTemplatePreview } from '@/hooks/useAdmin3'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { dateTime, num, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge, type Tone } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog, Drawer, Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { Skeleton, SkeletonRows, Spinner } from '@/components/ui/Spinner'
import { Tabs } from '@/components/ui/Tabs'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Avatar } from '@/components/ui/Avatar'
import { useToast } from '@/components/ui/toastContext'

type Tab = 'compose' | 'campaigns' | 'log' | 'templates'

const statusTone: Record<EmailStatus, Tone> = { queued: 'info', sent: 'success', failed: 'danger', logged: 'neutral' }

/** Sandboxed preview: no scripts, no same-origin access. */
function EmailFrame({ html, title, className }: { html: string | undefined; title: string; className?: string }) {
  if (!html) return <Skeleton className={cn('h-96 w-full', className)} />
  return <iframe title={title} srcDoc={html} sandbox="" className={cn('h-[520px] w-full rounded-lg border border-border bg-white', className)} />
}

// ---------------------------------------------------------------------------------------------

interface Picked {
  id: string
  email: string
  full_name: string
}

function UserPicker({ picked, onChange }: { picked: Picked[]; onChange: (p: Picked[]) => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const res = useQuery({ queryKey: ['admin', 'accounts', 'picker', dq], queryFn: () => adminConsoleApi.accounts({ q: dq, page: 1 }), enabled: dq.length >= 2 })
  const options = (res.data?.items ?? []).filter((u) => !picked.some((p) => p.id === u.id)).slice(0, 6)
  return (
    <div className="space-y-2">
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((u) => (
            <span key={u.id} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-0.5 pl-2 text-[12.5px] ring-1 ring-border">
              {u.email}
              <button type="button" className="inline-flex h-5 w-5 items-center justify-center rounded text-subtle hover:bg-surface-3 hover:text-fg" onClick={() => onChange(picked.filter((x) => x.id !== u.id))} aria-label={`Remove ${u.email}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input aria-label="Add recipients" placeholder="Search users by name or email…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        {dq.length >= 2 && (
          <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            {res.isLoading ? (
              <div className="flex justify-center py-3 text-subtle">
                <Spinner className="h-4 w-4" />
              </div>
            ) : !options.length ? (
              <p className="px-3 py-2 text-[13px] text-muted">No matching users</p>
            ) : (
              options.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    onChange([...picked, { id: u.id, email: u.email, full_name: u.full_name }])
                    setQ('')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                >
                  <Avatar src={u.avatar_url} name={u.full_name} email={u.email} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{u.full_name}</span>
                  <span className="truncate text-xs text-subtle">{u.email}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function useFilterCount(f: EmailFilter, enabled: boolean) {
  const status = f.email_verified === false ? 'unverified' : f.status
  return useQuery({
    queryKey: ['admin', 'accounts', 'count', f],
    queryFn: () => adminConsoleApi.accounts({ type: f.account_type, status, page: 1 }),
    enabled,
    select: (r) => r.total,
  })
}

function Toolbar({ onWrap }: { onWrap: (before: string, after?: string, placeholder?: string) => void }) {
  const btn = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-fg'
  return (
    <div className="flex gap-0.5 border-b border-border px-1.5 py-1" role="toolbar" aria-label="Formatting">
      <button type="button" className={btn} onClick={() => onWrap('**', '**', 'bold text')} aria-label="Bold">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btn} onClick={() => onWrap('*', '*', 'italic text')} aria-label="Italic">
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btn} onClick={() => onWrap('\n## ', '', 'Heading')} aria-label="Heading">
        <Heading2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btn} onClick={() => onWrap('\n- ', '', 'List item')} aria-label="Bullet list">
        <List className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btn} onClick={() => onWrap('[', '](https://)', 'link text')} aria-label="Link">
        <Link2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function Composer({ initialUsers }: { initialUsers: Picked[] }) {
  const toast = useToast()
  const plans = usePlans()
  const send = useSendEmail()
  const [mode, setMode] = useState<'users' | 'filter'>(initialUsers.length ? 'users' : 'filter')
  const [picked, setPicked] = useState<Picked[]>(initialUsers)
  const [filter, setFilter] = useState<EmailFilter>({})
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('Hi there,\n\n')
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [confirm, setConfirm] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const count = useFilterCount(filter, mode === 'filter')
  const recipients = mode === 'users' ? picked.length : (count.data ?? null)
  const cta = ctaLabel.trim() && /^https?:\/\//.test(ctaUrl.trim()) ? { label: ctaLabel.trim(), url: ctaUrl.trim() } : undefined
  const ctaInvalid = !!ctaLabel.trim() !== !!ctaUrl.trim() || (!!ctaUrl.trim() && !/^https?:\/\/\S+$/.test(ctaUrl.trim()))

  const previewInput = useDebounced(JSON.stringify({ subject, body_markdown: body, cta }), 500)
  const preview = useQuery({
    queryKey: ['admin', 'email-preview', previewInput],
    queryFn: () => adminEmailsApi.preview(JSON.parse(previewInput) as { subject: string; body_markdown: string; cta?: { label: string; url: string } }),
    placeholderData: (prev) => prev,
  })

  const wrap = (before: string, after = '', placeholder = '') => {
    const el = area.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const sel = body.slice(a, b) || placeholder
    const next = body.slice(0, a) + before + sel + after + body.slice(b)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + before.length, a + before.length + sel.length)
    })
  }

  const invalid = !subject.trim() || !body.trim() || ctaInvalid || !recipients || (recipients ?? 0) > 5000

  async function doSend() {
    const req: SendEmailRequest = { subject: subject.trim(), body_markdown: body, cta }
    if (mode === 'users') req.user_ids = picked.map((p) => p.id)
    else req.filter = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== '')) as EmailFilter
    try {
      const r = await send.mutateAsync(req)
      toast.success(`Queued for ${num(r.recipients)} recipient${r.recipients === 1 ? '' : 's'}. Track it under Campaigns.`, 'Email sent')
      setConfirm(false)
      setSubject('')
      setBody('Hi there,\n\n')
      setCtaLabel('')
      setCtaUrl('')
    } catch (e) {
      setConfirm(false)
      toast.fromError(e, 'Could not send')
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="Compose" description="Sent with the branded admin_message template. Markdown only — raw HTML is removed." />
        <CardBody className="space-y-5">
          <div className="space-y-3">
            <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="Recipients">
              {(['filter', 'users'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn('h-8 rounded-md px-3 text-[13px] font-medium', mode === m ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg')}
                >
                  {m === 'filter' ? 'Audience filter' : 'Specific users'}
                </button>
              ))}
            </div>
            {mode === 'users' ? (
              <UserPicker picked={picked} onChange={setPicked} />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Select aria-label="Account type" value={filter.account_type ?? ''} onChange={(e) => setFilter({ ...filter, account_type: (e.target.value || undefined) as AccountType | undefined })}>
                  <option value="">All account types</option>
                  <option value="developer">Developers</option>
                  <option value="business">Businesses</option>
                </Select>
                <Select aria-label="Status" value={filter.status ?? ''} onChange={(e) => setFilter({ ...filter, status: (e.target.value || undefined) as EmailFilter['status'] })}>
                  <option value="">Active + disabled</option>
                  <option value="active">Active only</option>
                  <option value="inactive">Disabled only</option>
                </Select>
                <Select
                  aria-label="Email verification"
                  value={filter.email_verified == null ? '' : String(filter.email_verified)}
                  onChange={(e) => setFilter({ ...filter, email_verified: e.target.value === '' ? undefined : e.target.value === 'true' })}
                >
                  <option value="">Verified + unverified</option>
                  <option value="true">Verified</option>
                  <option value="false">Unverified</option>
                </Select>
                <Select aria-label="Plan" value={filter.plan_code ?? ''} onChange={(e) => setFilter({ ...filter, plan_code: e.target.value || undefined })}>
                  <option value="">Any plan</option>
                  {plans.data?.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <p className="flex items-center gap-1.5 text-[13px]">
              <Mail className="h-4 w-4 text-subtle" />
              {recipients == null ? (
                <span className="text-muted">Counting recipients…</span>
              ) : (
                <span>
                  <span className="font-semibold tabular-nums">{mode === 'filter' ? '≈ ' : ''}
                    {num(recipients)}</span> recipient{recipients === 1 ? '' : 's'}
                  {recipients > 5000 && <span className="text-red-600 dark:text-red-400"> — max 5,000 per send</span>}
                </span>
              )}
            </p>
          </div>
          <Field label="Subject">
            {(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} />}
          </Field>
          <div className="space-y-1.5">
            <label htmlFor="email-body" className="text-[13px] font-medium">
              Message
            </label>
            <div className="overflow-hidden rounded-lg border border-border-strong focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20">
              <Toolbar onWrap={wrap} />
              <Textarea id="email-body" ref={area} rows={10} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-none border-0 font-mono text-[13px] shadow-none focus:ring-0" />
            </div>
            <p className="text-xs text-subtle">**bold**, *italic*, ## heading, - list, [link](https://…). Paragraphs are separated by a blank line.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Button label" optional>
              {(p) => <Input {...p} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={40} placeholder="Open dashboard" />}
            </Field>
            <Field label="Button URL" optional error={ctaInvalid ? 'Enter both a label and an http(s) URL.' : null}>
              {(p) => <Input {...p} type="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://" />}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} disabled={invalid} onClick={() => setConfirm(true)}>
              Send email
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card className="xl:sticky xl:top-20 xl:self-start">
        <CardHeader title="Live preview" description="Exactly what recipients receive (rendered by the server)." actions={preview.isFetching ? <Spinner className="h-4 w-4 text-subtle" /> : null} />
        <CardBody>
          {preview.error ? <ErrorAlert error={preview.error} /> : <EmailFrame html={preview.data?.html} title="Email preview" />}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Send to ${recipients == null ? '…' : num(recipients)} recipient${recipients === 1 ? '' : 's'}?`}
        description={`“${subject}” will be queued and sent by the worker. This can’t be undone.`}
        danger={false}
        confirmLabel="Send now"
        loading={send.isPending}
        onConfirm={doSend}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

function CampaignsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useEmailCampaigns(page)
  const now = useNow()
  return (
    <Card>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={5} cols={5} />
      ) : !data?.items.length ? (
        <EmptyState icon={MailCheck} title="No campaigns yet" description="Emails you compose appear here with delivery counts." />
      ) : (
        <>
          <TableWrap>
            <Table className="min-w-[720px]">
              <THead>
                <tr>
                  <TH>Subject</TH>
                  <TH className="text-right">Recipients</TH>
                  <TH>Result</TH>
                  <TH>By</TH>
                  <TH>When</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((c) => (
                  <TR key={c.id} onClick={() => onOpen(c.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.id)}>
                    <TD className="max-w-[320px] truncate font-medium">{c.subject}</TD>
                    <TD className="text-right tabular-nums">{num(c.recipients)}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {c.sent > 0 && <Badge tone="success">{num(c.sent)} sent</Badge>}
                        {c.logged > 0 && <Badge>{num(c.logged)} logged</Badge>}
                        {c.failed > 0 && <Badge tone="danger">{num(c.failed)} failed</Badge>}
                        {c.recipients - c.sent - c.logged - c.failed > 0 && <Badge tone="info">{num(c.recipients - c.sent - c.logged - c.failed)} queued</Badge>}
                      </div>
                    </TD>
                    <TD className="text-muted">{c.created_by ?? '—'}</TD>
                    <TD className="whitespace-nowrap text-muted">{relativeTime(c.created_at, now)}</TD>
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

function LogTab({ campaignId, onClearCampaign }: { campaignId: string; onClearCampaign: () => void }) {
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<EmailLog | null>(null)
  const { data, isLoading, error, refetch } = useEmailLogs({ campaign_id: campaignId || undefined, status: status || undefined, q: dq || undefined, page })
  const detail = useEmailLog(open?.id ?? null)
  const now = useNow()
  return (
    <Card>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input aria-label="Search emails" placeholder="Recipient or subject" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className="pl-8" />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="sm:w-40">
          <option value="">All statuses</option>
          {(['queued', 'sent', 'failed', 'logged'] as const).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {campaignId && (
          <Button size="sm" variant="ghost" leftIcon={<X className="h-3.5 w-3.5" />} onClick={onClearCampaign}>
            Campaign filter
          </Button>
        )}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={6} cols={5} />
      ) : !data?.items.length ? (
        <EmptyState icon={Mail} title="No emails match" />
      ) : (
        <>
          <TableWrap>
            <Table className="min-w-[760px]">
              <THead>
                <tr>
                  <TH>Recipient</TH>
                  <TH>Subject</TH>
                  <TH>Template</TH>
                  <TH>Status</TH>
                  <TH>When</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((e) => (
                  <TR key={e.id} onClick={() => setOpen(e)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && setOpen(e)}>
                    <TD className="max-w-[220px] truncate">{e.to_email}</TD>
                    <TD className="max-w-[260px] truncate text-muted">{e.subject}</TD>
                    <TD>
                      <code className="font-mono text-xs text-muted">{e.template}</code>
                    </TD>
                    <TD>
                      <Badge tone={statusTone[e.status]} dot title={e.error ?? undefined}>
                        {e.status}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{relativeTime(e.created_at, now)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.subject ?? 'Email'}>
        {open && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <dt className="text-xs text-subtle">To</dt>
                <dd className="break-all">{open.to_email}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Status</dt>
                <dd>
                  <Badge tone={statusTone[open.status]} dot>
                    {open.status}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Created</dt>
                <dd>{dateTime(open.created_at, true)}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Sent</dt>
                <dd>{dateTime(open.sent_at, true)}</dd>
              </div>
            </dl>
            {open.error && <ErrorAlert error={new Error(open.error)} title="Delivery error" />}
            <p className="text-xs text-subtle">One-time links are never stored — they appear as “[link removed]”.</p>
            {detail.error ? <ErrorAlert error={detail.error} /> : <EmailFrame html={detail.data?.html} title="Stored email" />}
          </div>
        )}
      </Drawer>
    </Card>
  )
}

function TemplatesTab() {
  const { data, isLoading, error, refetch } = useEmailTemplates()
  const [open, setOpen] = useState<string | null>(null)
  const preview = useTemplatePreview(open)
  const [view, setView] = useState<'html' | 'text'>('html')
  return (
    <>
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.map((t) => (
            <button key={t.name} onClick={() => setOpen(t.name)} className="rounded-xl border border-border bg-surface p-4 text-left shadow-xs transition-colors hover:border-accent/50">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Mail className="h-4 w-4" />
              </span>
              <p className="mt-3 font-mono text-[13px] font-medium">{t.name}</p>
              <p className="mt-1 text-[13px] text-muted">{t.description}</p>
            </button>
          ))}
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ?? ''} description="Rendered with sample data and the current branding." size="lg">
        <Tabs value={view} onChange={setView} tabs={[{ value: 'html', label: 'HTML' }, { value: 'text', label: 'Plain text' }]} className="mb-3" />
        {preview.error ? (
          <ErrorAlert error={preview.error} />
        ) : view === 'html' ? (
          <EmailFrame html={preview.data?.html} title={`${open} preview`} className="h-[60vh]" />
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-surface-2 p-3 text-[12.5px] whitespace-pre-wrap">{preview.data?.text}</pre>
        )}
      </Modal>
    </>
  )
}

export default function AdminEmailsPage() {
  useDocumentTitle('Admin · Emails')
  const [params, setParams] = useSearchParams()
  const tab = (['compose', 'campaigns', 'log', 'templates'].includes(params.get('tab') ?? '') ? params.get('tab') : 'compose') as Tab
  const campaignId = params.get('campaign') ?? ''
  const userIds = useMemo(() => (params.get('users') ?? '').split(',').filter(Boolean), [params])
  const prefill = useQuery({
    queryKey: ['admin', 'emails', 'prefill', userIds],
    queryFn: async () => Promise.all(userIds.slice(0, 200).map((id) => adminConsoleApi.account(id).then((a) => ({ id: a.id, email: a.email, full_name: a.full_name })))),
    enabled: userIds.length > 0,
  })
  const setTab = (t: Tab, extra: Record<string, string> = {}) => setParams({ tab: t, ...extra }, { replace: true })

  // After prefill resolves, drop ?users= from the URL (the composer keeps them in state).
  const composerKey = userIds.length ? (prefill.data ? `users-${userIds.join(',')}` : 'loading') : 'blank'
  useEffect(() => {
    if (userIds.length && prefill.data && tab !== 'compose') setParams({ tab }, { replace: true })
  }, [userIds.length, prefill.data, tab, setParams])

  return (
    <>
      <PageHeader title="Emails" description="Message users with branded emails, track campaigns and inspect everything the platform sent." />
      <Tabs<Tab>
        className="mb-6"
        value={tab}
        onChange={(t) => setTab(t)}
        tabs={[
          { value: 'compose', label: 'Compose' },
          { value: 'campaigns', label: 'Campaigns' },
          { value: 'log', label: 'Email log' },
          { value: 'templates', label: 'Templates' },
        ]}
      />
      {tab === 'compose' &&
        (userIds.length && prefill.isLoading ? <Skeleton className="h-96 rounded-xl" /> : <Composer key={composerKey} initialUsers={prefill.data ?? []} />)}
      {tab === 'campaigns' && <CampaignsTab onOpen={(id) => setTab('log', { campaign: id })} />}
      {tab === 'log' && <LogTab campaignId={campaignId} onClearCampaign={() => setTab('log')} />}
      {tab === 'templates' && <TemplatesTab />}
    </>
  )
}
