import type { ReactNode } from 'react'
import { useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { OnceWarning, SecretReveal } from './ui/SecretReveal'

export interface OneTimeSecret {
  label: string
  value: string
  hint?: string
}

/**
 * Shows one or more plaintext secrets exactly once. The parent must drop the secrets from its
 * state in `onClose` — nothing is persisted anywhere.
 */
export function SecretsModal({
  open,
  title,
  description,
  secrets,
  onClose,
  warning,
  children,
}: {
  open: boolean
  title: string
  description?: string
  secrets: OneTimeSecret[]
  onClose: () => void
  warning?: string
  children?: ReactNode
}) {
  const [ack, setAck] = useState(false)
  const close = () => {
    setAck(false)
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      dismissible={false}
      size="lg"
      footer={
        <>
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-[13px] text-muted select-none">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong accent-[var(--accent)]"
            />
            I&apos;ve stored {secrets.length > 1 ? 'these secrets' : 'this secret'} safely
          </label>
          <Button variant="primary" onClick={close} disabled={!ack}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <OnceWarning>{warning}</OnceWarning>
        {secrets.map((s) => (
          <SecretReveal key={s.label} label={s.label} value={s.value} hint={s.hint} />
        ))}
        {children}
      </div>
    </Modal>
  )
}
