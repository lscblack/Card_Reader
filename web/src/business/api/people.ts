import { api } from '@/api/client'
import { uploadFile } from './upload'
import type { Customer, CustomerInput, Employee, EmployeeInput, Paginated, PeopleFilters } from './types'

const e = (bid: string) => `/businesses/${bid}/employees`
const cu = (bid: string) => `/businesses/${bid}/customers`

export const employeesApi = {
  list: (bid: string, f: PeopleFilters) => api.get<Paginated<Employee>>(e(bid), { ...f }),
  get: (bid: string, id: string) => api.get<Employee>(`${e(bid)}/${id}`),
  create: (bid: string, body: EmployeeInput) => api.post<Employee>(e(bid), body),
  update: (bid: string, id: string, body: Partial<EmployeeInput>) => api.patch<Employee>(`${e(bid)}/${id}`, body),
  remove: (bid: string, id: string) => api.delete(`${e(bid)}/${id}`),
  activate: (bid: string, id: string) => api.post<Employee>(`${e(bid)}/${id}/activate`),
  deactivate: (bid: string, id: string) => api.post<Employee>(`${e(bid)}/${id}/deactivate`),
  uploadPhoto: (bid: string, id: string, file: File) => uploadFile<Employee>(`${e(bid)}/${id}/photo`, file),
}

export const customersApi = {
  list: (bid: string, f: PeopleFilters) => api.get<Paginated<Customer>>(cu(bid), { ...f }),
  get: (bid: string, id: string) => api.get<Customer>(`${cu(bid)}/${id}`),
  create: (bid: string, body: CustomerInput) => api.post<Customer>(cu(bid), body),
  update: (bid: string, id: string, body: Partial<CustomerInput> & { status?: 'active' | 'inactive' }) =>
    api.patch<Customer>(`${cu(bid)}/${id}`, body),
  remove: (bid: string, id: string) => api.delete(`${cu(bid)}/${id}`),
}
