import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'
import { api, clientId, request } from './client'
import type {
  ChangePasswordRequest,
  EmailCodeStart,
  LoginConfirm,
  LoginOut,
  LoginRequest,
  MySessions,
  Passkey,
  RegisterRequest,
  ResetPasswordRequest,
  ResendVerificationResponse,
  BusinessCategory,
  TokenResponse,
  UpdateMeRequest,
  User,
  WebAuthnStart,
} from './types'

export const authApi = {
  login: (body: LoginRequest) => request<LoginOut>('POST', '/auth/login', { body: { ...body, client_id: clientId() }, auth: false }),
  loginConfirm: (challenge_id: string, code?: string) =>
    request<LoginOut>('POST', '/auth/login/confirm', { body: { challenge_id, code: code || undefined }, auth: false }),
  loginResend: (challenge_id: string) =>
    request<Pick<LoginConfirm, 'expires_at' | 'dev_code'>>('POST', '/auth/login/resend', { body: { challenge_id }, auth: false }),
  emailCode: (email: string) => request<EmailCodeStart>('POST', '/auth/email-code', { body: { email, client_id: clientId() }, auth: false }),
  emailCodeVerify: (challenge_id: string, code: string) =>
    request<LoginOut>('POST', '/auth/email-code/verify', { body: { challenge_id, code }, auth: false }),
  passkeyLoginOptions: () => request<WebAuthnStart<PublicKeyCredentialRequestOptionsJSON>>('POST', '/auth/passkeys/login/options', { body: { client_id: clientId() }, auth: false }),
  passkeyLoginVerify: (challenge_id: string, credential: AuthenticationResponseJSON) =>
    request<LoginOut>('POST', '/auth/passkeys/login/verify', { body: { challenge_id, credential }, auth: false }),
  logout: () => request<void>('POST', '/auth/logout', { quiet: true }),
  sessions: () => api.get<MySessions>('/auth/sessions'),
  signOutMobile: () => api.delete('/auth/sessions/mobile'),
  passkeys: () => api.get<Passkey[]>('/auth/passkeys'),
  passkeyRegisterOptions: () => api.post<WebAuthnStart<PublicKeyCredentialCreationOptionsJSON>>('/auth/passkeys/register/options', {}),
  passkeyRegisterVerify: (challenge_id: string, credential: RegistrationResponseJSON, name?: string) =>
    api.post<Passkey>('/auth/passkeys/register/verify', { challenge_id, credential, name: name || undefined }),
  deletePasskey: (id: string) => api.delete(`/auth/passkeys/${id}`),
  register: (body: RegisterRequest) =>
    request<TokenResponse>('POST', '/auth/register', { body: { ...body, client_id: clientId() }, auth: false }),
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
type AreaUser = { role?: string; account_type?: string; memberships?: unknown[] } | null | undefined

/** The signed-in areas of the app. Each account type has exactly one home area. */
export type Area = 'dashboard' | 'business' | 'me' | 'admin'

export function areaOf(path: string): Area | null {
  const seg = path.split(/[?#]/)[0].split('/')[1]
  return seg === 'dashboard' || seg === 'business' || seg === 'me' || seg === 'admin' ? seg : null
}

/**
 * Who may enter which area. Admins can inspect developer and business areas; personal accounts
 * only have /me; business accounts reach /dashboard just for their workspace sandbox.
 */
export function canEnter(user: AreaUser, area: Area | null, path = ''): boolean {
  if (!user) return false
  if (!area) return true
  const admin = user.role === 'admin'
  switch (area) {
    case 'admin':
      return admin
    case 'me':
      return user.account_type === 'personal'
    case 'business':
      return admin || user.account_type === 'business' || (user.memberships?.length ?? 0) > 0
    case 'dashboard':
      if (admin || user.account_type === 'developer' || !user.account_type) return true
      return user.account_type === 'business' && path.startsWith('/dashboard/sandbox')
  }
}

export function homePathFor(user: { role?: string; account_type?: string } | null | undefined): string {
  if (!user) return '/login'
  if (user.role === 'admin') return '/admin'
  if (user.account_type === 'business') return '/business'
  if (user.account_type === 'personal') return '/me'
  return '/dashboard'
}
