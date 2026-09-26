import { useState } from 'react'

export function useCopy(): [boolean, (v: string) => Promise<void>] {
  const [copied, setCopied] = useState(false)
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = v
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* ignore */
      }
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return [copied, copy]
}


/** Guess a platform icon from a URL. */
export function iconForUrl(url: string): string {
  const u = url.toLowerCase()
  if (u.startsWith('tel:')) return 'phone'
  if (u.startsWith('mailto:')) return 'email'
  for (const k of ['instagram', 'youtube', 'facebook', 'linkedin', 'tiktok', 'github', 'spotify', 'pinterest', 'snapchat'])
    if (u.includes(k)) return k
  if (u.includes('wa.me') || u.includes('whatsapp')) return 'whatsapp'
  if (u.includes('t.me')) return 'telegram'
  if (u.includes('x.com') || u.includes('twitter.com')) return 'x'
  if (u.includes('maps')) return 'map'
  return 'link'
}
