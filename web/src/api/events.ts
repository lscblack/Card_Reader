import { api } from './client'
import type { Delivery, DeliveryFilters, EventFilters, NfcEvent, NfcEventDetail, Paginated } from './types'

export const eventsApi = {
  list: (filters: EventFilters = {}) => api.get<Paginated<NfcEvent>>('/events', { ...filters }),
  get: (id: string) => api.get<NfcEventDetail>(`/events/${id}`),
  redeliver: (id: string) => api.post<Delivery>(`/events/${id}/redeliver`),
}

export const deliveriesApi = {
  list: (filters: DeliveryFilters = {}) => api.get<Paginated<Delivery>>('/deliveries', { ...filters }),
}
