import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, Check, CloudUpload, ExternalLink, LayoutTemplate, Loader2, Maximize2, Minimize2, Minus, Palette, Plus, Redo2, RotateCw, Share2, SquarePen, Undo2, Blocks } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Alert } from '@/components/ui/Alert'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useFocusMode } from '@/hooks/useShellChrome'
import { cn } from '@/lib/cn'
import { BizErrorState } from '@/business/components/BizError'
import { PageSkeleton } from '@/business/components/bits'
import { formatError } from '@/business/lib/errors'
import { isV2, type DigitalCard, type SideId } from '../api/types'
import { cardsApi } from '../api/personal'
import { pk, usePCard, useTemplates } from '../hooks/queries'
import { useHistory } from '../hooks/useHistory'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { renderableOf, templateFor } from '../lib/card'
import { DigitalCardRender, type CardAudience } from '../components/DigitalCardRender'
import { diffPatch, docFromCard, type EditorDoc, type PanelProps } from '../components/editor/doc'
import { TemplatesPanel } from '../components/editor/TemplatesPanel'
import { DesignPanel, Seg } from '../components/editor/DesignPanel'
import { ContentPanel } from '../components/editor/ContentPanel'
import { ArrangePanel } from '../components/editor/ArrangePanel'
import { SharePanel } from '../components/editor/SharePanel'

type Tab = 'templates' | 'design' | 'content' | 'arrange' | 'share'
const TABS: { value: Tab; label: string; icon: typeof Palette }[] = [
  { value: 'templates', label: 'Templates', icon: LayoutTemplate },
  { value: 'design', label: 'Design', icon: Palette },
  { value: 'content', label: 'Content', icon: SquarePen },
  { value: 'arrange', label: 'Arrange', icon: Blocks },
  { value: 'share', label: 'Share', icon: Share2 },
]

type SaveState = { kind: 'saved' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'error'; message: string }

function SaveIndicator({ state }: { state: SaveState }) {
  const map = {
    saved: { icon: Check, text: 'All changes saved', cls: 'text-emerald-600 dark:text-emerald-400' },
    dirty: { icon: CloudUpload, text: 'Unsaved changes…', cls: 'text-subtle' },
    saving: { icon: Loader2, text: 'Saving…', cls: 'text-subtle' },
    error: { icon: AlertCircle, text: 'Not saved', cls: 'text-red-600 dark:text-red-400' },
  }[state.kind]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', map.cls)} role="status" aria-live="polite" title={state.kind === 'error' ? state.message : undefined}>
      <map.icon className={cn('h-3.5 w-3.5', state.kind === 'saving' && 'animate-spin')} /> {map.text}
    </span>
  )
}

