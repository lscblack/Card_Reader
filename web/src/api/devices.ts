import { api } from './client'
import type { Device, DeviceStatus } from './types'

export const devicesApi = {
  list: (filters: { application_id?: string; status?: DeviceStatus | '' } = {}) =>
    api.get<Device[]>('/devices', filters),
  get: (id: string) => api.get<Device>(`/devices/${id}`),
  rename: (id: string, name: string) => api.patch<Device>(`/devices/${id}`, { name }),
  revoke: (id: string) => api.post<Device>(`/devices/${id}/revoke`),
  remove: (id: string) => api.delete(`/devices/${id}`),
}
