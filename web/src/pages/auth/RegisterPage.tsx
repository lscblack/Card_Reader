import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Building2, Check, Code2, Mail } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { authApi } from '@/api/auth'
import { ApiError, request } from '@/api/client'
import type { AccountType } from '@/api/types'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { Alert } from '@/components/ui/Alert'
import { Skeleton } from '@/components/ui/Spinner'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { countries, guessCountry } from '@/lib/countries'
import { cn } from '@/lib/cn'
import { PasswordStrength } from './PasswordStrength'

interface InvitationPreview {
  business_name: string
  role: string
  email: string
  expires_at: string
  status: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[0-9 ()-]{6,20}$/

function TypeCard({
  icon: Icon,
  title,
  body,
  points,
  onClick,
}: {
  icon: typeof Code2
  title: string
  body: string
  points: string[]
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent/60 hover:bg-accent-soft/40"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-[12.5px] text-muted">{body}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-[12.5px] text-muted">
        {points.map((p) => (
          <li key={p} className="flex gap-1.5">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> {p}
          </li>
        ))}
      </ul>
    </button>
  )
}

function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Progress">
      {labels.map((l, i) => (
        <li key={l} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={cn('h-1 rounded-full', i <= current ? 'bg-accent' : 'bg-surface-3')} />
          <span className={cn('truncate text-[11.5px]', i === current ? 'font-medium text-fg' : 'text-subtle')} aria-current={i === current ? 'step' : undefined}>
            {i + 1}. {l}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Footer() {
  return (
    <>
      Already have an account?{' '}
      <Link to="/login" className="font-medium text-accent hover:underline">
        Sign in
      </Link>
    </>
  )
}

export default function RegisterPage() {
  useDocumentTitle('Create account')
  const { register } = useAuth()
  const [params] = useSearchParams()
  const inviteToken = params.get('invite') ?? ''
  const initialType = params.get('type') === 'business' ? 'business' : params.get('type') === 'developer' ? 'developer' : null
  const [type, setType] = useState<AccountType | null>(inviteToken ? 'business' : initialType)
  const [step, setStep] = useState(0)

  // Shared account fields
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Business fields
  const [bizName, setBizName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [bizEmail, setBizEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState(guessCountry)
  const [website, setWebsite] = useState('')
  const [address, setAddress] = useState('')

  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  const countryList = useMemo(() => countries(), [])
  const categories = useQuery({
    queryKey: ['business-categories'],
    queryFn: authApi.businessCategories,
    enabled: type === 'business' && !inviteToken,
    staleTime: 60 * 60_000,
  })
  const invitation = useQuery({
    queryKey: ['invitation', inviteToken],
    queryFn: () => request<InvitationPreview>('GET', `/invitations/${encodeURIComponent(inviteToken)}`, { auth: false }),
    enabled: !!inviteToken,
    retry: false,
  })

  const serverFieldErrors = error instanceof ApiError ? error.fieldErrors : {}
  const fe = (k: string) => serverFieldErrors[k] ?? serverFieldErrors[`business.${k}`]

  // ---- validation per business step ----
  const websiteErr = website.trim() && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(website.trim()) ? 'Enter a full URL, e.g. https://acme.com' : null
  const stepErrors: Record<string, string | null>[] = [
    {
      bizName: bizName.trim().length < 2 ? 'Enter your business name.' : null,
      category: !category ? 'Choose a category.' : null,
      description: description.trim().length < 10 ? 'Describe your business in a sentence or two (10+ characters).' : null,
    },
    {
      bizEmail: !EMAIL.test(bizEmail.trim()) ? 'Enter a valid business email.' : null,
      phone: !PHONE.test(phone.trim()) ? 'Enter a phone number, ideally with country code (+250…).' : null,
      country: !country ? 'Choose a country.' : null,
      website: websiteErr,
    },
  ]
  const invitedEmail = inviteToken ? invitation.data?.email ?? '' : ''
  const loginEmail = invitedEmail || email
  const accountErrors = {
    fullName: fullName.trim().length < 2 ? 'Enter your name.' : null,
    email: !EMAIL.test(loginEmail.trim()) ? 'Enter a valid email.' : null,
    password: password.length < 10 ? 'Use at least 10 characters.' : null,
  }
  const show = (msg: string | null | undefined) => (touched ? msg : null)

  function next(e?: FormEvent) {
    e?.preventDefault()
    setTouched(true)
    if (Object.values(stepErrors[step]).some(Boolean)) return
    setTouched(false)
    if (step === 1 && !email) setEmail(bizEmail.trim())
    setStep((s) => s + 1)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (Object.values(accountErrors).some(Boolean)) return
    setError(null)
    setLoading(true)
    try {
      if (type === 'business' && inviteToken) {
        await register({ email: loginEmail.trim(), password, full_name: fullName.trim(), account_type: 'business', invite_token: inviteToken })
      } else if (type === 'business') {
        await register({
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          account_type: 'business',
          business: {
            name: bizName.trim(),
            email: bizEmail.trim(),
            phone: phone.trim(),
            country,
            category,
            description: description.trim(),
            website: website.trim() || undefined,
            address: address.trim() || undefined,
          },
        })
      } else {
        await register({ email: email.trim(), password, full_name: fullName.trim(), account_type: 'developer' })
      }
      // <GuestOnly> redirects to the right home once authenticated.
    } catch (err) {
      setError(err)
      setLoading(false)
      // Jump back to the step that holds a server-side field error.
      if (err instanceof ApiError && type === 'business' && !inviteToken) {
        const keys = Object.keys(err.fieldErrors).map((k) => k.replace(/^business\./, ''))
        if (keys.some((k) => ['name', 'category', 'description'].includes(k))) setStep(0)
        else if (keys.some((k) => ['phone', 'country', 'website', 'address'].includes(k))) setStep(1)
      }
    }
  }

  const accountFields = (lockedEmail = false): ReactNode => (
    <>
      <Field label="Your full name" error={show(accountErrors.fullName) ?? fe('full_name')}>
        {(p) => <Input {...p} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />}
      </Field>
      <Field
        label={type === 'business' ? 'Login email' : 'Work email'}
        hint={lockedEmail ? 'The invitation was sent to this address.' : undefined}
        error={show(accountErrors.email) ?? fe('email')}
      >
        {(p) => (
          <Input {...p} type="email" autoComplete="email" value={loginEmail} onChange={(e) => setEmail(e.target.value)} readOnly={lockedEmail} disabled={lockedEmail} />
        )}
      </Field>
      <Field label="Password" hint="At least 10 characters. A passphrase works well." error={show(accountErrors.password) ?? fe('password')}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <PasswordStrength password={password} />
    </>
  )

  // ---------- Account type chooser ----------
  if (!type) {
    return (
      <AuthLayout title="Create your account" subtitle="What will you use the platform for?" footer={<Footer />}>
        <div className="space-y-3">
          <TypeCard
            icon={Code2}
            title="Developer"
            body="Build your own NFC integration"
            points={['Applications, API keys & signed webhooks', 'Turn Android phones into card readers', 'Free: 10,000 events / month']}
            onClick={() => setType('developer')}
          />
          <TypeCard
            icon={Building2}
            title="Business"
            body="Smart NFC cards & tags, no code"
            points={['Employee cards, tags and public profiles', 'Choose what each tap does', 'Team roles, analytics & readers']}
            onClick={() => setType('business')}
          />
        </div>
      </AuthLayout>
    )
  }

  const back = (
    <button
      type="button"
      onClick={() => {
        setError(null)
        setTouched(false)
        if (type === 'business' && step > 0 && !inviteToken) setStep(step - 1)
        else {
          setType(null)
          setStep(0)
        }
      }}
      className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back
    </button>
  )

  // ---------- Invitation ----------
  if (inviteToken) {
    return (
      <AuthLayout title="Join your team" subtitle="Create an account to accept the invitation" footer={<Footer />}>
        {invitation.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : invitation.error || (invitation.data && invitation.data.status !== 'pending') ? (
          <div className="space-y-3">
            {invitation.error ? (
              <ErrorAlert error={invitation.error} title="This invitation can’t be used" />
            ) : (
              <Alert tone="warning" title="This invitation is no longer valid">
                Its status is “{invitation.data?.status}”. Ask your team admin to send a new one.
              </Alert>
            )}
            <Link to="/register" className="block text-center text-[13px] font-medium text-accent hover:underline">
              Create a regular account instead
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
              <Mail className="h-5 w-5 shrink-0 text-accent" />
              <p className="text-[13px] text-muted">
                You&apos;re invited to <span className="font-semibold text-fg">{invitation.data?.business_name}</span> as{' '}
                <span className="font-medium text-fg capitalize">{invitation.data?.role}</span>.
              </p>
            </div>
            {error != null && <ErrorAlert error={error} />}
            {accountFields(!!invitation.data?.email)}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
              Create account & join
            </Button>
          </form>
        )}
      </AuthLayout>
    )
  }

  // ---------- Developer ----------
  if (type === 'developer') {
    return (
      <AuthLayout title="Create a developer account" subtitle="Free plan · 10,000 events/month · no card required" footer={<Footer />}>
        {back}
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error != null && <ErrorAlert error={error} />}
          {accountFields()}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Create account
          </Button>
        </form>
      </AuthLayout>
    )
  }

  // ---------- Business (3 steps) ----------
  const labels = ['Business', 'Contact & location', 'Your account']
  return (
    <AuthLayout title="Create a business account" subtitle="Starter plan is free · 50 cards · 3 readers" footer={<Footer />}>
      {back}
      <Steps current={step} labels={labels} />
      {error != null && <ErrorAlert error={error} className="mb-4" />}

      {step === 0 && (
        <form onSubmit={next} className="space-y-4" noValidate>
          <Field label="Business name" error={show(stepErrors[0].bizName) ?? fe('name')}>
            {(p) => <Input {...p} value={bizName} onChange={(e) => setBizName(e.target.value)} autoComplete="organization" autoFocus maxLength={120} />}
          </Field>
          <Field label="Category" error={show(stepErrors[0].category) ?? fe('category')}>
            {(p) =>
              categories.isLoading ? (
                <Skeleton className="h-9" />
              ) : categories.error ? (
                <p className="text-[12.5px] text-red-600 dark:text-red-400">
                  Couldn&apos;t load categories.{' '}
                  <button type="button" className="underline" onClick={() => categories.refetch()}>
                    Retry
                  </button>
                </p>
              ) : (
                <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Choose a category…</option>
                  {categories.data?.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )
            }
          </Field>
          <Field label="Short description" hint="Shown on your public business profile." error={show(stepErrors[0].description) ?? fe('description')}>
            {(p) => <Textarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full">
            Continue
          </Button>
        </form>
      )}

      {step === 1 && (
        <form onSubmit={next} className="space-y-4" noValidate>
          <Field label="Business email" error={show(stepErrors[1].bizEmail) ?? fe('email')}>
            {(p) => <Input {...p} type="email" value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} autoFocus />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" error={show(stepErrors[1].phone) ?? fe('phone')}>
              {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="+250 788 000 000" value={phone} onChange={(e) => setPhone(e.target.value)} />}
            </Field>
            <Field label="Country" error={show(stepErrors[1].country) ?? fe('country')}>
              {(p) => (
                <Select {...p} value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">Choose…</option>
                  {countryList.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Website" optional error={show(stepErrors[1].website) ?? fe('website')}>
            {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />}
          </Field>
          <Field label="Address" optional error={fe('address')}>
            {(p) => <Input {...p} autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full">
            Continue
          </Button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {accountFields()}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Create business account
          </Button>
          <p className="text-center text-xs text-subtle">We&apos;ll email you a link to verify your address.</p>
        </form>
      )}
    </AuthLayout>
  )
}
