import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for non-secure contexts (e.g. LAN IP over http during development).
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function CopyButton({
  value,
  label = 'Copy',
  className,
  showLabel = false,
  onCopied,
}: {
  value: string
  label?: string
  className?: string
  showLabel?: boolean
  onCopied?: () => void
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 1600)
    return () => clearTimeout(t)
  }, [state])

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(value)
        setState(ok ? 'copied' : 'failed')
        if (ok) onCopied?.()
      }}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-3 hover:text-fg',
        className,
      )}
      aria-label={state === 'copied' ? 'Copied' : label}
      title={label}
    >
      {state === 'copied' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {(showLabel || state !== 'idle') && (
        <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}</span>
      )}
    </button>
  )
}
