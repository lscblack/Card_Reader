import { api, request } from './client'
import type { Branding, BrandingAssetVariant, FontOption } from './types'

export const brandingApi = {
  get: () => request<Branding>('GET', '/meta/branding', { auth: false }),
  fonts: () => request<FontOption[]>('GET', '/meta/fonts', { auth: false }),
  update: (body: Partial<Branding>) => api.patch<Branding>('/admin/branding', body),
  uploadAsset: (variant: BrandingAssetVariant, file: File) => api.upload<Branding>('/admin/branding/assets', file, { variant }),
  deleteAsset: (variant: BrandingAssetVariant) => api.delete<Branding>('/admin/branding/assets', { variant }),
}
