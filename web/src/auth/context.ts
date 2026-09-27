import { createContext, useContext } from 'react'
import type { LoginConfirm, LoginOut, LoginRequest, RegisterRequest, User } from '@/api/types'

export interface RestoreProblem {
  /** Human-readable reason (rate limited, server error, offline…). */
  message: string
  /** Seconds until the next automatic retry. */
  retryIn: number
  attempt: number
}

export interface AuthState {
  user: User | null
  /**
   * 'loading' also covers "restoring the session is temporarily failing" (see `restoreProblem`):
   * the token is kept and retried; only 401 / 403 account_disabled end the session.
   */
  status: 'loading' | 'authenticated' | 'anonymous'
  restoreProblem: RestoreProblem | null
  /** Retry restoring the session immediately. */
  retryRestore: () => void
  /** Signs in, or returns the confirmation step (emailed code / "sign out the other browser"). */
  login: (body: LoginRequest) => Promise<LoginConfirm | null>
  /** Finishes any sign-in answer: stores the token when `status: ok`, else returns the confirmation step. */
  completeLogin: (res: LoginOut) => LoginConfirm | null
  register: (body: RegisterRequest) => Promise<User>
  logout: () => void
  setUser: (u: User) => void
  /** Re-fetch /auth/me (e.g. after verifying the email). */
  refreshUser: () => Promise<void>
  /** Development only: verification link returned by register/resend (never persisted). */
  devVerificationUrl: string | null
  setDevVerificationUrl: (url: string | null) => void
  /** Why the last session ended on its own (another browser signed in, or it was revoked). */
  endReason: 'replaced' | 'revoked' | null
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
