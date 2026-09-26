import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { FloatingPanel } from './Popover'
import { useDismiss } from './useDismiss'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * Small accessible dropdown menu (row actions, user menu). The panel is rendered in a floating
 * layer, so it is never cut off by cards or tables with hidden overflow.
 */
export function Menu({
  items,
  trigger,
  label = 'Actions',
  align = 'right',
  header,
}: {
  items: MenuItem[]
  trigger?: ReactNode
  label?: string
  align?: 'left' | 'right'
  header?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, [anchorRef, panelRef])

  const focusItem = (dir: 1 | -1 | 'first' | 'last') => {
    const els = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])
    if (!els.length) return
    const i = els.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      dir === 'first' ? 0 : dir === 'last' ? els.length - 1 : i < 0 ? 0 : (i + dir + els.length) % els.length
    els[next]?.focus()
  }

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') focusItem(1)
    else if (e.key === 'ArrowUp') focusItem(-1)
    else if (e.key === 'Home') focusItem('first')
    else if (e.key === 'End') focusItem('last')
    else if (e.key === 'Tab') close()
    else return
    e.preventDefault()
  }

  return (
    <div className="relative inline-block text-left">
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
            requestAnimationFrame(() => focusItem('first'))
          }
        }}
        className={cn(
          trigger
            ? 'rounded-lg'
            : 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" />}
      </button>
      <FloatingPanel
        anchorRef={anchorRef}
        panelRef={panelRef}
        open={open}
        align={align}
        id={menuId}
        role="menu"
        ariaLabel={label}
        className="min-w-[200px] p-1"
      >
        {/* Portals still bubble React events: keep clicks from reaching clickable table rows/cards. */}
        <div className="overflow-y-auto" onClick={(e) => e.stopPropagation()} onKeyDown={onPanelKey}>
          {header}
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false)
                anchorRef.current?.focus()
                it.onSelect()
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors outline-none disabled:opacity-50',
                it.danger
                  ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 dark:focus-visible:bg-red-500/10'
                  : 'hover:bg-surface-2 focus-visible:bg-surface-2',
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      </FloatingPanel>
    </div>
  )
}
