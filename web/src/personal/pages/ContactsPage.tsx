import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Contact as ContactIcon, Download, FileSpreadsheet, Plus, Star, Trash2, UserPlus, Zap } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog, Drawer, Modal } from '@/components/ui/Modal'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/toastContext'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { dateOnly, relativeTime } from '@/lib/format'
import { Avatar, FilterBar, FilterSelect, SearchInput } from '@/business/components/bits'
import { BizErrorState, FormError } from '@/business/components/BizError'
import { TagsInput } from '@/business/components/inputs'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import type { Contact, ContactSource } from '../api/types'
import { contactsApi, downloadAuthed } from '../api/personal'
import { useContact, useContacts, usePMutation } from '../hooks/queries'
import { SOURCE_LABELS } from '../lib/card'
import { DigitalCardRender } from '../components/DigitalCardRender'

function slugName(n: string) {
  return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contact'
}

function ContactDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast()
  const onError = useErrorToast()
  const { data: c, error, isLoading, refetch } = useContact(id)
  const [notes, setNotes] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const update = usePMutation((body: { notes?: string | null; tags?: string[]; favorite?: boolean }) => contactsApi.update(id!, body))
  const del = usePMutation(() => contactsApi.remove(id!))
  const noteValue = notes ?? c?.notes ?? ''
  return (
    <Drawer
      open={!!id}
      onClose={() => {
        setNotes(null)
        onClose()
      }}
      title={c?.card.fields.full_name ?? 'Contact'}
      footer={
        c && (
          <>
            <Button variant="ghost" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm(true)}>
              Delete
            </Button>
            <Button leftIcon={<Download className="h-4 w-4" />} onClick={() => downloadAuthed(`/personal/contacts/${c.id}/vcard`, `${slugName(c.card.fields.full_name)}.vcf`).catch(onError)}>
              Save vCard
            </Button>
          </>
        )
      }
    >
      {error ? (
        <BizErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !c ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            <Badge>{SOURCE_LABELS[c.source] ?? c.source}</Badge>
            {c.live && (
              <Badge tone="success" className="gap-1" title="Updates automatically when they edit their card">
                <Zap className="h-3 w-3" /> Live
              </Badge>
            )}
            <span>Met {c.met_at ? dateOnly(c.met_at) : dateOnly(c.created_at)}</span>
            <button
              type="button"
              onClick={() => update.mutateAsync({ favorite: !c.favorite }).catch(onError)}
              className={cn('ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium hover:bg-surface-2', c.favorite ? 'text-amber-500' : 'text-muted')}
              aria-pressed={c.favorite}
            >
              <Star className={cn('h-4 w-4', c.favorite && 'fill-current')} /> {c.favorite ? 'Favourite' : 'Add to favourites'}
            </button>
          </div>
          <div className="mx-auto max-w-[380px]">
            <DigitalCardRender card={c.card} layout={c.card.layout ?? 'centered'} audience="all" interactive />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Tags</p>
            <TagsInput value={c.tags} onChange={(tags) => update.mutateAsync({ tags }).catch(onError)} placeholder="Add a tag and press Enter" />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Notes</p>
            <Textarea aria-label="Notes" rows={4} value={noteValue} onChange={(e) => setNotes(e.target.value)} placeholder="Where you met, what to follow up on…" maxLength={5000} />
            {notes !== null && notes !== (c.notes ?? '') && (
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" onClick={() => setNotes(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={update.isPending}
                  onClick={async () => {
                    try {
                      await update.mutateAsync({ notes: notes || null })
                      setNotes(null)
                      toast.success('Notes saved')
                    } catch (e) {
                      onError(e)
                    }
                  }}
                >
                  Save notes
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this contact?"
        description="Removes them from your contacts. If you exchange cards again they’ll be added back."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(undefined)
            toast.success('Contact deleted')
            setConfirm(false)
            onClose()
          } catch (e) {
            onError(e)
          }
        }}
      />
    </Drawer>
  )
}

function AddContactModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ full_name: '', company: '', job_title: '', email: '', phone: '', notes: '' })
  const create = usePMutation(() =>
    contactsApi.create({
      card: {
        fields: {
          full_name: f.full_name.trim(),
          company: f.company || null,
          job_title: f.job_title || null,
          emails: f.email ? [{ label: 'Email', value: f.email }] : [],
          phones: f.phone ? [{ label: 'Mobile', value: f.phone }] : [],
          websites: [],
          socials: [],
          custom_links: [],
        },
      },
      notes: f.notes || undefined,
    }),
  )
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await create.mutateAsync(undefined)
      toast.success('Contact added')
      onClose()
    } catch {
      /* inline */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Add contact"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-contact" loading={create.isPending} disabled={!f.full_name.trim()}>
            Add contact
          </Button>
        </>
      }
    >
      <form id="add-contact" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
        <FormError error={create.error} className="sm:col-span-2" />
        <Field label="Full name" className="sm:col-span-2">
          {(p) => <Input {...p} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} data-autofocus />}
        </Field>
        <Field label="Company" optional>
          {(p) => <Input {...p} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />}
        </Field>
        <Field label="Job title" optional>
          {(p) => <Input {...p} value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} />}
        </Field>
        <Field label="Email" optional>
          {(p) => <Input {...p} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
        </Field>
        <Field label="Phone" optional>
          {(p) => <Input {...p} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}
        </Field>
        <Field label="Notes" optional className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}
        </Field>
      </form>
    </Modal>
  )
}

