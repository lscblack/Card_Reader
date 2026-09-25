import { useState } from 'react'
import { cn } from '@/lib/cn'

function initials(name: string | null | undefined, email: string | null | undefined) {
  const src = (name ?? '').trim() || (email ?? '')
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

const sizes = { xs: 'h-6 w-6 text-[10px]', sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-[13px]', lg: 'h-14 w-14 text-base', xl: 'h-20 w-20 text-xl' }

/** User avatar: uploaded image (Part 3 §4) or initials on the accent tint. */
export function Avatar({
  src,
  name,
  email,
  size = 'sm',
  className,
}: {
  src?: string | null
  name?: string | null
  email?: string | null
  size?: keyof typeof sizes
  className?: string
}) {
  const [broken, setBroken] = useState<string | null>(null)
  const show = src && broken !== src
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-semibold text-accent', sizes[size], className)}>
      {show ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBroken(src)} />
      ) : (
        <span aria-hidden="true">{initials(name, email)}</span>
      )}
    </span>
  )
}
