import { api } from '@/api/client'
import type { CreateApplicationRequest, CreateApplicationResponse } from '@/api/types'
import type { BusinessApplication, BusinessDevice, DeviceActivity } from './types'

export const bizAppsApi = {
  list: (bid: string) => api.get<BusinessApplication[]>(`/businesses/${bid}/applications`),
  /** Plaintext API key + webhook secret are returned once (same shape as Part 1 `POST /applications`). */
  create: (bid: string, body: CreateApplicationRequest) => api.post<CreateApplicationResponse>(`/businesses/${bid}/applications`, body),
}

export const bizDevicesApi = {
  list: (bid: string, q: { status?: string; q?: string } = {}) => api.get<BusinessDevice[]>(`/businesses/${bid}/devices`, q),
  update: (bid: string, did: string, body: { name?: string; assigned_employee_id?: string | null }) =>
    api.patch<BusinessDevice>(`/businesses/${bid}/devices/${did}`, body),
  activity: (bid: string, did: string) => api.get<DeviceActivity>(`/businesses/${bid}/devices/${did}/activity`),
  /** Part 1 endpoint (authorised for business members with devices.manage). */
  revoke: (did: string) => api.post(`/devices/${did}/revoke`),
}
