import { createContext, useContext } from 'react'
import type { LayoutSpec, Palette } from './theme'

export interface PageCtxValue {
  layout: LayoutSpec
  palette: Palette
  /** Editor / template preview: no network calls, placeholders for empty media. */
  preview: boolean
  businessSlug: string
  profileSlug: string | null
  businessName: string
  /** Absolute page URL (for calendar files). */
  pageUrl: string
}

export const PageCtx = createContext<PageCtxValue | null>(null)

export function usePage(): PageCtxValue {
  const v = useContext(PageCtx)
  if (!v) throw new Error('usePage outside PageView')
  return v
}
