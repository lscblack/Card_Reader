/**
 * JWT storage. localStorage is used for simplicity; an httpOnly, SameSite cookie issued by the
 * backend would be a stronger option (see README "Security notes").
 * Only the dashboard JWT is ever persisted — never API keys or webhook secrets.
 *
 * Each tab keeps its own token (sessionStorage), so signing in to another account in a second tab
 * never swaps the account under a tab that is already open. localStorage only remembers the most
 * recent sign-in, which a newly opened tab starts with.
 */
const KEY = 'nfc.token'

function read(store: Storage): string | null {
  try {
    return store.getItem(KEY)
  } catch {
    return null
  }
}

function write(store: Storage, token: string | null): void {
  try {
    if (token == null) store.removeItem(KEY)
    else store.setItem(KEY, token)
  } catch {
    /* storage blocked (private mode, quota): the token lives only as long as the page */
  }
}

export function getToken(): string | null {
  const own = read(sessionStorage)
  if (own) return own
  // A new tab: adopt the latest sign-in and keep it for this tab from now on.
  const latest = read(localStorage)
  if (latest) write(sessionStorage, latest)
  return latest
}

export function setToken(token: string): void {
  write(sessionStorage, token)
  write(localStorage, token)
}

export function clearToken(): void {
  const own = read(sessionStorage)
  write(sessionStorage, null)
  // Forget the shared sign-in only if it is this tab's account (another tab may have signed in since).
  if (own == null || read(localStorage) === own) write(localStorage, null)
}