function Editor({ card }: { card: DigitalCard }) {
  const qc = useQueryClient()
  const templates = useTemplates()
  const history = useHistory<EditorDoc>(docFromCard(card))
  const doc = history.value
  const [base, setBase] = useState<EditorDoc>(() => docFromCard(card))
  const [save, setSave] = useState<SaveState>({ kind: 'saved' })
  const [tab, setTab] = useState<Tab>('templates')
  const [side, setSide] = useState<SideId>('front')
  const [zoom, setZoom] = useState(100)
  const [audience, setAudience] = useState<CardAudience>('public')
  const [activeZone, setActiveZone] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  const template = templateFor(doc.template_id, templates.data)
  const v2 = isV2(template) ? template : null
  const link = card.business_link
  const locked = (k: string) => !!link?.locked_fields.includes(k)
  const inFlight = useRef(false)
  const desktop = useMediaQuery('(min-width: 1024px)')
  const { focus, setFocus } = useFocusMode()

  // Autosave: 900 ms after the last change, PATCH only what differs from the last saved version.
  const patch = diffPatch(doc, base, locked)
  const patchKey = patch ? JSON.stringify(patch) : ''
  useEffect(() => {
    if (!patchKey) return
    const t = setTimeout(async () => {
      if (inFlight.current) return
      inFlight.current = true
      setSave({ kind: 'saving' })
      try {
        const body = JSON.parse(patchKey) as ReturnType<typeof diffPatch>
        const saved = await cardsApi.update(card.id, body!)
        setBase(docFromCard(saved))
        setSave({ kind: 'saved' })
        void qc.invalidateQueries({ queryKey: pk.all })
      } catch (e) {
        setSave({ kind: 'error', message: formatError(e) })
      } finally {
        inFlight.current = false
      }
    }, 900)
    return () => clearTimeout(t)
  }, [patchKey, card.id, qc])
  const saveState: SaveState = patchKey && save.kind === 'saved' ? { kind: 'dirty' } : save

  // Undo / redo shortcuts (ignored while typing in a text field that has its own undo).
  const { undo, redo } = history
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Full screen: Escape exits unless a dialog or popup menu is handling it; leaving the editor always exits.
  useEffect(() => {
    if (!focus) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return
      setFocus(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, setFocus])
  useEffect(() => () => setFocus(false), [setFocus])

  const hasBack = !!v2?.canvas.back && doc.sides_enabled.includes('back')
  const panelProps: PanelProps = { doc, set: history.set, card, template, v2, locked }
  const tabs = TABS.filter((t) => t.value !== 'arrange' || v2)
  const activeTab: Tab = tab === 'arrange' && !v2 ? 'design' : tab
  const renderCard = {
    ...renderableOf(card),
    design: doc.design,
    fields: doc.fields,
    visibility: doc.visibility,
    arrangement: doc.arrangement,
    sides_enabled: doc.sides_enabled,
  }
  const canvasWidth = (v2?.format === 'portrait' ? 340 : 560) * (zoom / 100)

  const panel = (
    <div className="p-4">
      {activeTab === 'templates' && <TemplatesPanel {...panelProps} />}
      {activeTab === 'design' && <DesignPanel {...panelProps} />}
      {activeTab === 'content' && <ContentPanel {...panelProps} />}
      {activeTab === 'arrange' && v2 && <ArrangePanel {...panelProps} side={side} setSide={setSide} activeZone={activeZone} setActiveZone={setActiveZone} />}
      {activeTab === 'share' && <SharePanel {...panelProps} />}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/me/cards" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> My cards
        </Link>
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">{doc.label || card.label}</h1>
        {card.is_primary && <Badge tone="accent">Primary</Badge>}
        {card.status === 'inactive' && <Badge tone="warning">Inactive</Badge>}
        <span className="ml-auto flex items-center gap-2">
          <SaveIndicator state={saveState} />
          <Button size="icon-sm" variant="ghost" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setFocus(!focus)}
            aria-pressed={focus}
            aria-label={focus ? 'Exit full screen (Esc)' : 'Full screen'}
            title={focus ? 'Exit full screen (Esc)' : 'Full screen'}
          >
            {focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <a href={card.public_url} target="_blank" rel="noreferrer" className="hidden sm:inline-flex">
            <Button size="sm" leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>
              View
            </Button>
          </a>
        </span>
      </div>
      {link && (
        <Alert tone="info" title={`Issued by ${link.business_name}`}>
          {link.locked_fields.length ? `Managed by your company: ${link.locked_fields.map((f) => f.replace(/_/g, ' ')).join(', ')}.` : 'This card is linked to your company.'}
          {link.template_locked && ' The template and design are set by your company.'}
        </Alert>
      )}
      {save.kind === 'error' && (
        <Alert tone="danger" title="Your last change wasn’t saved">
          {save.message}
        </Alert>
      )}

      <Card
        className={cn(
          'overflow-hidden lg:grid lg:min-h-[620px] lg:grid-cols-[76px_360px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]',
          focus ? 'lg:h-[calc(100dvh-5rem)]' : 'lg:h-[calc(100dvh-13rem)]',
        )}
      >
        {/* Rail (desktop) */}
        <nav className="hidden border-r border-border bg-surface-2/40 py-2 lg:block" aria-label="Editor sections">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-current={activeTab === t.value ? 'page' : undefined}
              className={cn('mx-auto flex w-[64px] flex-col items-center gap-1 rounded-lg py-2.5 text-[11px] font-medium transition-colors', activeTab === t.value ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')}
            >
              <t.icon className="h-5 w-5" /> {t.label}
            </button>
          ))}
        </nav>
        {/* Panel (desktop) */}
        {desktop && <div className="overflow-y-auto border-r border-border">{panel}</div>}

        {/* Canvas */}
        <div className="flex min-w-0 flex-col bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:18px_18px]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/90 px-3 py-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              {hasBack && (
                <>
                  <Seg<SideId>
                    label="Side"
                    value={side}
                    onChange={setSide}
                    options={[
                      { value: 'front', label: 'Front' },
                      { value: 'back', label: 'Back' },
                    ]}
                  />
                  <Button size="sm" variant="ghost" leftIcon={<RotateCw className="h-3.5 w-3.5" />} onClick={() => setSide((s) => (s === 'front' ? 'back' : 'front'))}>
                    Flip
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Seg<CardAudience>
                label="View as"
                value={audience}
                onChange={setAudience}
                options={[
                  { value: 'public', label: 'Public', title: 'What anyone with your link sees' },
                  { value: 'contacts', label: 'Contact', title: 'What people you exchange with see' },
                ]}
              />
              <span className="hidden items-center gap-0.5 sm:inline-flex">
                <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(50, z - 10))}>
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <button type="button" onClick={() => setZoom(100)} className="w-11 text-center font-mono text-xs text-muted" title="Reset zoom">
                  {zoom}%
                </button>
                <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(160, z + 10))}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </span>
            </div>
          </div>
          <div className="flex min-h-[260px] flex-1 items-center justify-center overflow-auto p-5 sm:p-8">
            <div style={{ width: canvasWidth, maxWidth: zoom <= 100 ? '100%' : undefined }} className="shrink-0">
              <DigitalCardRender
                card={renderCard}
                template={template}
                side={side}
                onSideChange={hasBack ? setSide : undefined}
                audience={audience}
                qrValue={card.public_url}
                editing
                highlightZone={activeTab === 'arrange' ? activeZone : null}
                onZoneClick={
                  v2
                    ? (s, z) => {
                        setSide(s)
                        setActiveZone(z)
                        setTab('arrange')
                        setSheetOpen(true)
                      }
                    : undefined
                }
              />
            </div>
          </div>
          {v2 && <p className="pb-3 text-center text-xs text-subtle">Tip: click an area of the card to rearrange what’s in it.</p>}
        </div>
      </Card>

      {/* Mobile: tabs + bottom sheet panel */}
      {!desktop && (
      <div>
        <div className={cn('sticky bottom-0 z-20 rounded-t-2xl border border-border bg-surface shadow-[0_-8px_24px_-12px_rgba(0,0,0,.25)] sm:mx-0', focus ? '-mx-3' : '-mx-4')}>
          <div className="flex items-center justify-between gap-1 overflow-x-auto border-b border-border px-2 pt-2">
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  setTab(t.value)
                  setSheetOpen(true)
                }}
                aria-current={activeTab === t.value ? 'page' : undefined}
                className={cn('flex min-w-[64px] flex-1 flex-col items-center gap-0.5 rounded-t-lg px-2 py-2 text-[11px] font-medium', activeTab === t.value ? 'text-accent' : 'text-muted')}
              >
                <t.icon className="h-5 w-5" /> {t.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setSheetOpen((o) => !o)} className="mx-auto my-1 block h-1.5 w-10 rounded-full bg-border-strong" aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'} />
          {sheetOpen && <div className="max-h-[60vh] overflow-y-auto">{panel}</div>}
        </div>
      </div>
      )}
    </div>
  )
}

export default function CardEditorPage() {
  const { cardId } = useParams()
  const { data, error, isLoading, refetch } = usePCard(cardId)
  const templates = useTemplates()
  useDocumentTitle(data ? `Edit ${data.label}` : 'Edit card')
  if (error) return <BizErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !data || templates.isLoading) return <PageSkeleton />
  return <Editor key={data.id} card={data} />
}
