import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'

export { Select, type SelectProps } from './Select'

const control =
  'w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle shadow-xs transition-colors ' +
  'focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/20'

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** `lg`: taller, roomier field for auth and other short, focused forms. */
  inputSize?: 'md' | 'lg'
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, inputSize = 'md', ...rest }, ref) {
  return <input ref={ref} className={cn(control, inputSize === 'lg' ? 'h-11 text-[15px]' : 'h-9', className)} {...rest} />
})

/** Password field with a show / hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(function PasswordInput({ inputSize, style, ...rest }, ref) {
  const [shown, setShown] = useState(false)
  const lg = inputSize === 'lg'
  return (
    <div className="relative">
      <Input ref={ref} {...rest} inputSize={inputSize} type={shown ? 'text' : 'password'} style={{ ...style, paddingRight: lg ? 48 : 40 }} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        disabled={rest.disabled}
        className={cn('absolute top-1/2 right-1 flex -translate-y-1/2 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-fg', lg ? 'h-9 w-10' : 'h-7 w-8')}
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(control, 'min-h-[80px] py-2', className)} {...rest} />
})

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode
  className?: string
  optional?: boolean
}

/** Label + control + hint/error with correct a11y wiring. */
export function Field({ label, hint, error, children, className, optional }: FieldProps) {
  const id = useId()
  const descId = `${id}-desc`
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-fg">
        {label}
        {optional && <span className="ml-1 font-normal text-subtle">(optional)</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? descId : undefined })}
      {error ? (
        <p id={descId} className="text-[12.5px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="text-[12.5px] text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent-solid' : 'bg-surface-3 ring-1 ring-inset ring-border-strong',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
