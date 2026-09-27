import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

/** One large field for a 6-digit emailed code: numeric keypad, OS autofill and paste friendly. */
export const CodeInput = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (code: string) => void
    /** Called once all 6 digits are in. */
    onComplete?: (code: string) => void
    disabled?: boolean
    id?: string
    'aria-invalid'?: boolean
    'aria-describedby'?: string
  }
>(function CodeInput({ value, onChange, onComplete, disabled, ...rest }, ref) {
  return (
    <input
      ref={ref}
      {...rest}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, '').slice(0, 6)
        onChange(next)
        if (next.length === 6 && next !== value) onComplete?.(next)
      }}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={12}
      placeholder="••••••"
      aria-label={rest.id ? undefined : 'Sign-in code'}
      className={cn(
        'h-14 w-full rounded-lg border border-border-strong bg-surface px-3 text-center font-mono text-[26px] font-semibold tracking-[0.5em] text-fg shadow-xs transition-colors',
        'placeholder:text-subtle/60 focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none disabled:opacity-60',
        'aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/20',
      )}
    />
  )
})
