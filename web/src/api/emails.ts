import { api } from './client'
import type {
  AdminErrorDetail,
  AdminErrorEntry,
  EmailCampaign,
  EmailCta,
  EmailLog,
  EmailLogDetail,
  EmailTemplate,
  Paginated,
  RenderedEmail,
  SendEmailRequest,
} from './types'

export const adminEmailsApi = {
  send: (body: SendEmailRequest) => api.post<{ campaign_id: string; recipients: number }>('/admin/emails', body),
  preview: (body: { subject: string; body_markdown: string; cta?: EmailCta }) => api.post<RenderedEmail>('/admin/emails/preview', body),
  logs: (f: { campaign_id?: string; status?: string; q?: string; page?: number }) => api.get<Paginated<EmailLog>>('/admin/emails', f),
  log: (id: string) => api.get<EmailLogDetail>(`/admin/emails/${id}`),
  campaigns: (page = 1) => api.get<Paginated<EmailCampaign>>('/admin/email-campaigns', { page }),
  templates: () => api.get<EmailTemplate[]>('/admin/email-templates'),
  templatePreview: (name: string) => api.get<RenderedEmail>(`/admin/email-templates/${encodeURIComponent(name)}/preview`),
  sendVerification: (id: string) => api.post<{ dev_verification_url?: string | null } | null>(`/admin/accounts/${id}/send-verification`),
  sendVerificationBulk: (user_ids: string[]) =>
    api.post<{ sent: number; skipped_already_verified: number }>('/admin/accounts/send-verification', { user_ids }),
  deleteAccountAvatar: (id: string) => api.delete(`/admin/accounts/${id}/avatar`),
}

export const adminErrorsApi = {
  list: (f: { range?: string; source?: string; q?: string; only_occurring?: boolean }) => api.get<AdminErrorEntry[]>('/admin/errors', f),
  get: (ref: string, range?: string) => api.get<AdminErrorDetail>(`/admin/errors/${encodeURIComponent(ref)}`, { range }),
}
