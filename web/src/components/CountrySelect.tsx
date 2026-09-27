import { forwardRef, useMemo } from 'react'
import { Select } from '@/components/ui/Select'
import { countries } from '@/lib/countries'
import { Flag } from './Flag'

export type CountrySelectProps = {
  value: string
  onChange: (code: string) => void
  size?: 'md' | 'lg'
  /** Shown while nothing is chosen. */
  placeholder?: string
  /** Lets the user pick "nothing" again (listed with `emptyLabel`). */
  allowEmpty?: boolean
  emptyLabel?: string
  /** Extra choices listed first, e.g. `{ value: 'none', label: 'No country' }`. */
  extraOptions?: { value: string; label: string }[]
  id?: string
  name?: string
  disabled?: boolean
  required?: boolean
  className?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-label'?: string
}

/** Searchable country picker with flags; value is an ISO-3166 alpha-2 code ('' = none). */
export const CountrySelect = forwardRef<HTMLSelectElement, CountrySelectProps>(function CountrySelect(
  { value, onChange, size = 'md', placeholder = 'Choose a country…', allowEmpty, emptyLabel = '—', extraOptions, ...rest },
  ref,
) {
  const list = useMemo(() => countries(), [])
  const extra = useMemo(() => new Set(extraOptions?.map((o) => o.value)), [extraOptions])
  return (
    <Select
      ref={ref}
      {...rest}
      searchable
      searchPlaceholder="Search countries…"
      controlSize={size}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      renderOption={(o) =>
        !o.value ? (
          <span className="truncate text-subtle">{o.label}</span>
        ) : extra.has(o.value) ? (
          <span className="truncate">{o.label}</span>
        ) : (
          <>
            <Flag code={o.value} />
            <span className="truncate">{o.label}</span>
            <span className="ml-auto pl-2 font-mono text-[11px] text-subtle">{o.value}</span>
          </>
        )
      }
    >
      <option value="" hidden={!allowEmpty}>
        {allowEmpty ? emptyLabel : placeholder}
      </option>
      {extraOptions?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {list.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </Select>
  )
})
