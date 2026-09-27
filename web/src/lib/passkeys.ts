/** Passkeys need WebAuthn and a secure context (https:// or http://localhost). */
export function passkeySupport(): 'ok' | 'insecure' | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported'
  if (!window.isSecureContext) return 'insecure'
  return typeof window.PublicKeyCredential === 'undefined' ? 'unsupported' : 'ok'
}

/** Message for a failed WebAuthn ceremony; null when the person just cancelled. */
export function passkeyErrorMessage(err: unknown): string | null {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'AbortError') return null // cancelled or timed out
  if (name === 'InvalidStateError') return 'This passkey is already registered on this account.'
  if (name === 'SecurityError') return 'Passkeys aren’t available on this address. Open the site over https.'
  return err instanceof Error && err.message ? err.message : 'The passkey couldn’t be used. Try again.'
}
