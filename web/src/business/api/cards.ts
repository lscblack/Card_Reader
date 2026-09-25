import { api } from '@/api/client'
import type {
  Action,
  ActionPreview,
  ActionTypeDef,
  AssigneeType,
  BulkCreateCardsRequest,
  Card,
  CardFilters,
  CardHistoryEntry,
  CardStats,
  CardTap,
  CreateCardRequest,
  Paginated,
  UpdateCardRequest,
} from './types'

const c = (bid: string) => `/businesses/${bid}/cards`

export const cardsApi = {
  list: (bid: string, f: CardFilters) => api.get<Paginated<Card>>(c(bid), { ...f }),
  get: (bid: string, cid: string) => api.get<Card>(`${c(bid)}/${cid}`),
  create: (bid: string, body: CreateCardRequest) => api.post<Card>(c(bid), body),
  bulk: (bid: string, body: BulkCreateCardsRequest) => api.post<Card[] | { items: Card[] }>(`${c(bid)}/bulk`, body),
  update: (bid: string, cid: string, body: UpdateCardRequest) => api.patch<Card>(`${c(bid)}/${cid}`, body),
  remove: (bid: string, cid: string) => api.delete(`${c(bid)}/${cid}`),
  assign: (bid: string, cid: string, assignee_type: AssigneeType, assignee_id: string) =>
    api.post<Card>(`${c(bid)}/${cid}/assign`, { assignee_type, assignee_id }),
  unassign: (bid: string, cid: string) => api.post<Card>(`${c(bid)}/${cid}/unassign`),
  activate: (bid: string, cid: string) => api.post<Card>(`${c(bid)}/${cid}/activate`),
  deactivate: (bid: string, cid: string) => api.post<Card>(`${c(bid)}/${cid}/deactivate`),
  history: (bid: string, cid: string) => api.get<CardHistoryEntry[] | Paginated<CardHistoryEntry>>(`${c(bid)}/${cid}/history`),
  taps: (bid: string, cid: string, page: number) => api.get<Paginated<CardTap>>(`${c(bid)}/${cid}/taps`, { page }),
  stats: (bid: string, cid: string, range: string) => api.get<CardStats>(`${c(bid)}/${cid}/stats`, { range }),
}

export const actionsApi = {
  types: () => api.get<ActionTypeDef[]>('/actions/types'),
  preview: (bid: string, action: Action, card_id?: string) =>
    api.post<ActionPreview>(`/businesses/${bid}/actions/preview`, { action, card_id }),
}
