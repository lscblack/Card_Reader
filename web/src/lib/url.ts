import { API_BASE_URL } from '@/api/client'

/** Only allow same-origin relative paths as post-login redirect targets (no open redirects). */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

// ---------- Rendering user-controlled URLs (public pages, cards, contacts) ----------

const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function isRelativePath(v: string): boolean {
  return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\')
}

/**
 * A stored URL that is safe to use as an `href`: http(s), mailto:, tel: or a same-origin relative path.
 * Anything else (javascript:, data:, vbscript:, garbage) → null, so callers render plain text instead of a link.
 */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  if (isRelativePath(v)) return v
  try {
    const u = new URL(v)
    return LINK_SCHEMES.has(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

function apiOrigin(): string | null {
  try {
    return new URL(API_BASE_URL).origin
  } catch {
    return null
  }
}

/**
 * A stored image URL that is safe for `<img src>` / CSS: any https URL, http only for the platform's own
 * uploads (API origin or a `/media/` path), same-origin relative paths, local previews (blob:, data:image/…).
 */
export function safeImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  if (isRelativePath(v)) return v
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(v)) return v
  try {
    const u = new URL(v)
    if (u.protocol === 'https:' || u.protocol === 'blob:') return u.href
    if (u.protocol === 'http:' && (u.origin === apiOrigin() || u.origin === window.location.origin || u.pathname.startsWith('/media/'))) return u.href
    return null
  } catch {
    return null
  }
}

/** `background-image` value for a stored image URL (quoted, validated), or undefined when unsafe/empty. */
export function cssImage(raw: unknown): string | undefined {
  const u = safeImageUrl(raw)
  return u ? `url("${u.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")` : undefined
}

export interface UrlCheck {
  level: 'ok' | 'warn' | 'error'
  message: string | null
}

const DEV_HOSTS = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i

/**
 * Client-side hints mirroring contract §5. The server is authoritative (it also does DNS-based
 * SSRF checks); this only gives early feedback.
 */
export function checkEndpointUrl(value: string): UrlCheck {
  const v = value.trim()
  if (!v) return { level: 'ok', message: null }
  if (v.length > 2048) return { level: 'error', message: 'URL must be at most 2048 characters.' }
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return { level: 'error', message: 'Enter a full URL, e.g. https://api.example.com/nfc/card' }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { level: 'error', message: 'Only https:// URLs are accepted.' }
  }
  if (u.username || u.password) return { level: 'error', message: 'Credentials in the URL (user:pass@) are not allowed.' }
  if (v.includes('#')) return { level: 'error', message: 'URL fragments (#…) are not allowed.' }
  if (u.protocol === 'http:') {
    if (DEV_HOSTS.test(u.hostname)) {
      return {
        level: 'warn',
        message: 'Plain http:// to a local/private host is only accepted when the server runs in development mode.',
      }
    }
    return { level: 'error', message: 'Endpoints must use https:// (http is only allowed for local hosts in development).' }
  }
  if (DEV_HOSTS.test(u.hostname)) {
    return { level: 'warn', message: 'Private/loopback hosts are rejected outside development (SSRF protection).' }
  }
  return { level: 'ok', message: null }
}

// ---------- Endpoint domain allowlist (contract §7.1) ----------

export const MAX_ALLOWED_DOMAINS = 20

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6 = /^[0-9a-f:]+$/i
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

function isHostname(h: string): boolean {
  if (h.length > 253 || !h.includes('.')) return h === 'localhost'
  return h.split('.').every((l) => LABEL.test(l))
}

/**
 * Normalises and validates one allowlist entry. Returns `{ value }` (lowercased) or `{ error }`.
 * Accepted: exact host (`api.example.com`), leading wildcard (`*.example.com`), IP literal.
 */
export function parseAllowedDomain(raw: string): { value?: string; error?: string } {
  const v = raw.trim().toLowerCase()
  if (!v) return { error: 'Enter a domain.' }
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(v)) return { error: 'Remove the scheme (https://) — enter just the host.' }
  if (/[/?#]/.test(v)) return { error: 'No paths, queries or fragments — enter just the host.' }
  if (IPV4.test(v)) return { value: v }
  if (v.includes(':')) {
    if (IPV6.test(v) && v.split(':').length > 2) return { value: v }
    return { error: 'No ports — enter just the host.' }
  }
  if (v.startsWith('*.')) {
    const rest = v.slice(2)
    if (rest.includes('*')) return { error: 'Only one wildcard is allowed, as the first label (*.example.com).' }
    if (!rest.includes('.') || !isHostname(rest)) return { error: 'Use a wildcard over a real domain, e.g. *.example.com.' }
    return { value: v }
  }
  if (v.includes('*')) return { error: 'Wildcards are only allowed as the first label: *.example.com.' }
  if (!isHostname(v)) return { error: 'Not a valid hostname.' }
  return { value: v }
}

/** Does `host` match any entry? `*.example.com` matches subdomains only, not `example.com` itself. */
export function hostMatchesAllowlist(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return domains.some((d) => {
    if (d.startsWith('*.')) {
      const suffix = d.slice(1) // ".example.com"
      return h.endsWith(suffix) && h.length > suffix.length
    }
    return h === d
  })
}

/** Returns the URL's host if it does NOT match a non-empty allowlist, else null. */
export function endpointOutsideAllowlist(url: string | null | undefined, domains: string[]): string | null {
  if (!url || !domains.length) return null
  try {
    const host = new URL(url.trim()).hostname
    return hostMatchesAllowlist(host, domains) ? null : host
  } catch {
    return null
  }
}

/** Validates an allowed browser origin: `scheme://host[:port]`, no path, no trailing slash (contract §7.2). */
export function parseOrigin(raw: string): { value?: string; error?: string; warning?: string } {
  const v = raw.trim().toLowerCase()
  if (!v) return { error: 'Enter an origin, e.g. https://dashboard.example.com' }
  if (!/^https?:\/\//.test(v)) return { error: 'Must start with https:// (or http:// in development).' }
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return { error: 'Not a valid origin.' }
  }
  if (u.username || u.password) return { error: 'No credentials allowed.' }
  const rest = v.slice(u.protocol.length + 2 + u.host.length)
  if (rest) return { error: rest === '/' ? 'Remove the trailing slash.' : 'No path, query or fragment — scheme://host[:port] only.' }
  if (v !== u.origin) return { error: `Use the canonical form: ${u.origin}` }
  return { value: u.origin, warning: u.protocol === 'http:' ? 'http:// origins are only accepted when the server runs in development.' : undefined }
}
