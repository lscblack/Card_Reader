/**
 * JWT storage. localStorage is used for simplicity; an httpOnly, SameSite cookie issued by the
 * backend would be a stronger option (see README "Security notes").
 * Only the dashboard JWT is ever persisted — never API keys or webhook secrets.
 */
const KEY = 'nfc.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  localStorage.setItem(KEY, token)
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
