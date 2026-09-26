import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Eye, EyeOff, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Input'
import { Menu } from '@/components/ui/Menu'
import { Tabs } from '@/components/ui/Tabs'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import type { Profile, ProfileType, Section } from '../api/types'
import { profilesApi } from '../api/profiles'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, useProfiles } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { fieldErrorsOf, formLevelError } from '../lib/errors'
import { SLUG_RE, slugify } from '../lib/format'
import { BizErrorState, FormError } from '../components/BizError'
import { SearchInput } from '../components/bits'

type Filter = 'all' | ProfileType

const TYPE_LABEL: Record<ProfileType, string> = { business: 'Business', employee: 'Employee', custom: 'Custom', menu: 'Menu', product: 'Product', links: 'Links', offer: 'Offer', event: 'Event', gallery: 'Gallery', form: 'Form', wifi: 'Wi-Fi' }

const STARTER: Record<'custom' | 'menu' | 'product', Section[]> = {
  custom: [{ type: 'text', markdown: 'Tell your visitors what this page is about.' }],
  menu: [{ type: 'menu', categories: [{ name: 'Drinks', items: [{ name: 'Espresso', description: '', price: '3.00', tags: [] }] }] }],
  product: [{ type: 'products', items: [{ title: 'Product name', description: '', price: '' }] }, { type: 'about', text: '' }],
}

function CreateProfileModal({ onClose }: { onClose: () => void }) {
  const { business, base } = useBusiness()
  const navigate = useNavigate()
  const toast = useToast()
  const [type, setType] = useState<'custom' | 'menu' | 'product'>('menu')
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const effSlug = slugTouched ? slug : slugify(title)
  const create = useBizMutation(business.id, () => profilesApi.create(business.id, { type, title: title.trim(), slug: effSlug, sections: STARTER[type], theme: { accent: '#b91c1c' } }))
  const errs = fieldErrorsOf(create.error)
  const slugErr = effSlug && !SLUG_RE.test(effSlug) ? 'Use 3–48 lowercase letters, numbers or dashes.' : errs.slug
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const p = await create.mutateAsync(undefined)
      toast.success('Page created — add your content, then publish it.')
      navigate(`${base}/profiles/${p.id}`)
    } catch {
      /* inline */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="New page"
      description="Pages are what customers see when they tap. Point any card or tag at them."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-profile" loading={create.isPending} disabled={!title.trim() || !!slugErr}>
            Create page
          </Button>
        </>
      }
    >
      <form id="new-profile" onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={formLevelError(create.error, ['slug', 'title'])} />
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Page type">
          {(['menu', 'product', 'custom'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={cn('rounded-lg border p-2.5 text-left transition-colors', type === t ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}
            >
              <span className="block text-[13px] font-medium">{TYPE_LABEL[t]}</span>
              <span className="block text-xs text-subtle">{t === 'menu' ? 'Digital menu' : t === 'product' ? 'Product info' : 'Anything else'}</span>
            </button>
          ))}
        </div>
        <Field label="Title" error={errs.title}>
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={type === 'menu' ? 'Lunch menu' : type === 'product' ? 'House Blend beans' : 'Summer event'} data-autofocus />}
        </Field>
        <Field label="URL" error={slugErr} hint={`${window.location.origin}/b/${business.slug}/${effSlug || '…'}`}>
          {(p) => (
            <Input
              {...p}
              value={effSlug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase())
              }}
              className="font-mono"
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}

export default function ProfilesPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const navigate = useNavigate()
  const toast = useToast()
  const onError = useErrorToast()
  useDocumentTitle('Profiles')
  const { data, error, isLoading, refetch } = useProfiles(business.id)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const toggle = useBizMutation(business.id, (p: Profile) => (p.published ? profilesApi.unpublish(business.id, p.id) : profilesApi.publish(business.id, p.id)))
  const del = useBizMutation(business.id, (id: string) => profilesApi.remove(business.id, id))
  const manage = can('profiles.manage')
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 }
    for (const p of data ?? []) c[p.type] = (c[p.type] ?? 0) + 1
    return c
  }, [data])
  const order: Record<ProfileType, number> = { business: 0, menu: 1, product: 2, links: 3, offer: 4, event: 5, form: 6, gallery: 7, wifi: 8, custom: 9, employee: 10 }
  const list = (data ?? [])
    .filter((p) => (filter === 'all' || p.type === filter) && (!q || p.title.toLowerCase().includes(q.toLowerCase()) || p.slug.includes(q.toLowerCase())))
    .sort((a, b) => order[a.type] - order[b.type] || a.title.localeCompare(b.title))

  return (
    <>
      <PageHeader
        title="Profiles"
        description="Public pages your cards and tags open — your business page, employee cards, menus, products and more. Edits go live instantly, no reprogramming."
        actions={
          manage && (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New page
            </Button>
          )
        }
      />
      <Tabs<Filter>
        className="mb-4"
        value={filter}
        onChange={setFilter}
        tabs={(['all', 'business', 'employee', 'menu', 'product', 'custom'] as Filter[]).map((t) => ({ value: t, label: t === 'all' ? 'All' : TYPE_LABEL[t as ProfileType], count: counts[t] ?? 0 }))}
      />
      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <SearchInput value={q} onChange={setQ} placeholder="Search pages…" className="sm:w-72" />
        </div>
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={6} cols={4} />
        ) : !list.length ? (
          <EmptyState
            icon={FileText}
            title={q || filter !== 'all' ? 'No pages match' : 'No pages yet'}
            description="Create a digital menu, a product page or a custom landing page."
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
                {list.map((p) => (
                  <TR key={p.id} onClick={() => navigate(`${base}/profiles/${p.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`${base}/profiles/${p.id}`)}>
                    <TD className="max-w-[240px]">
                      <span className="block truncate font-medium">{p.title}</span>
                      <span className="block text-xs text-subtle">{p.sections.length} sections</span>
                    </TD>
                    <TD>
                      <Badge tone={p.type === 'business' ? 'accent' : 'neutral'}>{TYPE_LABEL[p.type]}</Badge>
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
                      {manage && (
                        <Menu
                          label={`Actions for ${p.title}`}
                          items={[
                            { label: 'Edit', icon: <Pencil className="h-4 w-4 text-subtle" />, onSelect: () => navigate(`${base}/profiles/${p.id}`) },
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
                            ...(p.type !== 'business' && p.type !== 'employee'
                              ? [{ label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setDeleting(p) }]
                              : []),
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
      {creating && <CreateProfileModal onClose={() => setCreating(false)} />}
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
