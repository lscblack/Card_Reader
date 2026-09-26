import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { BookmarkPlus, Copy, ExternalLink, Eye, EyeOff, FileText, Inbox, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Menu } from '@/components/ui/Menu'
import { Tabs } from '@/components/ui/Tabs'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonRows } from '@/components/ui/Spinner'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { relativeTime } from '@/lib/format'
import type { PageTemplate, Profile, ProfileType } from '../api/types'
import { pageTemplatesApi, profilesApi } from '../api/profiles'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, usePageTemplates, useProfiles } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { fieldErrorsOf, formLevelError } from '../lib/errors'
import { PAGE_TYPE_META, TYPE_LABEL, hasForm, type CreatablePageType } from '../lib/pages'
import { BizErrorState, FormError } from '../components/BizError'
import { SearchInput } from '../components/bits'
import { NewPageModal, SaveTemplateModal } from '../components/pages/NewPageModal'
import { TemplateThumb } from '../components/pages/TemplateGallery'

type Filter = 'all' | ProfileType
type View = 'pages' | 'templates'

const ORDER: Record<ProfileType, number> = { business: 0, menu: 1, product: 2, links: 3, offer: 4, event: 5, form: 6, gallery: 7, wifi: 8, custom: 9, employee: 10 }

function RenameTemplateModal({ template, onClose }: { template: PageTemplate; onClose: () => void }) {
  const { business } = useBusiness()
  const toast = useToast()
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const save = useBizMutation(business.id, () => pageTemplatesApi.update(business.id, template.id, { name: name.trim(), description: description.trim() }))
  const errs = fieldErrorsOf(save.error)
  return (
    <Modal
      open
      onClose={onClose}
      title="Rename template"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await save.mutateAsync(undefined)
                toast.success('Template updated')
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
      <div className="space-y-4">
        <FormError error={formLevelError(save.error, ['name', 'description'])} />
        <Field label="Name" error={errs.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-autofocus />}
        </Field>
        <Field label="Description" optional error={errs.description}>
          {(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}
        </Field>
      </div>
    </Modal>
  )
}

function MyTemplates({ onUse }: { onUse: (t: PageTemplate) => void }) {
  const { business } = useBusiness()
  const can = useCan()
  const toast = useToast()
  const onError = useErrorToast()
  const q = usePageTemplates(business.id)
  const [renaming, setRenaming] = useState<PageTemplate | null>(null)
  const [deleting, setDeleting] = useState<PageTemplate | null>(null)
  const del = useBizMutation(business.id, (id: string) => pageTemplatesApi.remove(business.id, id))
  const mine = (q.data ?? []).filter((t) => t.scope === 'business')
  const manage = can('profiles.manage')
  if (q.error) return <BizErrorState error={q.error} onRetry={() => q.refetch()} />
  if (q.isLoading)
    return (
      <div className="flex flex-wrap gap-4 p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[320px] w-[204px] rounded-xl" />
        ))}
      </div>
    )
  if (!mine.length)
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No templates of your own yet"
        description="Open a page and choose “Save as template” to reuse its layout, theme and content — perfect for a menu shared by several branches."
      />
    )
  return (
    <div className="flex flex-wrap justify-center gap-4 p-4 sm:justify-start sm:p-5">
      {mine.map((t) => (
        <div key={t.id} className="flex w-[204px] flex-col gap-2 rounded-xl border border-border p-2">
          <TemplateThumb template={t} />
          <div className="flex items-start gap-1 px-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{t.name}</p>
              <p className="text-xs text-subtle">
                {PAGE_TYPE_META[t.page_type as CreatablePageType]?.label ?? t.page_type}
                {t.created_at ? ` · ${relativeTime(t.created_at)}` : ''}
              </p>
            </div>
            {manage && (
              <Menu
                label={`Actions for template ${t.name}`}
                items={[
                  { label: 'Use template', icon: <Plus className="h-4 w-4 text-subtle" />, onSelect: () => onUse(t) },
                  { label: 'Rename', icon: <Pencil className="h-4 w-4 text-subtle" />, onSelect: () => setRenaming(t) },
                  { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setDeleting(t) },
                ]}
              />
            )}
          </div>
          {t.description && <p className="line-clamp-2 px-1 text-xs text-muted">{t.description}</p>}
          {manage && (
            <Button size="sm" className="mt-auto" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => onUse(t)}>
              New page from this
            </Button>
          )}
        </div>
      ))}
      {renaming && <RenameTemplateModal template={renaming} onClose={() => setRenaming(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete template “${deleting?.name}”?`}
        description="Pages already created from it are not affected."
        confirmLabel="Delete template"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(deleting!.id)
            toast.success('Template deleted')
            setDeleting(null)
          } catch (e) {
            onError(e)
          }
        }}
      />
    </div>
  )
}

export default function ProfilesPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const navigate = useNavigate()
  const toast = useToast()
  const onError = useErrorToast()
  useDocumentTitle('Pages')
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'templates' ? 'templates' : 'pages'
  const { data, error, isLoading, refetch } = useProfiles(business.id)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const creating = params.get('new') === '1'
  const [fromTemplate, setFromTemplate] = useState<PageTemplate | null>(null)
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const [savingTpl, setSavingTpl] = useState<Profile | null>(null)
  const toggle = useBizMutation(business.id, (p: Profile) => (p.published ? profilesApi.unpublish(business.id, p.id) : profilesApi.publish(business.id, p.id)))
  const del = useBizMutation(business.id, (id: string) => profilesApi.remove(business.id, id))
  const dup = useBizMutation(business.id, (id: string) => profilesApi.duplicate(business.id, id))
  const manage = can('profiles.manage')
  const setCreating = (v: boolean) => {
    const next = new URLSearchParams(params)
    if (v) next.set('new', '1')
    else next.delete('new')
    setParams(next, { replace: true })
  }
  const setView = (v: View) => setParams(v === 'templates' ? { view: 'templates' } : {}, { replace: true })
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 }
    for (const p of data ?? []) c[p.type] = (c[p.type] ?? 0) + 1
    return c
  }, [data])
  const present = (Object.keys(ORDER) as ProfileType[]).filter((t) => counts[t])
  const list = (data ?? [])
    .filter((p) => (filter === 'all' || p.type === filter) && (!q || p.title.toLowerCase().includes(q.toLowerCase()) || p.slug.includes(q.toLowerCase())))
    .sort((a, b) => ORDER[a.type] - ORDER[b.type] || a.title.localeCompare(b.title))

  async function duplicate(p: Profile) {
    try {
      const copy = await dup.mutateAsync(p.id)
      toast.success(`Duplicated as “${copy.title}” (draft).`)
      navigate(`${base}/profiles/${copy.id}`)
    } catch (e) {
      onError(e)
    }
  }

  return (
    <>
      <PageHeader
        title="Pages"
        description="What customers see when they tap — your business page, employee cards, menus, offers, events, forms and more. Built right here, edits go live instantly, no reprogramming."
        actions={
          manage && (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New page
            </Button>
          )
        }
      />
      <Tabs<View>
        className="mb-4"
        value={view}
        onChange={setView}
        tabs={[
          { value: 'pages', label: 'Pages', count: data?.length },
          { value: 'templates', label: 'My templates' },
        ]}
      />
      {view === 'templates' ? (
        <Card>
          <MyTemplates onUse={(t) => setFromTemplate(t)} />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:px-5">
            <SearchInput value={q} onChange={setQ} placeholder="Search pages…" className="sm:w-72" />
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 sm:ml-auto" role="group" aria-label="Filter by type">
              {(['all', ...present] as Filter[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={filter === t}
                  onClick={() => setFilter(t)}
                  className={`h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium transition-colors ${filter === t ? 'bg-accent-solid text-accent-fg' : 'bg-surface-2 text-muted hover:text-fg'}`}
                >
                  {t === 'all' ? 'All' : TYPE_LABEL[t]} <span className="opacity-70">{counts[t] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <BizErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <SkeletonRows rows={6} cols={4} />
          ) : !list.length ? (
            <EmptyState
              icon={FileText}
              title={q || filter !== 'all' ? 'No pages match' : 'No pages yet'}
              description="Create a menu, an offer, an event, a feedback form or a link page from a professional template."
              action={
                manage && (
                  <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
                    New page
                  </Button>
                )
              }
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[760px]">
                <THead>
                  <tr>
                    <TH>Page</TH>
                    <TH>Type</TH>
                    <TH>Public URL</TH>
                    <TH>Status</TH>
                    <TH>Updated</TH>
                    <TH className="text-right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {list.map((p) => {
                    const Icon = PAGE_TYPE_META[p.type as CreatablePageType]?.icon
                    const creatable = p.type !== 'business' && p.type !== 'employee'
                    return (
                      <TR key={p.id} onClick={() => navigate(`${base}/profiles/${p.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`${base}/profiles/${p.id}`)}>
                        <TD className="max-w-[260px]">
                          <span className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">{Icon ? <Icon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{p.title}</span>
                              <span className="block text-xs text-subtle">
                                {p.sections.length} section{p.sections.length === 1 ? '' : 's'}
                                {hasForm(p.sections) ? ' · collects responses' : ''}
                              </span>
                            </span>
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={p.type === 'business' ? 'accent' : 'neutral'}>{TYPE_LABEL[p.type] ?? p.type}</Badge>
                        </TD>
                        <TD className="max-w-[280px]" onClick={(e) => e.stopPropagation()}>
                          <span className="flex items-center gap-1">
                            <a href={p.public_url} target="_blank" rel="noreferrer" className="truncate font-mono text-[12px] text-muted hover:text-accent">
                              {p.public_url.replace(/^https?:\/\//, '')}
                            </a>
                            <CopyButton value={p.public_url} label="Copy public URL" />
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={p.published ? 'success' : 'neutral'} dot>
                            {p.published ? 'Published' : 'Draft'}
                          </Badge>
                        </TD>
                        <TD className="whitespace-nowrap text-muted">{relativeTime(p.updated_at)}</TD>
                        <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Menu
                            label={`Actions for ${p.title}`}
                            items={[
                              { label: manage ? 'Edit' : 'Open', icon: <Pencil className="h-4 w-4 text-subtle" />, onSelect: () => navigate(`${base}/profiles/${p.id}`) },
                              { label: 'View live page', icon: <ExternalLink className="h-4 w-4 text-subtle" />, onSelect: () => window.open(p.public_url, '_blank', 'noopener') },
                              ...(hasForm(p.sections) ? [{ label: 'Form responses', icon: <Inbox className="h-4 w-4 text-subtle" />, onSelect: () => navigate(`${base}/responses?profile_id=${p.id}`) }] : []),
                              ...(manage && creatable
                                ? [
                                    { label: 'Duplicate', icon: <Copy className="h-4 w-4 text-subtle" />, onSelect: () => duplicate(p) },
                                    { label: 'Save as template', icon: <BookmarkPlus className="h-4 w-4 text-subtle" />, onSelect: () => setSavingTpl(p) },
                                  ]
                                : []),
                              ...(manage
                                ? [
                                    {
                                      label: p.published ? 'Unpublish' : 'Publish',
                                      icon: p.published ? <EyeOff className="h-4 w-4 text-subtle" /> : <Eye className="h-4 w-4 text-subtle" />,
                                      onSelect: async () => {
                                        try {
                                          await toggle.mutateAsync(p)
                                          toast.success(p.published ? `${p.title} unpublished` : `${p.title} is live`)
                                        } catch (e) {
                                          onError(e)
                                        }
                                      },
                                    },
                                  ]
                                : []),
                              ...(manage && creatable ? [{ label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setDeleting(p) }] : []),
                            ]}
                          />
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}
      {creating && <NewPageModal open onClose={() => setCreating(false)} />}
      {fromTemplate && <NewPageModal open template={fromTemplate} onClose={() => setFromTemplate(null)} />}
      {savingTpl && <SaveTemplateModal profile={savingTpl} onClose={() => setSavingTpl(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description="Cards or tags pointing at this page will fall back to your business profile. This can’t be undone."
        confirmLabel="Delete page"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(deleting!.id)
            toast.success('Page deleted')
            setDeleting(null)
          } catch (e) {
            onError(e)
          }
        }}
      />
    </>
  )
}
