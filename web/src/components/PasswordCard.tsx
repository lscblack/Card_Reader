import { useState, type FormEvent } from 'react'
import { authApi } from '@/api/auth'
import { ApiError, errorMessage } from '@/api/client'
import { useAuth } from '@/auth/context'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useToast } from '@/components/ui/toastContext'

/** "Change password" card (developer/business account settings and the personal settings page). */
export function PasswordCard() {
  const toast = useToast()
  const { logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const mismatch = confirm.length > 0 && confirm !== next
  const tooShort = next.length > 0 && next.length < 10

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setSaving(true)
    try {
      await authApi.changePassword({ current_password: current, new_password: next })
      // The backend invalidates all previously issued JWTs on password change -> sign in again.
      toast.success('Password changed. Please sign in with your new password.')
      logout()
    } catch (e2) {
      setErr(e2 instanceof ApiError && e2.code === 'invalid_credentials' ? 'Your current password is incorrect.' : errorMessage(e2))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardHeader title="Change password" description="You'll be signed out everywhere and asked to sign in again." />
        <CardBody className="space-y-4">
          {err && <Alert tone="danger">{err}</Alert>}
          <Field label="Current password">
            {(p) => <Input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" error={tooShort ? 'At least 10 characters.' : null}>
              {(p) => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
            </Field>
            <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : null}>
              {(p) => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" variant="primary" loading={saving} disabled={!current || next.length < 10 || next !== confirm}>
            Update password
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
