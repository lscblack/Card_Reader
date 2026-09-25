import { useApplications } from '@/hooks/queries'
import { Select } from './ui/Input'
import { cn } from '@/lib/cn'

/** Application picker. `allowAll` adds an "All applications" option with value "". */
export function AppSelect({
  value,
  onChange,
  allowAll = false,
  className,
  id,
  'aria-label': ariaLabel = 'Application',
}: {
  value: string
  onChange: (id: string) => void
  allowAll?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}) {
  const { data, isLoading } = useApplications()
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading}
      className={cn('sm:w-56', className)}
    >
      {allowAll && <option value="">All applications</option>}
      {!allowAll && !value && <option value="">Select an application…</option>}
      {data?.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {!a.is_active ? ' (inactive)' : ''}
        </option>
      ))}
    </Select>
  )
}