function Row({ c, onOpen }: { c: Contact; onOpen: () => void }) {
  const now = useNow()
  const f = c.card.fields
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/70 sm:px-5">
        {c.card.photo_url ? <Avatar name={f.full_name} src={c.card.photo_url} size={40} /> : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white" style={{ background: c.card.design.primary }} aria-hidden="true">
            {f.full_name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[14px] font-medium">
            <span className="truncate">{f.full_name}</span>
            {c.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Favourite" />}
          </span>
          <span className="block truncate text-xs text-subtle">{[f.job_title, f.company].filter(Boolean).join(' · ') || f.emails?.[0]?.value || '—'}</span>
        </span>
        <span className="hidden max-w-[220px] flex-wrap justify-end gap-1 md:flex">
          {c.tags.slice(0, 3).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span className="text-[11.5px] text-muted">{SOURCE_LABELS[c.source] ?? c.source}</span>
          <span className="text-[11.5px] text-subtle">{relativeTime(c.met_at ?? c.created_at, now)}</span>
        </span>
      </button>
    </li>
  )
}

export default function ContactsPage() {
  useDocumentTitle('Contacts')
  const { contactId } = useParams()
  const navigate = useNavigate()
  const onError = useErrorToast()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const [tag, setTag] = useState('')
  const [source, setSource] = useState<ContactSource | ''>('')
  const [fav, setFav] = useState(false)
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const { data, error, isLoading, refetch } = useContacts({ q: dq || undefined, tag: tag || undefined, source, favorite: fav || undefined, page, page_size: 20 })
  const all = useContacts({ page_size: 100 })
  const tags = [...new Set((all.data?.items ?? []).flatMap((c) => c.tags))].sort()
  const filtered = !!(dq || tag || source || fav)
  const reset = (fn: () => void) => {
    fn()
    setPage(1)
  }
  return (
    <>
      <PageHeader
        title="Contacts"
        description="Everyone you exchange cards with, people who shared their details from your page, and contacts you add."
        actions={
          <>
            <Button leftIcon={<Download className="h-4 w-4" />} onClick={() => downloadAuthed('/personal/contacts/export.vcf', 'contacts.vcf').catch(onError)}>
              vCard
            </Button>
            <Button leftIcon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => downloadAuthed('/personal/contacts/export.csv', 'contacts.csv').catch(onError)}>
              CSV
            </Button>
            <Button variant="primary" leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>
              Add contact
            </Button>
          </>
        }
      />
      <Card>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => reset(() => setQ(v))} placeholder="Search name, company, email, notes…" className="sm:w-72" />
          <FilterSelect label="Tag" value={tag} onChange={(v) => reset(() => setTag(v))} options={[{ value: '', label: 'All tags' }, ...tags.map((t) => ({ value: t, label: t }))]} />
          <FilterSelect
            label="Source"
            value={source}
            onChange={(v) => reset(() => setSource(v))}
            options={[{ value: '', label: 'All sources' }, ...(['nfc_exchange', 'qr_exchange', 'web_lead', 'manual'] as const).map((s) => ({ value: s, label: SOURCE_LABELS[s] }))]}
          />
          <Button variant={fav ? 'primary' : 'secondary'} size="sm" leftIcon={<Star className={cn('h-3.5 w-3.5', fav && 'fill-current')} />} aria-pressed={fav} onClick={() => reset(() => setFav((x) => !x))}>
            Favourites
          </Button>
        </FilterBar>
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={6} cols={3} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={ContactIcon}
            title={filtered ? 'No contacts match' : 'No contacts yet'}
            description={filtered ? 'Try a different search or filter.' : 'Tap phones with someone or let them scan your QR — they appear here automatically.'}
            action={
              !filtered && (
                <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
                  Add contact
                </Button>
              )
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {data.items.map((c) => (
                <Row key={c.id} c={c} onOpen={() => navigate(`/me/contacts/${c.id}`)} />
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ContactDrawer id={contactId ?? null} onClose={() => navigate('/me/contacts')} />
      {adding && <AddContactModal onClose={() => setAdding(false)} />}
    </>
  )
}
