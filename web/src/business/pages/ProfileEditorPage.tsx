import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ExternalLink, Eye, EyeOff, Plus, Save, Trash2, Undo2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import { Alert } from '@/components/ui/Alert'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { ProfileView } from '@/public/ProfileView'
import { DEFAULT_ACCENT, safeAccent } from '@/public/sectionUtils'
import type { Profile, ProfileTheme, Section, SectionType } from '../api/types'
import { profilesApi } from '../api/profiles'
import { useBusiness, useCan } from '../hooks/context'
import { useBizMutation, useCategories, useProfile } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { fieldErrorsOf } from '../lib/errors'
import { SLUG_RE } from '../lib/format'
import { SECTION_DEFAULTS, SECTION_META, SECTION_TYPES } from '../lib/sections'
import { PageSkeleton } from '../components/bits'
import { BizErrorState, FormError } from '../components/BizError'
import { SectionEditor } from '../components/SectionEditors'
import { UrlQrPanel } from '../components/inputs'

const SWATCHES = ['#b91c1c', '#dc2626', '#ea580c', '#d97706', '#15803d', '#0d9488', '#0369a1', '#1d4ed8', '#334155', '#111827']

interface Draft {
  title: string
  slug: string
  theme: ProfileTheme
  items: { key: string; section: Section }[]
}

let keySeq = 1
const toDraft = (p: Profile): Draft => ({
  title: p.title,
  slug: p.slug,
  theme: { accent: safeAccent(p.theme?.accent), cover_image_url: p.theme?.cover_image_url ?? '' },
  items: p.sections.map((section) => ({ key: `s${keySeq++}`, section })),
})

function AccentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Accent ${c}`}
          aria-pressed={value.toLowerCase() === c}
          onClick={() => onChange(c)}
          className={cn('h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition', value.toLowerCase() === c ? 'ring-2 ring-fg' : 'ring-1 ring-black/10 hover:scale-110')}
          style={{ background: c }}
        />
      ))}
      <label className="ml-1 inline-flex items-center gap-2 text-xs text-muted">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-border-strong bg-surface" aria-label="Custom accent colour" />
        <span className="font-mono">{value}</span>
      </label>
      {value.toLowerCase() !== DEFAULT_ACCENT && (
        <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_ACCENT)}>
          Reset
        </Button>
      )}
    </div>
  )
}

function SectionCard({
  item,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  disabled,
}: {
  item: { key: string; section: Section }
  index: number
  count: number
  onChange: (s: Section) => void
  onMove: (d: number) => void
  onRemove: () => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(true)
  const meta = SECTION_META[item.section.type]
  const Icon = meta?.icon
  return (
    <Card>
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {Icon && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold">{meta?.label ?? item.section.type}</span>
            <span className="block truncate text-xs text-subtle">{meta?.hint}</span>
          </span>
          <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} />
        </button>
        {!disabled && (
          <span className="flex shrink-0 items-center">
            <Button size="icon-sm" variant="ghost" aria-label="Move section up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Move section down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Remove section" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        )}
      </div>
      {open && (
        <fieldset disabled={disabled} className="border-t border-border px-3 py-3 sm:px-4">
          <SectionEditor section={item.section} onChange={onChange} />
        </fieldset>
      )}
    </Card>
  )
}

function AddSection({ onAdd }: { onAdd: (t: SectionType) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-dashed border-border-strong p-3">
      {open ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SECTION_TYPES.map((t) => {
            const m = SECTION_META[t]
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  onAdd(t)
                  setOpen(false)
                }}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-[13px] font-medium hover:border-border-strong hover:bg-surface-2"
              >
                <m.icon className="h-4 w-4 shrink-0 text-subtle" /> {m.label}
              </button>
            )
          })}
        </div>
      ) : (
        <Button variant="ghost" className="w-full" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
          Add section
        </Button>
      )}
    </div>
  )
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[380px] rounded-[2.2rem] border border-border-strong bg-surface-3 p-2.5 shadow-xl">
      <div className="h-[680px] overflow-y-auto rounded-[1.7rem] bg-bg" aria-label="Live preview">
        {children}
      </div>
    </div>
  )
}

export default function ProfileEditorPage() {
  const { profileId } = useParams()
  const { business, base } = useBusiness()
  const { data: profile, error, isLoading, refetch } = useProfile(business.id, profileId)
  useDocumentTitle(profile ? `Edit ${profile.title}` : 'Profile')
  const [pane, setPane] = useState<'edit' | 'preview'>('edit')
  const back = (
    <Link to={`${base}/profiles`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
      <ArrowLeft className="h-3.5 w-3.5" /> Profiles
    </Link>
  )
  if (error)
    return (
      <>
        {back}
        <Card>
          <BizErrorState error={error} onRetry={() => refetch()} />
        </Card>
      </>
    )
  if (isLoading || !profile)
    return (
      <>
        {back}
        <PageSkeleton />
      </>
    )
  // Remount the editor whenever a newer server copy arrives (e.g. after saving).
  return (
    <>
      {back}
      <Editor key={`${profile.id}:${profile.updated_at}`} profile={profile} pane={pane} setPane={setPane} />
    </>
  )
}

function Editor({ profile, pane, setPane }: { profile: Profile; pane: 'edit' | 'preview'; setPane: (p: 'edit' | 'preview') => void }) {
  const { business } = useBusiness()
  const profileId = profile.id
  const can = useCan()
  const toast = useToast()
  const onError = useErrorToast()
  const categories = useCategories()
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile))
  const manage = can('profiles.manage')
  const save = useBizMutation(business.id, (d: Draft) =>
    profilesApi.update(business.id, profileId, {
      title: d.title.trim(),
      ...(profile.type !== 'business' && d.slug !== profile.slug ? { slug: d.slug } : {}),
      theme: { accent: d.theme.accent, cover_image_url: d.theme.cover_image_url || null },
      sections: d.items.map((i) => i.section),
    }),
  )
  const publish = useBizMutation(business.id, (pub: boolean) => (pub ? profilesApi.publish(business.id, profileId) : profilesApi.unpublish(business.id, profileId)))
  const errs = fieldErrorsOf(save.error)

  const original = toDraftComparable(profile)
  const dirty = JSON.stringify(comparable(draft)) !== JSON.stringify(original)
  const slugErr = profile.type !== 'business' && !SLUG_RE.test(draft.slug) ? 'Use 3–48 lowercase letters, numbers or dashes.' : errs.slug
  const setItems = (items: Draft['items']) => setDraft({ ...draft, items })
  const categoryLabel = categories.data?.find((c) => c.code === business.category)?.label ?? business.category

  const preview = (
    <ProfileView
      preview
      business={{ name: business.name, slug: business.slug, logo_url: business.logo_url, verified: business.verified, category: categoryLabel }}
      profile={{ type: profile.type, title: draft.title || 'Untitled', theme: { ...draft.theme, cover_image_url: draft.theme.cover_image_url || null }, sections: draft.items.map((i) => i.section) }}
      vcardUrl={profile.type === 'business' || profile.type === 'employee' ? '#' : null}
    />
  )

  async function doSave() {
    try {
      await save.mutateAsync(draft)
      toast.success(profile.published ? 'Saved — live for everyone who taps.' : 'Saved as draft.')
    } catch {
      /* inline */
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="min-w-0 break-words">{profile.title}</span>
            <Badge tone={profile.type === 'business' ? 'accent' : 'neutral'} className="capitalize">
              {profile.type}
            </Badge>
            <Badge tone={profile.published ? 'success' : 'neutral'} dot>
              {profile.published ? 'Published' : 'Draft'}
            </Badge>
            {dirty && <Badge tone="warning">Unsaved changes</Badge>}
          </span>
        }
        description={`Last updated ${relativeTime(profile.updated_at)}`}
        actions={
          <>
            <a href={profile.public_url} target="_blank" rel="noreferrer">
              <Button leftIcon={<ExternalLink className="h-4 w-4" />}>View</Button>
            </a>
            {manage && (
              <>
                <Button
                  leftIcon={profile.published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  loading={publish.isPending}
                  onClick={async () => {
                    try {
                      if (dirty) await save.mutateAsync(draft)
                      await publish.mutateAsync(!profile.published)
                      toast.success(profile.published ? 'Unpublished — the page now shows a neutral message.' : 'Published — the page is live.')
                    } catch (e) {
                      onError(e)
                    }
                  }}
                >
                  {profile.published ? 'Unpublish' : 'Publish'}
                </Button>
                <Button variant="primary" leftIcon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty || !draft.title.trim() || !!slugErr} onClick={doSave}>
                  Save
                </Button>
              </>
            )}
          </>
        }
      />

      {!manage && (
        <Alert tone="info" className="mb-4">
          You can view this page but not edit it (requires “Manage public profiles”).
        </Alert>
      )}

      <Tabs<'edit' | 'preview'>
        className="mb-4 lg:hidden"
        value={pane}
        onChange={setPane}
        tabs={[
          { value: 'edit', label: 'Edit' },
          { value: 'preview', label: 'Preview' },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className={cn('min-w-0 space-y-4', pane === 'preview' && 'hidden lg:block')}>
          <FormError error={save.error && !Object.keys(errs).length ? save.error : null} />
          <Card>
            <CardHeader title="Page settings" />
            <CardBody className="space-y-4">
              <fieldset disabled={!manage} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Title" error={errs.title}>
                    {(p) => <Input {...p} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} />}
                  </Field>
                  <Field
                    label="URL"
                    error={slugErr}
                    hint={profile.type === 'business' ? 'Your business URL — change it in Business Settings.' : undefined}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={draft.slug}
                        disabled={profile.type === 'business' || !manage}
                        onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })}
                        className="font-mono"
                      />
                    )}
                  </Field>
                </div>
                <Field label="Accent colour" hint="Used for buttons and highlights. Defaults to the platform red.">
                  {() => <AccentPicker value={draft.theme.accent} onChange={(accent) => setDraft({ ...draft, theme: { ...draft.theme, accent } })} />}
                </Field>
                <Field label="Cover image URL" optional hint="Wide image shown at the top. Leave empty for a colour gradient.">
                  {(p) => (
                    <Input
                      {...p}
                      type="url"
                      placeholder="https://…/cover.jpg"
                      value={draft.theme.cover_image_url ?? ''}
                      onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, cover_image_url: e.target.value } })}
                    />
                  )}
                </Field>
              </fieldset>
            </CardBody>
          </Card>

          <div className="flex items-center justify-between gap-2 pt-2">
            <h2 className="text-[15px] font-semibold">Sections</h2>
            {dirty && manage && (
              <Button size="sm" variant="ghost" leftIcon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setDraft(toDraft(profile))}>
                Discard changes
              </Button>
            )}
          </div>
          {draft.items.map((it, i) => (
            <SectionCard
              key={it.key}
              item={it}
              index={i}
              count={draft.items.length}
              disabled={!manage}
              onChange={(section) => setItems(draft.items.map((x) => (x.key === it.key ? { ...x, section } : x)))}
              onMove={(d) => {
                const next = [...draft.items]
                const [x] = next.splice(i, 1)
                next.splice(i + d, 0, x)
                setItems(next)
              }}
              onRemove={() => setItems(draft.items.filter((x) => x.key !== it.key))}
            />
          ))}
          {draft.items.length === 0 && <p className="rounded-xl border border-border bg-surface p-6 text-center text-[13px] text-muted">No sections yet — add one below.</p>}
          {manage && <AddSection onAdd={(t) => setItems([...draft.items, { key: `s${keySeq++}`, section: { type: t, ...SECTION_DEFAULTS[t]() } as Section }])} />}

          <Card>
            <CardHeader title="Share this page" description={profile.published ? 'Live now.' : 'Publish it to make this link work.'} />
            <CardBody>
              <UrlQrPanel url={profile.public_url} label={profile.title} filename={`${profile.slug}-qr`} qrSize={132} />
            </CardBody>
          </Card>
        </div>

        <div className={cn('min-w-0', pane === 'edit' && 'hidden lg:block')}>
          <div className="lg:sticky lg:top-20">
            <p className="mb-2 text-center text-xs font-medium text-subtle">Live preview · what customers see</p>
            <PhoneFrame>{preview}</PhoneFrame>
          </div>
        </div>
      </div>
    </>
  )
}

function comparable(d: Draft) {
  return { title: d.title, slug: d.slug, theme: { accent: d.theme.accent, cover_image_url: d.theme.cover_image_url || '' }, sections: d.items.map((i) => i.section) }
}

function toDraftComparable(p: Profile) {
  return comparable(toDraft(p))
}
