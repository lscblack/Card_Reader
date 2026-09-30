import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  CreditCard,
  LifeBuoy,
  Mail,
  MessageSquare,
  Phone,
  Send,
  User as UserIcon,
} from 'lucide-react'
import { supportApi, SUPPORT_CATEGORIES, SUPPORT_STATUS_LABEL, type SupportCategory, type SupportStatus } from '@/api/support'
import { errorMessage } from '@/api/client'
import { homePathFor } from '@/api/auth'
import { useAuth } from '@/auth/context'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'

const STATUS_TONE: Record<SupportStatus, Tone> = {
  open: 'info',
  in_progress: 'warning',
  resolved: 'success',
}

function HelpCard({ icon, title, body, to }: { icon: React.ReactNode; title: string; body: string; to: string }) {
  return (
    <Link
      to={to}
      className="group flex gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-accent/40 hover:bg-surface-2/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</span>
      <span>
        <span className="block text-[14px] font-semibold group-hover:text-accent">{title}</span>
        <span className="mt-0.5 block text-[13px] text-muted">{body}</span>
      </span>
    </Link>
  )
}

function MyRequests() {
  const q = useQuery({
    queryKey: ['support', 'mine'],
    queryFn: supportApi.mine,
  })
  if (!q.data?.length) return null
  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold tracking-tight">Your requests</h2>
      <ul className="mt-3 divide-y divide-border">
        {q.data.map((t) => (
          <li key={t.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[14px] font-medium">{t.subject}</p>
              <Badge tone={STATUS_TONE[t.status]} dot className="shrink-0">
                {SUPPORT_STATUS_LABEL[t.status]}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-subtle">
              {SUPPORT_CATEGORIES.find((c) => c.value === t.category)?.label} · sent {relativeTime(t.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SupportPageInner() {
  useDocumentTitle('Support')
  const { user, status } = useAuth()
  const qc = useQueryClient()
  const signedIn = status === 'authenticated' && !!user
  const [name, setName] = useState(user?.full_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [category, setCategory] = useState<SupportCategory>('billing')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const back = signedIn ? homePathFor(user) : '/'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const t = await supportApi.create({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        category,
        subject: subject.trim(),
        message: message.trim(),
      })
      setSent(t.email)
      setSubject('')
      setMessage('')
      qc.invalidateQueries({ queryKey: ['support', 'mine'] })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to={back} className="flex items-center gap-2 text-[13px] font-medium text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{signedIn ? 'Back to dashboard' : 'Home'}</span>
          </Link>
          <Logo />
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <LifeBuoy className="h-4 w-4 text-accent" /> <span className="hidden sm:inline">Support</span>
          </span>
        </div>
      </header>

      <div className="relative overflow-hidden border-b border-border bg-gradient-to-b from-accent-soft to-bg">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-accent-solid/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-12 text-center sm:px-6 sm:py-16">
          <p className="text-xs font-semibold tracking-wider text-accent uppercase">Customer support</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">How can we help?</h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] text-muted">
            Tell us what’s going on and our team will get back to you by email or phone — usually within one business day.
          </p>
        </div>
      </div>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-3xl border border-border bg-surface p-5 shadow-sm sm:p-8">
          {sent ? (
            <div className="py-10 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-8 ring-emerald-500/5">
                <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">Message sent</h2>
              <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
                Thanks! Our team has your request and will reply to <span className="font-medium text-fg">{sent}</span>.
              </p>
              <Button className="mt-6" onClick={() => setSent(null)}>
                Send another request
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Send us a message</h2>
                <p className="mt-0.5 text-[13px] text-muted">Fields marked optional can be left blank.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name">
                  {(p) => (
                    <div className="relative">
                      <UserIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
                      <Input
                        {...p}
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="pl-9"
                        autoComplete="name"
                        maxLength={200}
                      />
                    </div>
                  )}
                </Field>
                <Field label="Email">
                  {(p) => (
                    <div className="relative">
                      <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
                      <Input
                        {...p}
                        required
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-9"
                        autoComplete="email"
                      />
                    </div>
                  )}
                </Field>
              </div>
              <Field label="Phone number" optional hint="Add it if you’d like us to call you back.">
                {(p) => (
                  <div className="relative">
                    <Phone className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
                    <Input
                      {...p}
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-9"
                      autoComplete="tel"
                      maxLength={40}
                      placeholder="+250 7xx xxx xxx"
                    />
                  </div>
                )}
              </Field>

              <div>
                <p className="mb-2 text-[13px] font-medium">What is it about?</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Topic">
                  {SUPPORT_CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={category === c.value}
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition-colors ring-inset',
                        category === c.value
                          ? 'bg-accent-solid text-accent-fg ring-accent-solid'
                          : 'bg-surface text-muted ring-border-strong hover:text-fg',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Subject">
                {(p) => (
                  <Input
                    {...p}
                    required
                    minLength={3}
                    maxLength={200}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. I can’t upgrade my plan"
                  />
                )}
              </Field>
              <Field label="Message" hint={`${message.trim().length}/5000 · at least 10 characters`}>
                {(p) => (
                  <Textarea
                    {...p}
                    required
                    minLength={10}
                    maxLength={5000}
                    rows={6}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Describe what happened, what you expected and any error message you saw."
                  />
                )}
              </Field>

              {error && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="h-11 w-full sm:w-auto"
                loading={busy}
                leftIcon={!busy ? <Send className="h-4 w-4" /> : undefined}
              >
                Send message
              </Button>
            </form>
          )}
        </section>

        <aside className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <Clock className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-[13px] text-emerald-800 dark:text-emerald-300">
              <span className="font-semibold">We usually reply within 1 business day.</span> Urgent billing issues are handled first.
            </p>
          </div>
          <HelpCard
            icon={<BookOpen className="h-4.5 w-4.5" />}
            title="Documentation"
            body="Guides for the app, cards, webhooks and the API."
            to="/docs"
          />
          {signedIn && (
            <HelpCard
              icon={<CreditCard className="h-4.5 w-4.5" />}
              title="Plans & billing"
              body="See your plan, upgrade or manage your payment."
              to={user?.account_type === 'personal' ? '/me/settings' : user?.account_type === 'business' ? '/business' : '/dashboard/usage'}
            />
          )}
          <HelpCard
            icon={<MessageSquare className="h-4.5 w-4.5" />}
            title="Errors & codes"
            body="What each error code means and how to fix it."
            to="/docs/errors"
          />
          {signedIn && <MyRequests />}
        </aside>
      </main>
    </div>
  )
}

/** Waits for the session so a signed-in customer's name, email and phone are filled in. */
export default function SupportPage() {
  const { user, status } = useAuth()
  if (status === 'loading') return <div className="min-h-dvh bg-bg" />
  return <SupportPageInner key={user?.id ?? 'guest'} />
}
