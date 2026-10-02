import { api, request } from './client'

export type SupportCategory = 'billing' | 'technical' | 'account' | 'cards' | 'feedback' | 'other'
export type SupportStatus = 'open' | 'in_progress' | 'resolved'

export interface SupportTicket {
  id: string
  name: string
  email: string
  phone: string | null
  category: SupportCategory
  subject: string
  message: string
  status: SupportStatus
  admin_note: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  /** The account that sent it (admin view; null for guests). */
  user: { id: string; email: string; full_name: string; account_type: string } | null
}

export interface SupportTicketInput {
  name: string
  email: string
  phone?: string | null
  category: SupportCategory
  subject: string
  message: string
}

export const supportApi = {
  /** Works signed in or not (the token is sent when there is one). */
  create: (body: SupportTicketInput) => request<SupportTicket>('POST', '/support/tickets', { body, quiet: true }),
  mine: () => api.get<SupportTicket[]>('/support/tickets'),
}

export interface AdminSupportPage {
  items: SupportTicket[]
  total: number
  page: number
  page_size: number
  counts: Record<SupportStatus, number>
  /** Times the Support page was opened in the last 30 days. */
  page_visits_30d: number
}

export const adminSupportApi = {
  list: (params: { status?: SupportStatus | null; q?: string; page?: number }) =>
    api.get<AdminSupportPage>('/admin/support', { status: params.status ?? undefined, q: params.q, page: params.page, page_size: 25 }),
  update: (id: string, body: { status?: SupportStatus; admin_note?: string | null }) => api.patch<SupportTicket>(`/admin/support/${id}`, body),
}

export interface AdminPayments {
  enabled: boolean
  switched_on: boolean
  mode: 'test' | 'live' | null
  source: 'admin' | 'env' | 'none'
  publishable_key: string | null
  secret_key_hint: string | null
  webhook_secret_set: boolean
  webhook_url: string
}

export const adminPaymentsApi = {
  get: () => api.get<AdminPayments>('/admin/payments'),
  update: (body: { enabled?: boolean; secret_key?: string; publishable_key?: string; webhook_secret?: string }) =>
    api.patch<AdminPayments>('/admin/payments', body),
  test: () => api.post<{ ok: boolean; account: string; mode: string }>('/admin/payments/test'),
}

export const SUPPORT_CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'billing', label: 'Billing & payments' },
  { value: 'technical', label: 'Technical issue' },
  { value: 'account', label: 'Account & sign-in' },
  { value: 'cards', label: 'Cards & NFC' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'other', label: 'Something else' },
]

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }
