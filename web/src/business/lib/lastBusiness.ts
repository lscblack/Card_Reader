const KEY = 'nfc.business.last'

export function getLastBusiness(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastBusiness(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
}
