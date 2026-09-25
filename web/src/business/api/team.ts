import { api, request } from '@/api/client'
import type { BusinessRole, Invitation, Member, Permission, PublicInvitation } from './types'

const t = (bid: string) => `/businesses/${bid}`

export const teamApi = {
  members: (bid: string) => api.get<Member[] | { items: Member[] }>(`${t(bid)}/members`),
  updateMember: (bid: string, mid: string, body: { role?: BusinessRole; extra_permissions?: Permission[]; status?: 'active' | 'suspended' }) =>
    api.patch<Member>(`${t(bid)}/members/${mid}`, body),
  removeMember: (bid: string, mid: string) => api.delete(`${t(bid)}/members/${mid}`),
  invitations: (bid: string) => api.get<Invitation[] | { items: Invitation[] }>(`${t(bid)}/invitations`),
  invite: (bid: string, body: { email: string; role: BusinessRole }) => api.post<Invitation>(`${t(bid)}/invitations`, body),
  revoke: (bid: string, iid: string) => api.post<Invitation>(`${t(bid)}/invitations/${iid}/revoke`),
  resend: (bid: string, iid: string) => api.post<Invitation>(`${t(bid)}/invitations/${iid}/resend`),
}

export const inviteApi = {
  get: (token: string) => request<PublicInvitation>('GET', `/invitations/${encodeURIComponent(token)}`, { auth: false }),
  accept: (token: string) => api.post<{ business_id?: string } | null>(`/invitations/${encodeURIComponent(token)}/accept`),
}
