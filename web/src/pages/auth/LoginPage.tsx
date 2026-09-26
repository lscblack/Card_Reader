import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/context'
import { ApiError, errorMessage, USE_MOCKS } from '@/api/client'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Field, Input, PasswordInput } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export default function LoginPage() {
  useDocumentTitle('Sign in')
  const { login } = useAuth()
  const [params] = useSearchParams()
  const [email, setEmail] = useState(USE_MOCKS ? 'dev@example.com' : '')
  const [password, setPassword] = useState(USE_MOCKS ? 'password1234' : '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const resetDone = params.get('reset') === '1'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login({ email: email.trim(), password })
      // <GuestOnly> redirects to ?next= (sanitised) once authenticated.
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'invalid_credentials'
          ? 'Incorrect email or password.'
          : err instanceof ApiError && err.code === 'account_disabled'
            ? 'This account has been deactivated. Contact support if you think this is a mistake.'
            : errorMessage(err),
      )
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your NFC applications"
      footer={
        <>
          No account?{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create one — it&apos;s free
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {resetDone && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email">
          {(p) => (
            <Input {...p} inputSize="lg" type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          )}
        </Field>
        <div className="space-y-1.5">
          <Field label="Password">
            {(p) => (
              <PasswordInput {...p} inputSize="lg" placeholder="Enter your password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          <div className="text-right">
            <Link to="/forgot-password" className="text-[12.5px] text-muted hover:text-accent">
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={!email || !password}>
          Sign in
        </Button>
        {USE_MOCKS && (
          <p className="text-center text-xs text-subtle">
            Mock mode: any 10+ char password. Emails containing “admin” open the admin console, “business” a business account, “personal” a personal account.
          </p>
        )}
      </form>
    </AuthLayout>
  )
}
