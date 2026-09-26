import type { ReactNode } from 'react'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface HandleProps {
  /** Spread on the drag handle button. */
  handle: Record<string, unknown>
  dragging: boolean
}

function Row({ id, children, className }: { id: string; className?: string; children: (h: HandleProps) => ReactNode }) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(className, isDragging && 'relative z-10 opacity-90 shadow-lg')}>
      {children({ handle: { ...attributes, ...listeners }, dragging: isDragging })}
    </div>
  )
}

/** Drag handle button (pointer, touch and keyboard: space to lift, arrows to move). */
export function DragHandle({ handle, label, className }: { handle: Record<string, unknown>; label: string; className?: string }) {
  return (
    <button type="button" {...handle} aria-label={label} className={cn('flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-subtle hover:bg-surface-2 hover:text-fg active:cursor-grabbing', className)}>
      <GripVertical className="h-4 w-4" />
    </button>
  )
}

/** Reorderable list (drag & drop via @dnd-kit). Ids are positional; the order only changes on drop. */
export function SortableList<T>({
  items,
  onReorder,
  children,
  grid,
  className,
  itemClassName,
  idPrefix = 'i',
}: {
  items: T[]
  onReorder: (next: T[]) => void
  children: (item: T, index: number, h: HandleProps) => ReactNode
  grid?: boolean
  className?: string
  itemClassName?: string
  idPrefix?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = items.map((_, i) => `${idPrefix}-${i}`)
  const onEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = ids.indexOf(String(e.active.id))
    const to = ids.indexOf(String(e.over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(items, from, to))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
      <SortableContext items={ids} strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}>
        <div className={className}>
          {items.map((it, i) => (
            <Row key={ids[i]} id={ids[i]} className={itemClassName}>
              {(h) => children(it, i, h)}
            </Row>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
