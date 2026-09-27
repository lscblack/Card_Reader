import { useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/context'
import { authApi } from '@/api/auth'
import { preferencesApi } from '@/api/platform'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Switch } from '@/components/ui/Input'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { FormError } from '@/business/components/BizError'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import type { Visibility } from '../api/types'
import { VisibilityToggle } from '../components/editorBits'
import { PasswordCard } from '@/components/PasswordCard'
import { PasskeysCard, SignedInCard } from '@/components/AccountSecurity'
import { CountrySelect } from '@/components/CountrySelect'
import { FreeOfferBanner } from '@/components/FreeOfferBanner'

interface PrivacyDefaults {
  phones: Visibility
  emails: Visibility
  address: Visibility
  auto_exchange: boolean
}
const DEFAULTS: PrivacyDefaults = { phones: 'contacts', emails: 'contacts', address: 'hidden', auto_exchange: true }

/** Stored as `preferences.personal_defaults = { visibility: {...}, share_settings: {...} }` (the shape the backend reads). */
interface StoredDefaults {
  visibility?: Partial<Record<'phones' | 'emails' | 'address', Visibility>>
  share_settings?: { auto_exchange?: boolean }
}
function readDefaults(raw: unknown): PrivacyDefaults {
  const d = (raw ?? {}) as StoredDefaults
  return {
    phones: d.visibility?.phones ?? DEFAULTS.phones,
    emails: d.visibility?.emails ?? DEFAULTS.emails,
    address: d.visibility?.address ?? DEFAULTS.address,
    auto_exchange: typeof d.share_settings?.auto_exchange === 'boolean' ? d.share_settings.auto_exchange : DEFAULTS.auto_exchange,
  }
}

function ProfileForm() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user?.full_name ?? '')
  const [phone, setPhone] = useState((user as { phone?: string | null } | null)?.phone ?? '')
  const [country, setCountry] = useState(user?.country ?? '')
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      setUser(await authApi.updateMe({ full_name: name.trim(), phone: phone.trim() || null, country: country || undefined }))
      toast.success('Profile saved')
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader title="Profile" description="Your account details. Each card has its own name and details — edit those in My Cards." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormError error={error} className="sm:col-span-2" />
          <Field label="Full name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
          <Field label="Phone" optional>
            {(p) => <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+14155550123" />}
          </Field>
          <Field label="Country">{(p) => <CountrySelect {...p} value={country} onChange={setCountry} />}</Field>
          <Field label="Email" hint="Contact support to change the email address of your account.">
            {(p) => <Input {...p} value={user?.email ?? ''} disabled />}
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>
            Save profile
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function Privacy() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const onError = useErrorToast()
  const stored = readDefaults(user?.preferences?.personal_defaults)
  const [p, setP] = useState<PrivacyDefaults>(stored)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(p) !== JSON.stringify(stored)
  return (
    <Card>
      <CardHeader title="Privacy defaults" description="Used for new cards. You can change each card’s visibility in the editor." />
      <CardBody className="space-y-2">
        {(
          [
            ['phones', 'Phone numbers'],
            ['emails', 'Email addresses'],
            ['address', 'Address'],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-[13px] font-medium">{label}</span>
            <VisibilityToggle value={p[k]} onChange={(v) => setP({ ...p, [k]: v })} label={label} />
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">Automatic exchange</span>
            <span className="block text-xs text-subtle">When someone scans you, you get their card too.</span>
          </span>
          <Switch checked={p.auto_exchange} onChange={(v) => setP({ ...p, auto_exchange: v })} label="Automatic exchange" />
        </div>
      </CardBody>
      <CardFooter>
        <Button
          variant="primary"
          loading={saving}
          disabled={!dirty}
          onClick={async () => {
            setSaving(true)
            try {
              const personal_defaults: StoredDefaults = {
                visibility: { phones: p.phones, emails: p.emails, address: p.address },
                share_settings: { auto_exchange: p.auto_exchange },
              }
              setUser(await preferencesApi.patch({ personal_defaults }))
              toast.success('Privacy defaults saved')
            } catch (e) {
              onError(e)
            } finally {
              setSaving(false)
            }
          }}
        >
          Save defaults
        </Button>
      </CardFooter>
    </Card>
  )
}

export default function SettingsPage() {
  useDocumentTitle('Settings')
  return (
    <>
      <PageHeader title="Settings" description="Your profile, password, where you’re signed in and privacy defaults." />
      <FreeOfferBanner className="mb-6" />
      <div className="space-y-6">
        <ProfileForm />
        <PasswordCard />
        <SignedInCard />
        <PasskeysCard />
        <Privacy />
      </div>
    </>
  )
}
