import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Branding } from '@/api/types'
import { brandingApi } from '@/api/branding'
import { setDefaultThemeMode } from '@/hooks/useTheme'
import { applyBranding } from './apply'
import { BrandingContext, type BrandingState } from './context'
import { BRANDING_CACHE_KEY, DEFAULT_BRANDING } from './defaults'

function normalise(b: Partial<Branding> | null | undefined): Branding {
  return {
    ...DEFAULT_BRANDING,
    ...(b ?? {}),
    fonts: { ...DEFAULT_BRANDING.fonts, ...(b?.fonts ?? {}) },
    theme: { ...DEFAULT_BRANDING.theme, ...(b?.theme ?? {}) },
    social_links: b?.social_links ?? [],
  }
}

function readCache(): Branding {
  try {
    const raw = localStorage.getItem(BRANDING_CACHE_KEY)
    return normalise(raw ? (JSON.parse(raw) as Partial<Branding>) : null)
  } catch {
    return DEFAULT_BRANDING
  }
}

function writeCache(b: Branding) {
  try {
    localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(b))
  } catch {
    /* ignore */
  }
}

function applyAll(b: Branding) {
  applyBranding(b)
  setDefaultThemeMode(b.theme.default_mode)
}

/**
 * Loads GET /meta/branding (cached in localStorage for an instant first paint, then revalidated)
 * and applies it globally. Mount once, high in the tree.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setState] = useState<Branding>(() => {
    const b = readCache()
    applyAll(b)
    return b
  })
  const [loading, setLoading] = useState(true)

  const setBranding = useCallback((b: Branding) => {
    const n = normalise(b)
    applyAll(n)
    writeCache(n)
    setState(n)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setBranding(await brandingApi.get())
    } catch {
      // Keep cached/default branding when the API is unreachable or predates Part 3.
    } finally {
      setLoading(false)
    }
  }, [setBranding])

  useEffect(() => {
    void refresh()
    let last = Date.now()
    const onFocus = () => {
      // Revalidate at most once a minute (the API caches branding for 60 s anyway).
      if (Date.now() - last < 60_000) return
      last = Date.now()
      void refresh()
    }
    const t = setInterval(() => void refresh(), 5 * 60_000)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const value = useMemo<BrandingState>(() => ({ branding, loading, refresh, setBranding }), [branding, loading, refresh, setBranding])
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}
