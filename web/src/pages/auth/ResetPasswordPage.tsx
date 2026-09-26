import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { authApi } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Field, PasswordInput } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PasswordStrength } from './PasswordStrength'

export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password')
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const mismatch = confirm.length > 0 && confirm !== password

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 10 || mismatch) return
    setError(null)
    setLoading(true)
    try {
      await authApi.resetPassword({ token, new_password: password })
      navigate('/login?reset=1', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {!token ? (
        <div className="space-y-4">
          <Alert tone="danger" title="Invalid reset link">
            This link is missing its token. Request a new one.
          </Alert>
          <Button variant="primary" className="w-full" onClick={() => navigate('/forgot-password')}>
            Request a new link
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="New password" hint="At least 10 characters." error={password && password.length < 10 ? 'Use at least 10 characters.' : null}>
            {(p) => (
              <PasswordInput {...p} inputSize="lg" placeholder="At least 10 characters" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            )}
          </Field>
          <PasswordStrength password={password} />
          <Field label="Confirm password" error={mismatch ? 'Passwords do not match.' : null}>
            {(p) => <PasswordInput {...p} inputSize="lg" placeholder="Repeat the new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={password.length < 10 || confirm !== password}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
