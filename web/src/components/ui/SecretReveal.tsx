import { useState, type ReactNode } from 'react'
import { AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { CopyButton } from './CopyButton'

/**
 * Displays a one-time plaintext secret. The value lives only in the parent component's state and
 * is dropped when the dialog is dismissed. It is never written to storage, the query cache or logs.
 */
export function SecretReveal({
  label,
  value,
  hint,
  defaultVisible = true,
  onCopied,
}: {
  label: string
  value: string
  hint?: string
  defaultVisible?: boolean
  onCopied?: () => void
}) {
  const [visible, setVisible] = useState(defaultVisible)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{label}</span>
        {hint && <span className="text-xs text-subtle">{hint}</span>}
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-surface-2 py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 overflow-x-auto py-1 text-[12.5px] whitespace-nowrap select-all" translate="no">
          {visible ? value : '•'.repeat(Math.min(value.length, 40))}
        </code>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-fg"
          aria-label={visible ? 'Hide secret' : 'Show secret'}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <CopyButton value={value} label="Copy" showLabel onCopied={onCopied} />
      </div>
    </div>
  )
}

export function OnceWarning({ children }: { children?: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">Copy it now — you won&apos;t see this again.</p>
        <p className="mt-0.5 opacity-90">
          {children ?? 'We only store a hash. If you lose it, create a new one and revoke the old one.'}
        </p>
      </div>
    </div>
  )
}
