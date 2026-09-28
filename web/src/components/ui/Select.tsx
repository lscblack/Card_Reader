import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn, defaultWidth } from '@/lib/cn'
import { FloatingPanel } from './Popover'
import { useDismiss } from './useDismiss'

/** Lists longer than this get a search box (unless `searchable` says otherwise). */
const SEARCH_THRESHOLD = 8

export const selectControl =
  'min-w-0 rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle shadow-xs transition-colors ' +
  'focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/20'

interface Opt {
  value: string
  label: string
  disabled: boolean
  /** `<option hidden>`: a placeholder shown in the trigger but never listed. */
  hidden?: boolean
  group?: string
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** Reads <option>/<optgroup> children (including fragments and mapped arrays). */
function readOptions(children: ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const el = child as ReactElement<{ value?: unknown; disabled?: boolean; hidden?: boolean; label?: string; children?: ReactNode }>
    if (el.type === 'option') {
      const label = textOf(el.props.children)
      out.push({ value: el.props.value != null ? String(el.props.value) : label, label, disabled: !!el.props.disabled, hidden: !!el.props.hidden, group })
    } else if (el.type === 'optgroup') {
      readOptions(el.props.children, el.props.label, out)
    } else if (el.props.children) {
      readOptions(el.props.children, group, out) // fragments
    }
  })
  return out
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Sets a native <select>'s value the way the browser would, so React's onChange fires normally. */
function commitNative(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Force the searchable list on/off. Default: on when there are more than 8 options. */
  searchable?: boolean
  /** Placeholder for the search box. */
  searchPlaceholder?: string
  /** `lg` matches `<Input inputSize="lg">`. */
  controlSize?: 'md' | 'lg'
  /** Rich rendering of an option (list and trigger) in the searchable list, e.g. a flag before the name. */
  renderOption?: (option: { value: string; label: string }) => ReactNode
}

