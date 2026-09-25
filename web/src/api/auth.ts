import { api, request } from './client'
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  ResendVerificationResponse,
  BusinessCategory,
  TokenResponse,
  UpdateMeRequest,
  User,
} from './types'

export const authApi = {
  login: (body: LoginRequest) => request<TokenResponse>('POST', '/auth/login', { body, auth: false }),
  register: (body: RegisterRequest) => request<TokenResponse>('POST', '/auth/register', { body, auth: false }),
  me: () => api.get<User>('/auth/me'),
  updateMe: (body: UpdateMeRequest) => api.patch<User>('/auth/me', body),
  changePassword: (body: ChangePasswordRequest) => api.post<void>('/auth/change-password', body),
  forgotPassword: (email: string) => request<void>('POST', '/auth/forgot-password', { body: { email }, auth: false }),
  resetPassword: (body: ResetPasswordRequest) =>
    request<void>('POST', '/auth/reset-password', { body, auth: false }),
  verifyEmail: (token: string) => request<void>('POST', '/auth/verify-email', { body: { token }, auth: false }),
  resendVerification: () => api.post<ResendVerificationResponse | null>('/auth/resend-verification'),
  uploadAvatar: (file: File) => api.upload<User>('/auth/me/avatar', file),
  deleteAvatar: () => api.delete<User>('/auth/me/avatar'),
  businessCategories: () => request<BusinessCategory[]>('GET', '/meta/business-categories', { auth: false }),
}

/** Where a freshly signed-in user lands by default (Part 2 routing). */
export function homePathFor(user: { role?: string; account_type?: string } | null | undefined): string {
  if (!user) return '/login'
  if (user.role === 'admin') return '/admin'
  if (user.account_type === 'business') return '/business'
  return '/dashboard'
}
