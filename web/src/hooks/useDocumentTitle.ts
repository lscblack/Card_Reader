import { useEffect } from 'react'
import { useBranding } from '@/branding/context'

/** Sets `document.title` to "<title> · <product name>" (product name from runtime branding). */
export function useDocumentTitle(title: string) {
  const { branding } = useBranding()
  useEffect(() => {
    document.title = `${title} · ${branding.product_name}`
  }, [title, branding.product_name])
}
