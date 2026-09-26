import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { PageTemplate, ProfileTheme, ProfileType, Section } from '../../api/types'
import { useBusiness } from '../../hooks/context'
import { templateFor } from '../../lib/pages'
import { TemplateGallery } from './TemplateGallery'

type Mode = 'design' | 'all'

/**
 * Switch template while editing. "Design only" swaps layout, colours, fonts and header and keeps every section;
 * "Design + content" also replaces the sections with the template's sample content.
 */
export function ChangeTemplateModal({
  pageType,
  onClose,
  onApply,
}: {
  pageType: ProfileType
  onClose: () => void
  onApply: (filled: { theme: ProfileTheme; sections: Section[] }, withContent: boolean) => void
}) {
  const { business } = useBusiness()
  const [tpl, setTpl] = useState<PageTemplate | null>(null)
  const [mode, setMode] = useState<Mode>('design')
  const apply = () => {
    if (!tpl) return
    if (mode === 'all' && !window.confirm('Replace all sections with the template’s sample content? Unsaved section edits will be lost (you can still discard before saving).')) return
    onApply(templateFor(tpl, business), mode === 'all')
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Change template"
      description="Try a different look. Nothing is saved until you press Save."
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="What to apply">
            {(
              [
                ['design', 'Design only', 'Keeps your content'],
                ['all', 'Design + content', 'Uses sample content'],
              ] as const
            ).map(([v, label, hint]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={mode === v}
                onClick={() => setMode(v)}
                className={cn('rounded-md px-3 py-1.5 text-left', mode === v ? 'bg-surface shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg')}
              >
                <span className="block text-[13px] font-medium">{label}</span>
                <span className="block text-[11px] text-subtle">{hint}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!tpl} onClick={apply}>
              {tpl ? `Apply “${tpl.name}”` : 'Pick a template'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[62dvh] overflow-y-auto pr-1">
        <TemplateGallery pageType={pageType} selectedId={tpl?.id} onPick={setTpl} />
      </div>
    </Modal>
  )
}
