import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { useToast } from '@/components/ui/toastContext'
import { cn } from '@/lib/cn'
import type { PageTemplate, Profile, ProfileType } from '../../api/types'
import { profilesApi } from '../../api/profiles'
import { useBusiness } from '../../hooks/context'
import { useBizMutation } from '../../hooks/queries'
import { fieldErrorsOf, formLevelError } from '../../lib/errors'
import { SLUG_RE, slugify } from '../../lib/format'
import { BLANK_SECTIONS, PAGE_TYPE_META, PAGE_TYPES, type CreatablePageType } from '../../lib/pages'
import { FormError } from '../BizError'
import { TemplateGallery, TemplateThumb } from './TemplateGallery'

type Step = 'type' | 'template' | 'details'

/**
 * "New page" (Part 6): page type → template gallery (system + mine, live thumbnails) → title & URL.
 * With `pageType` the type is fixed (e.g. from the action configurator); `onCreated` replaces navigating to the editor.
 */
export function NewPageModal({
  open,
  onClose,
  pageType,
  template: initialTemplate,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  pageType?: ProfileType | null
  template?: PageTemplate | null
  onCreated?: (p: Profile) => void
}) {
  const { business, base } = useBusiness()
  const navigate = useNavigate()
  const toast = useToast()
  const fixed = pageType && pageType !== 'business' && pageType !== 'employee' ? (pageType as CreatablePageType) : null
  const [type, setType] = useState<CreatablePageType | null>(initialTemplate ? (initialTemplate.page_type as CreatablePageType) : fixed)
  const [tpl, setTpl] = useState<PageTemplate | null>(initialTemplate ?? null)
  const [blank, setBlank] = useState(false)
  const [step, setStep] = useState<Step>(initialTemplate ? 'details' : fixed ? 'template' : 'type')
  const [title, setTitle] = useState(initialTemplate?.name ?? '')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const effSlug = slugTouched ? slug : slugify(title)
  const create = useBizMutation(business.id, () =>
    profilesApi.create(business.id, {
      type: tpl ? (tpl.page_type as CreatablePageType) : type!,
      title: title.trim(),
      slug: effSlug,
      ...(tpl ? { template_id: tpl.id } : { sections: BLANK_SECTIONS[type!], theme: { accent: '#b91c1c', layout: 'classic' } }),
    }),
  )
  const errs = fieldErrorsOf(create.error)
  const slugErr = effSlug && !SLUG_RE.test(effSlug) ? 'Use 3–48 lowercase letters, numbers or dashes.' : errs.slug

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const p = await create.mutateAsync(undefined)
      toast.success(onCreated ? `“${p.title}” created and selected.` : 'Page created — make it yours, then publish it.')
      onClose()
      if (onCreated) onCreated(p)
      else navigate(`${base}/profiles/${p.id}`)
    } catch {
      /* inline */
    }
  }

  const pick = (t: PageTemplate) => {
    setTpl(t)
    setBlank(false)
    if (!title.trim() || title === tpl?.name) setTitle(t.name)
    setStep('details')
  }
  const back = () => setStep(step === 'details' ? (initialTemplate ? 'details' : 'template') : fixed ? 'template' : 'type')

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={step === 'template' ? 'xl' : 'lg'}
      title={step === 'type' ? 'New page' : step === 'template' ? `Choose a ${type ? PAGE_TYPE_META[type].label.toLowerCase() : ''} template` : 'Name your page'}
      description={
        step === 'type'
          ? 'Pages open when someone taps a card or tag — no website needed. Pick what you want to build.'
          : step === 'template'
            ? 'Previews use your business name, logo and details. You can change everything afterwards.'
            : 'You can change the title and URL any time.'
      }
      footer={
        step === 'details' ? (
          <>
            {!initialTemplate && (
              <Button leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={back}>
                Back
              </Button>
            )}
            <Button variant="primary" type="submit" form="new-page" loading={create.isPending} disabled={!title.trim() || !!slugErr}>
              Create page
            </Button>
          </>
        ) : step === 'template' && !fixed ? (
          <Button leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={back}>
            Back
          </Button>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )
      }
    >
      {step === 'type' && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="list">
          {PAGE_TYPES.map((t) => {
            const m = PAGE_TYPE_META[t]
            return (
              <button
                key={t}
                type="button"
                role="listitem"
                onClick={() => {
                  setType(t)
                  setTpl(null)
                  if (t === 'custom') {
                    setBlank(true)
                    setTitle('')
                    setStep('details')
                  } else setStep('template')
                }}
                className="flex items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <m.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{m.label}</span>
                  <span className="block text-xs text-subtle">{m.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
      {step === 'template' && type && (
        <TemplateGallery
          pageType={type}
          selectedId={tpl?.id}
          onPick={pick}
          blankSelected={blank}
          onBlank={() => {
            setTpl(null)
            setBlank(true)
            if (!title.trim()) setTitle(PAGE_TYPE_META[type].label)
            setStep('details')
          }}
        />
      )}
      {step === 'details' && (
        <form id="new-page" onSubmit={submit} className={cn('grid gap-5', tpl && 'sm:grid-cols-[204px_minmax(0,1fr)]')} noValidate>
          {tpl && (
            <div className="hidden sm:block">
              <TemplateThumb template={tpl} height={300} />
              <p className="mt-2 text-[13px] font-semibold">{tpl.name}</p>
              <p className="text-xs text-subtle">{PAGE_TYPE_META[tpl.page_type as CreatablePageType]?.label} template</p>
            </div>
          )}
          <div className="space-y-4">
            <FormError error={formLevelError(create.error, ['slug', 'title'])} />
            <Field label="Title" error={errs.title} hint="Shown at the top of the page.">
              {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Dinner menu" data-autofocus />}
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
            <p className="text-xs text-subtle">The page starts as a draft — publish it from the editor when it’s ready.</p>
          </div>
        </form>
      )}
    </Modal>
  )
}

/** "Save as template": stores the page's layout, theme and content as one of the business's templates. */
export function SaveTemplateModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { business } = useBusiness()
  const toast = useToast()
  const [name, setName] = useState(profile.title)
  const [description, setDescription] = useState('')
  const save = useBizMutation(business.id, () => profilesApi.saveAsTemplate(business.id, profile.id, { name: name.trim(), description: description.trim() || undefined }))
  const errs = fieldErrorsOf(save.error)
  return (
    <Modal
      open
      onClose={onClose}
      title="Save as template"
      description="Reuse this page’s layout, theme and content — e.g. the same menu for every branch. Images are kept by reference."
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
                toast.success(`“${name.trim()}” saved to My templates.`)
                onClose()
              } catch {
                /* inline */
              }
            }}
          >
            Save template
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={formLevelError(save.error, ['name', 'description'])} />
        <Field label="Template name" error={errs.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-autofocus />}
        </Field>
        <Field label="Description" optional error={errs.description}>
          {(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="What is it for?" />}
        </Field>
      </div>
    </Modal>
  )
}