/**
 * Drop-in `<select>`: same props and `<option>` children. Short lists use the native control;
 * long lists render a searchable, keyboard-friendly listbox in a floating layer that is never
 * clipped. A hidden native select keeps form semantics (name, required, onChange events).
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { searchable, searchPlaceholder, className, children, multiple, size, controlSize = 'md', renderOption, ...rest },
  ref,
) {
  const options = useMemo(() => readOptions(children), [children])
  const useList = !multiple && !size && (searchable ?? options.length > SEARCH_THRESHOLD)
  if (!useList) {
    return (
      <select ref={ref} multiple={multiple} size={size} className={cn(selectControl, defaultWidth(className), multiple ? 'py-1.5' : cn(controlSize === 'lg' ? 'h-11 text-[15px]' : 'h-9', 'pr-8'), className)} {...rest}>
        {children}
      </select>
    )
  }
  return (
    <SearchableSelect ref={ref} options={options} controlSize={controlSize} className={className} searchPlaceholder={searchPlaceholder} renderOption={renderOption} {...rest}>
      {children}
    </SearchableSelect>
  )
})

const SearchableSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { options: Opt[]; searchPlaceholder?: string; controlSize?: 'md' | 'lg'; renderOption?: SelectProps['renderOption'] }
>(function SearchableSelect({ options, searchPlaceholder = 'Search…', controlSize = 'md', renderOption, className, children, id, style, ...rest }, ref) {
  const nativeRef = useRef<HTMLSelectElement>(null)
  useImperativeHandle(ref, () => nativeRef.current as HTMLSelectElement)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  // Controlled via `value`, otherwise mirror the native select (defaultValue / form resets).
  const controlled = rest.value !== undefined
  const [inner, setInner] = useState<string>(() =>
    rest.defaultValue !== undefined ? String(rest.defaultValue) : (options.find((o) => !o.disabled)?.value ?? ''),
  )
  const current = controlled ? String(rest.value ?? '') : inner
  const selected = options.find((o) => o.value === current)

  const filtered = useMemo(() => {
    const q = fold(query.trim())
    const listed = options.filter((o) => !o.hidden)
    if (!q) return listed
    const hits = listed.filter((o) => fold(o.label).includes(q) || fold(o.value).includes(q))
    // An exact value match (e.g. a country code) comes first.
    return [...hits.filter((o) => fold(o.value) === q), ...hits.filter((o) => fold(o.value) !== q)]
  }, [options, query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])
  useDismiss(open, close, [anchorRef, panelRef])

  const openList = () => {
    if (rest.disabled) return
    setOpen(true)
    const i = options.filter((o) => !o.hidden).findIndex((o) => o.value === current)
    setActive(Math.max(0, i))
  }

  useEffect(() => {
    if (!open) return
    const t = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, filtered])

  const pick = (o: Opt) => {
    if (o.disabled) return
    if (!controlled) setInner(o.value)
    if (nativeRef.current) commitNative(nativeRef.current, o.value)
    close()
    anchorRef.current?.focus()
  }

  const move = (dir: 1 | -1) => {
    if (!filtered.length) return
    let i = active
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length
      if (!filtered[i].disabled) break
    }
    setActive(i)
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(Math.max(0, filtered.length - 1))
    else if (e.key === 'Enter') {
      const o = filtered[active]
      if (o) pick(o)
    } else if (e.key === 'Tab') close()
    else return
    e.preventDefault()
  }

  const onTriggerKey = (e: KeyboardEvent) => {
    if (open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openList()
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Start typing to search, like a native select's type-ahead.
      openList()
      setQuery(e.key)
    }
  }

  let lastGroup: string | undefined
  return (
    <div className={cn('relative min-w-0', defaultWidth(className), className)} style={style}>
      <select
        ref={nativeRef}
        {...rest}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        onChange={(e) => {
          if (!controlled) setInner(e.target.value)
          rest.onChange?.(e)
        }}
      >
        {children}
      </select>
      <button
        ref={anchorRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={rest['aria-invalid']}
        aria-describedby={rest['aria-describedby']}
        aria-label={rest['aria-label']}
        disabled={rest.disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        className={cn(selectControl, 'relative flex w-full items-center pr-8 text-left', controlSize === 'lg' ? 'h-11 text-[15px]' : 'h-9')}
      >
        {selected && renderOption ? (
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{renderOption(selected)}</span>
        ) : (
          <span className={cn('min-w-0 flex-1 truncate', !selected?.label && 'text-subtle')}>{selected?.label || 'Select…'}</span>
        )}
        <ChevronDown
          className={cn('pointer-events-none absolute right-2.5 h-4 w-4 text-subtle transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      <FloatingPanel anchorRef={anchorRef} panelRef={panelRef} open={open} matchWidth maxHeight={340} className="min-w-[220px]">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onListKey}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            className="h-10 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
          />
          <span className="shrink-0 text-[11px] text-subtle tabular-nums">{filtered.length}</span>
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label={rest['aria-label'] ?? 'Options'} className="min-h-0 flex-1 overflow-y-auto p-1">
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-subtle">No matches for “{query}”</li>}
          {filtered.map((o, i) => {
            const header = o.group && o.group !== lastGroup ? o.group : null
            lastGroup = o.group
            const isSel = o.value === current
            return (
              <li key={`${o.group ?? ''}:${o.value}:${i}`} role="presentation">
                {header && <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{header}</p>}
                <div
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={o.disabled || undefined}
                  onMouseMove={() => active !== i && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px]',
                    i === active && 'bg-surface-2',
                    isSel && 'font-medium text-fg',
                    o.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {renderOption ? (
                    <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{renderOption(o)}</span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{o.label || <span className="text-subtle">—</span>}</span>
                  )}
                  {isSel && <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
                </div>
              </li>
            )
          })}
        </ul>
      </FloatingPanel>
    </div>
  )
})
