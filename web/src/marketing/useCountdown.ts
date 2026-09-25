import { useEffect, useState } from 'react'

/**
 * Live "2d 04:13:09" countdown; null once expired, or while more than `withinMs` remain
 * (so it only shows when an offer ends soon).
 */
export function useCountdown(endsAt: string | null | undefined, withinMs = Infinity): string | null {
  const end = endsAt ? Date.parse(endsAt) : NaN
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (Number.isNaN(end)) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [end])
  if (Number.isNaN(end)) return null
  const ms = end - now
  if (ms <= 0 || ms > withinMs) return null
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${d > 0 ? `${d}d ` : ''}${hh}:${mm}:${ss}`
}
