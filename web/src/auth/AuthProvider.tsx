import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { ApiError, onUnauthorized } from '@/api/client'
import type { LoginConfirm, LoginOut, TokenResponse, User } from '@/api/types'
import { clearToken, getToken, setToken } from './tokenStore'
import { AuthContext, type AuthState, type RestoreProblem } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthState['status']>(() => (getToken() ? 'loading' : 'anonymous'))
  const [devVerificationUrl, setDevVerificationUrl] = useState<string | null>(null)
  const [endReason, setEndReason] = useState<AuthState['endReason']>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const logout = useCallback(() => {
    if (getToken()) authApi.logout().catch(() => {})
    clearToken()
    qc.clear()
    setUserState(null)
    setStatus('anonymous')
    navigate('/login', { replace: true })
  }, [navigate, qc])

  // Any authenticated request returning 401 -> drop the session and go to /login (with the reason, if known).
  useEffect(() => {
    onUnauthorized((code) => {
      qc.clear()
      setUserState(null)
      setStatus('anonymous')
      const here = window.location.pathname + window.location.search
      const reason = code === 'session_replaced' ? 'replaced' : code === 'token_revoked' ? 'revoked' : null
      setEndReason(reason)
      if (!window.location.pathname.startsWith('/login')) {
        navigate(`/login?${reason ? `reason=${reason}&` : ''}next=${encodeURIComponent(here)}`, { replace: true })
      }
    })
  }, [navigate, qc])

  // Restore session on load. Only an authoritative rejection (401, 403 account_disabled) ends the
  // session; rate limits (429), server errors and network failures keep the token and retry with backoff.
  const [restoreProblem, setRestoreProblem] = useState<RestoreProblem | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    authApi
      .me()
      .then((u) => {
        if (cancelled) return
        setRestoreProblem(null)
        setUserState(u)
        setStatus('authenticated')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const ended = err instanceof ApiError && (err.status === 401 || (err.status === 403 && err.code === 'account_disabled'))
        if (ended) {
          clearToken()
          setRestoreProblem(null)
          setStatus('anonymous')
          return
        }
        const retryAfter = err instanceof ApiError && err.retryAfter ? err.retryAfter : null
        const delay = Math.min(60, retryAfter ?? Math.min(30, 2 ** attempt))
        const message =
          err instanceof ApiError && err.isRateLimited
            ? 'Too many requests right now.'
            : err instanceof ApiError && err.status === 0
              ? 'Can’t reach the server.'
              : 'The server had a problem restoring your session.'
        setRestoreProblem({ message, retryIn: delay, attempt: attempt + 1 })
        timer = setTimeout(() => setAttempt((a) => a + 1), delay * 1000)
      })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [attempt])

  const retryRestore = useCallback(() => setAttempt((a) => a + 1), [])

  const accept = useCallback((res: TokenResponse) => {
    setToken(res.access_token)
    setEndReason(null)
    if (res.dev_verification_url) setDevVerificationUrl(res.dev_verification_url)
    setUserState(res.user)
    setStatus('authenticated')
    return res.user
  }, [])

  const completeLogin = useCallback(
    (res: LoginOut): LoginConfirm | null => {
      if (res.status === 'confirm') return res
      accept(res)
      return null
    },
    [accept],
  )

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      restoreProblem,
      retryRestore,
      login: async (body) => completeLogin(await authApi.login(body)),
      completeLogin,
      register: async (body) => accept(await authApi.register(body)),
      logout,
      setUser: setUserState,
      refreshUser: async () => {
        setUserState(await authApi.me())
      },
      devVerificationUrl,
      setDevVerificationUrl,
      endReason,
    }),
    [user, status, restoreProblem, retryRestore, accept, completeLogin, logout, devVerificationUrl, endReason],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
