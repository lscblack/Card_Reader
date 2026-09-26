import { useMemo, useState, type ReactNode } from 'react'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { EyeOff, GripVertical, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Menu } from '@/components/ui/Menu'
import { cn } from '@/lib/cn'
import type { BlockId, CardTemplateV2, SideId, TemplateZone } from '../../api/types'
import { ALL_BLOCKS, BLOCK_LABELS, resolveArrangement } from '../../lib/v2'
import { Seg } from './DesignPanel'
import type { PanelProps } from './doc'

const TRAY = '__tray'
const ZONE_NAMES: Record<string, string> = {
  info: 'Details',
  hero: 'Feature',
  brand: 'Brand',
  code: 'Code',
  mark: 'Mark',
  title: 'Title',
  foot: 'Footer',
  side: 'Side',
  main: 'Main',
  corner: 'Corner',
  center: 'Centre',
  head: 'Header',
  name: 'Name',
  meta: 'ID details',
}
const zoneName = (z: TemplateZone) => ZONE_NAMES[z.id] ?? z.id.charAt(0).toUpperCase() + z.id.slice(1)

function Chip({ id, onMove, moveTargets, dragging }: { id: BlockId; onMove?: (to: string) => void; moveTargets?: { id: string; label: string }[]; dragging?: boolean }) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-1 rounded-lg border border-border bg-surface px-1.5 py-1 text-[13px] shadow-xs', (isDragging || dragging) && 'opacity-40')}
    >
      <button type="button" {...attributes} {...listeners} className="flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md text-subtle hover:bg-surface-2 active:cursor-grabbing" aria-label={`Drag ${BLOCK_LABELS[id]}`}>
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="min-w-0 flex-1 truncate font-medium">{BLOCK_LABELS[id]}</span>
      {onMove && moveTargets && moveTargets.length > 0 && (
        <Menu label={`Move ${BLOCK_LABELS[id]}`} items={moveTargets.map((t) => ({ label: t.label, onSelect: () => onMove(t.id) }))} />
      )}
    </div>
  )
}

function Container({ id, title, hint, items, disabled, full, highlight, onHeader, children }: { id: string; title: string; hint?: string; items: BlockId[]; disabled?: boolean; full?: boolean; highlight?: boolean; onHeader?: () => void; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl border p-2 transition-colors',
        id === TRAY ? 'border-dashed border-border-strong bg-surface-2/40' : 'border-border bg-surface-2/60',
        isOver && !disabled && 'border-accent bg-accent-soft',
        disabled && 'opacity-45',
        highlight && 'ring-2 ring-accent/50',
      )}
    >
      <button type="button" onClick={onHeader} className="mb-1.5 flex w-full items-center justify-between px-1 text-left">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</span>
        <span className="text-[11px] text-subtle">{hint}</span>
      </button>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-9 flex-col gap-1.5">
          {children}
          {!items.length && <p className="px-1 py-1.5 text-xs text-subtle">{full ? 'Full' : id === TRAY ? 'Everything is on the card.' : 'Drop a block here'}</p>}
        </div>
      </SortableContext>
    </div>
  )
}

