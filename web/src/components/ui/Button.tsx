import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent-solid text-accent-fg hover:bg-accent-solid-hover shadow-sm',
  secondary: 'bg-surface text-fg border border-border-strong hover:bg-surface-2 shadow-xs',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm dark:bg-red-500 dark:hover:bg-red-600',
  'danger-soft':
    'text-red-700 border border-red-200 bg-surface hover:bg-red-50 dark:text-red-400 dark:border-red-900/60 dark:hover:bg-red-950/40',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
  icon: 'h-9 w-9',
  'icon-sm': 'h-7 w-7',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, leftIcon, rightIcon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  )
})
