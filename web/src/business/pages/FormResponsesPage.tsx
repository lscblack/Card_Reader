import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Download, Inbox, Nfc, Star, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Drawer } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { dateTime, relativeTime } from '@/lib/format'
import type { FormField, FormResponse, Profile } from '../api/types'
import { formResponsesApi } from '../api/profiles'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, useFormResponses, useProfiles } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { hasForm } from '../lib/pages'
import { BizErrorState, NoAccess } from '../components/BizError'
import { DetailRow } from '../components/bits'

const PAGE_SIZE = 25

function formOf(pages: Profile[], r: FormResponse): { page: Profile | null; title: string; fields: FormField[] } {
  const page = pages.find((p) => p.id === r.profile_id) ?? null
  const s = page?.sections.find((x) => x.id === r.section_id && x.type === 'form') as { title?: string; fields?: FormField[] } | undefined
  return { page, title: s?.title ?? 'Form', fields: s?.fields ?? [] }
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`h-3.5 w-3.5 ${n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-border-strong'}`} aria-hidden="true" />
      ))}
    </span>
  )
}

function answerText(v: unknown, f?: FormField) {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (f?.type === 'rating' && typeof v === 'number') return `${v} / 5`
  return String(v)
}

function avgRating(r: FormResponse, fields: FormField[]): number | null {
  const vals = fields.filter((f) => f.type === 'rating').map((f) => r.answers[f.id]).filter((v): v is number => typeof v === 'number')
  if (!vals.length) {
    const any = Object.values(r.answers).filter((v): v is number => typeof v === 'number' && v >= 1 && v <= 5)
    return any.length && !fields.length ? any.reduce((a, b) => a + b, 0) / any.length : null
  }
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function summary(r: FormResponse, fields: FormField[]) {
  const texts = (fields.length ? fields.filter((f) => ['text', 'textarea', 'email', 'phone', 'select'].includes(f.type)).map((f) => r.answers[f.id]) : Object.values(r.answers)).filter((v): v is string => typeof v === 'string' && !!v.trim())
  return texts.slice(0, 2).join(' · ') || '—'
}

export default function FormResponsesPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const onError = useErrorToast()
  const now = useNow()
  useDocumentTitle('Form responses')
  const [params, setParams] = useSearchParams()
  const profileId = params.get('profile_id') ?? ''
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<FormResponse | null>(null)
  const [deleting, setDeleting] = useState<FormResponse | null>(null)
  const [exporting, setExporting] = useState(false)
  const allowed = can('people.manage') || can('profiles.manage')
  const pages = useProfiles(business.id)
  const formPages = useMemo(() => (pages.data ?? []).filter((p) => hasForm(p.sections)), [pages.data])
  const q = useFormResponses(business.id, { profile_id: profileId || undefined, page, page_size: PAGE_SIZE }, allowed)
  const del = useBizMutation(business.id, (id: string) => formResponsesApi.remove(business.id, id))

  if (!allowed)
    return (
      <>
        <PageHeader title="Form responses" />
        <Card>
          <NoAccess permission="profiles.manage" what="form responses" />
        </Card>
      </>
    )

  async function exportCsv() {
    setExporting(true)
    try {
      const csv = await formResponsesApi.exportCsv(business.id, profileId || undefined)
      const blob = new Blob([typeof csv === 'string' ? csv : JSON.stringify(csv)], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const pageSlug = formPages.find((p) => p.id === profileId)?.slug
      a.download = `form-responses${pageSlug ? `-${pageSlug}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) {
      onError(e)
    } finally {
      setExporting(false)
    }
  }

  const items = q.data?.items ?? []
  const detail = open ? formOf(pages.data ?? [], open) : null

  return (
    <>
      <PageHeader
        title="Form responses"
        description="Feedback, contact and booking requests sent from your pages. New responses also show up in your notifications."
        actions={
          <Button leftIcon={<Download className="h-4 w-4" />} loading={exporting} disabled={!q.data?.total} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <span className="shrink-0">Page</span>
            <Select
              aria-label="Filter by page"
              value={profileId}
              onChange={(e) => {
                setPage(1)
                setParams(e.target.value ? { profile_id: e.target.value } : {}, { replace: true })
              }}
              className="sm:w-72"
            >
              <option value="">All pages with forms</option>
              {formPages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </label>
          {q.data && <span className="text-xs text-subtle sm:ml-auto">{q.data.total} response{q.data.total === 1 ? '' : 's'}</span>}
        </div>
        {q.error ? (
          <BizErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <SkeletonRows rows={6} cols={4} />
        ) : !items.length ? (
          <EmptyState
            icon={Inbox}
            title="No responses yet"
            description={formPages.length ? 'When someone sends one of your forms, it appears here.' : 'Create a feedback, contact or booking page and point a card or tag at it.'}
            action={
              !formPages.length && (
                <Link to={`${base}/profiles?new=1`}>
                  <Button size="sm" variant="primary">
                    New page
                  </Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[720px]">
                <THead>
                  <tr>
                    <TH>Received</TH>
                    <TH>Page</TH>
                    <TH>Rating</TH>
                    <TH>Answers</TH>
                    <TH className="text-right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {items.map((r) => {
                    const f = formOf(pages.data ?? [], r)
                    const rating = avgRating(r, f.fields)
                    return (
                      <TR key={r.id} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
                        <TD className="whitespace-nowrap text-muted" title={dateTime(r.created_at)}>
                          {relativeTime(r.created_at, now)}
                        </TD>
                        <TD className="max-w-[200px]">
                          <span className="block truncate font-medium">{f.page?.title ?? r.profile_title ?? 'Deleted page'}</span>
                          <span className="flex items-center gap-1 text-xs text-subtle">
                            {f.title}
                            {r.card_id && (
                              <>
                                {' · '}
                                <Nfc className="h-3 w-3" aria-hidden="true" /> via tap
                              </>
                            )}
                          </span>
                        </TD>
                        <TD className="whitespace-nowrap">{rating != null ? <Stars value={rating} /> : <span className="text-subtle">—</span>}</TD>
                        <TD className="max-w-[320px] truncate text-muted">{summary(r, f.fields)}</TD>
                        <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button size="icon-sm" variant="ghost" aria-label="Delete response" onClick={() => setDeleting(r)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </TableWrap>
            <Pagination page={q.data!.page} pageSize={q.data!.page_size} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={detail ? `${detail.page?.title ?? 'Response'} · ${detail.title}` : 'Response'}
        footer={
          open && (
            <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(open)}>
              Delete response
            </Button>
          )
        }
      >
        {open && detail && (
          <div className="space-y-4">
            <p className="text-[13px] text-muted">
              Received {dateTime(open.created_at, true)}
              {open.card_id && (
                <>
                  {' · '}
                  <Link to={`${base}/cards/${open.card_id}`} className="text-accent hover:underline">
                    opened via a tap
                  </Link>
                </>
              )}
            </p>
            <dl className="divide-y divide-border rounded-lg border border-border px-3">
              {(detail.fields.length ? detail.fields : Object.keys(open.answers).map((id) => ({ id, label: id, type: 'text' as const, required: false }))).map((f) => (
                <DetailRow key={f.id} label={f.label}>
                  {f.type === 'rating' && typeof open.answers[f.id] === 'number' ? (
                    <span className="inline-flex items-center gap-2">
                      <Stars value={open.answers[f.id] as number} /> {open.answers[f.id] as number}/5
                    </span>
                  ) : (
                    <span className="whitespace-pre-wrap">{answerText(open.answers[f.id], f)}</span>
                  )}
                </DetailRow>
              ))}
            </dl>
            {typeof open.answers.email === 'string' && open.answers.email && (
              <a href={`mailto:${open.answers.email}`} className="inline-flex">
                <Button size="sm">Reply by email</Button>
              </a>
            )}
            {detail.page && (
              <Link to={`${base}/profiles/${detail.page.id}`} className="block text-[13px] font-medium text-accent hover:underline">
                Edit the “{detail.page.title}” page
              </Link>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this response?"
        description="It will be removed permanently (it stays in any CSV you already exported)."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(deleting!.id)
            toast.success('Response deleted')
            if (open?.id === deleting!.id) setOpen(null)
            setDeleting(null)
          } catch (e) {
            onError(e)
          }
        }}
      />
    </>
  )
}