export function ArrangePanel({ doc, set, v2, side, setSide, activeZone, setActiveZone }: PanelProps & { side: SideId; setSide: (s: SideId) => void; activeZone: string | null; setActiveZone: (z: string | null) => void }) {
  const tpl = v2 as CardTemplateV2
  const arrangement = useMemo(() => resolveArrangement(tpl, doc.arrangement), [tpl, doc.arrangement])
  const sides = tpl.sides.filter((s) => s === 'front' || doc.sides_enabled.includes(s))
  const zones = useMemo(() => tpl.canvas[side]?.zones ?? [], [tpl, side])
  const placedElsewhere = useMemo(() => {
    const out: BlockId[] = []
    for (const s of tpl.sides) if (s !== side) for (const l of Object.values(arrangement[s] ?? {})) out.push(...l)
    return out
  }, [arrangement, side, tpl.sides])
  const computed = useMemo(() => {
    const c: Record<string, BlockId[]> = {}
    for (const z of zones) c[z.id] = [...(arrangement[side]?.[z.id] ?? [])]
    const used = new Set([...Object.values(c).flat(), ...placedElsewhere])
    c[TRAY] = ALL_BLOCKS.filter((b) => !used.has(b) && zones.some((z) => z.accepts.includes(b)))
    return c
  }, [zones, arrangement, side, placedElsewhere])
  const [live, setLive] = useState<Record<string, BlockId[]> | null>(null)
  const [active, setActive] = useState<BlockId | null>(null)
  const containers = live ?? computed

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const zoneById = (id: string) => zones.find((z) => z.id === id)
  const findC = (id: UniqueIdentifier) => (id in containers ? String(id) : Object.keys(containers).find((k) => containers[k].includes(id as BlockId)))
  const allowed = (cid: string, b: BlockId, from?: string) => {
    if (cid === TRAY) return true
    const z = zoneById(cid)
    if (!z || !z.accepts.includes(b)) return false
    return from === cid || (containers[cid]?.length ?? 0) < z.max_blocks
  }

  const commit = (c: Record<string, BlockId[]>) => {
    const next = Object.fromEntries(Object.entries(c).filter(([k]) => k !== TRAY))
    set((d) => ({ ...d, arrangement: { ...resolveArrangement(tpl, d.arrangement), [side]: next } }))
  }

  const moveTo = (b: BlockId, to: string) => {
    const from = findC(b)
    if (!from || !allowed(to, b, from)) return
    const c = Object.fromEntries(Object.entries(containers).map(([k, v]) => [k, v.filter((x) => x !== b)]))
    c[to] = [...c[to], b]
    commit(c)
  }

  const onStart = (e: DragStartEvent) => {
    setActive(e.active.id as BlockId)
    setLive(structuredClone(computed))
  }
  const onOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || !live) return
    const from = findC(a.id)
    const to = findC(over.id)
    if (!from || !to || from === to || !allowed(to, a.id as BlockId, from)) return
    setLive((prev) => {
      if (!prev) return prev
      const src = prev[from].filter((x) => x !== a.id)
      const dst = [...prev[to]]
      const idx = dst.indexOf(over.id as BlockId)
      dst.splice(idx >= 0 ? idx : dst.length, 0, a.id as BlockId)
      return { ...prev, [from]: src, [to]: dst }
    })
  }
  const onEnd = ({ active: a, over }: DragEndEvent) => {
    let c = live ?? computed
    if (over) {
      const cid = findC(a.id)
      const oid = findC(over.id)
      if (cid && cid === oid) {
        const list = c[cid]
        const i = list.indexOf(a.id as BlockId)
        const j = list.indexOf(over.id as BlockId)
        if (i >= 0 && j >= 0 && i !== j) c = { ...c, [cid]: arrayMove(list, i, j) }
      }
    }
    setLive(null)
    setActive(null)
    commit(c)
  }

  const targetsFor = (b: BlockId, current: string) => [
    ...zones.filter((z) => z.id !== current && allowed(z.id, b)).map((z) => ({ id: z.id, label: `Move to ${zoneName(z)}` })),
    ...(current !== TRAY ? [{ id: TRAY, label: 'Hide from card' }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {sides.length > 1 ? (
          <Seg<SideId>
            label="Side"
            value={side}
            onChange={(s) => {
              setSide(s)
              setActiveZone(null)
            }}
            options={sides.map((s) => ({ value: s, label: s === 'front' ? 'Front' : 'Back' }))}
          />
        ) : (
          <span className="text-xs text-subtle">Single-sided card</span>
        )}
        <Button size="sm" variant="ghost" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => set((d) => ({ ...d, arrangement: tpl.default_arrangement }))}>
          Reset
        </Button>
      </div>
      <p className="text-xs text-subtle">Drag blocks between areas (or use the ⋯ menu). Tap an area on the card to find it here. Each block can be used once.</p>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => (setLive(null), setActive(null))}>
        <div className="space-y-2.5">
          {zones.map((z) => {
            const items = containers[z.id] ?? []
            const blocked = !!active && !allowed(z.id, active, findC(active))
            return (
              <Container
                key={z.id}
                id={z.id}
                title={zoneName(z)}
                hint={`${items.length}/${z.max_blocks}`}
                items={items}
                disabled={blocked}
                full={items.length >= z.max_blocks}
                highlight={activeZone === z.id}
                onHeader={() => setActiveZone(activeZone === z.id ? null : z.id)}
              >
                {items.map((b) => (
                  <Chip key={b} id={b} onMove={(to) => moveTo(b, to)} moveTargets={targetsFor(b, z.id)} />
                ))}
              </Container>
            )
          })}
          <Container id={TRAY} title="Hidden blocks" items={containers[TRAY] ?? []} hint={placedElsewhere.length ? `${placedElsewhere.length} on the ${side === 'front' ? 'back' : 'front'}` : undefined}>
            {(containers[TRAY] ?? []).map((b) => (
              <Chip key={b} id={b} onMove={(to) => moveTo(b, to)} moveTargets={targetsFor(b, TRAY)} />
            ))}
          </Container>
        </div>
        <DragOverlay>{active ? <div className="rounded-lg border border-accent bg-surface px-3 py-2 text-[13px] font-medium shadow-lg">{BLOCK_LABELS[active]}</div> : null}</DragOverlay>
      </DndContext>
      {placedElsewhere.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-subtle">
          <EyeOff className="h-3.5 w-3.5" /> On the {side === 'front' ? 'back' : 'front'}: {placedElsewhere.map((b) => BLOCK_LABELS[b]).join(', ')}
        </p>
      )}
    </div>
  )
}
