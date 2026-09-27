import { useState, type FormEvent } from 'react'
import { Globe2 } from 'lucide-react'
import { authApi } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { Logo } from '@/components/Logo'
import { CountrySelect } from '@/components/CountrySelect'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { guessCountry } from '@/lib/countries'
import { useAuth } from './context'

/** Accounts created before country was required pick one before using any dashboard. */
export function CountryGate() {
  useDocumentTitle('Choose your country')
  const { user, setUser, logout } = useAuth()
  const [country, setCountry] = useState(guessCountry)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!country) return setError('Choose a country to continue.')
    setError(null)
    setSaving(true)
    try {
      setUser(await authApi.updateMe({ country }))
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="px-4 py-4 sm:px-8">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <form onSubmit={submit} className="animate-pop-in w-full max-w-[420px] space-y-5" noValidate>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Globe2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight">Choose your country</h1>
            <p className="mt-2 text-[14px] text-muted">
              Every account now has a country. It helps us show the right formats and comply with local rules. You can change it later in Settings.
            </p>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Country">{(p) => <CountrySelect {...p} size="lg" value={country} onChange={setCountry} required />}</Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={saving} disabled={!country}>
            Continue
          </Button>
          <p className="text-center text-[13px] text-muted">
            Signed in as <span className="font-medium text-fg">{user?.email}</span> ·{' '}
            <button type="button" onClick={logout} className="font-medium text-accent hover:underline">
              Sign out
            </button>
          </p>
        </form>
      </main>
    </div>
  )
}
