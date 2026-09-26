import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Check, CheckCircle2, Nfc, Send, Share2, UserPlus } from 'lucide-react'
import { safeHref } from '@/lib/url'
import { ApiError } from '@/api/client'
import { PoweredBy } from '@/components/PoweredBy'
import { publicCardApi, templatesApi } from '@/personal/api/personal'
import { isV2, type CardLayout, type LeadInput, type SideId } from '@/personal/api/types'
import { DigitalCardRender } from '@/personal/components/DigitalCardRender'
import { onColor, withAlpha } from '@/personal/lib/design'
import { PublicSkeleton, Unavailable } from './Unavailable'

function LeadForm({ slug, accent }: { slug: string; accent: string }) {
  const [f, setF] = useState<LeadInput>({ full_name: '', email: '', phone: '', company: '', message: '', website: '' })
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof LeadInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!f.full_name.trim()) return setError('Please add your name.')
    if (!f.email?.trim() && !f.phone?.trim()) return setError('Leave an email or a phone number so they can reach you.')
    if (f.email?.trim() && !/^[^\s@]+@[^\s@]+$/.test(f.email.trim())) return setError('Enter a valid email address.')
    setState('sending')
    try {
      await publicCardApi.lead(slug, { ...f, full_name: f.full_name.trim() })
      setState('sent')
    } catch (err) {
      setState('idle')
      setError(
        err instanceof ApiError && err.isRateLimited
          ? 'Too many attempts — please try again in a minute.'
          : err instanceof ApiError && err.status === 422
            ? err.message
            : 'Couldn’t send your details. Please try again.',
      )
    }
  }
  if (state === 'sent') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-6 text-center" role="status">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <p className="text-[15px] font-semibold">Thanks — your details were shared.</p>
        <p className="text-sm text-muted">They’ll get in touch soon.</p>
      </div>
    )
  }
  const input = 'h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-[15px] placeholder:text-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none'
  return (
    <form onSubmit={submit} className="space-y-2.5 rounded-2xl border border-border bg-surface p-4 shadow-xs" noValidate>
      <p className="text-[15px] font-semibold">Share your details back</p>
      <p className="-mt-1 text-[13px] text-muted">So they can save your contact too.</p>
      <input className={input} aria-label="Your name" placeholder="Your name" value={f.full_name} onChange={set('full_name')} autoComplete="name" maxLength={120} />
      <input className={input} aria-label="Email" type="email" placeholder="Email" value={f.email} onChange={set('email')} autoComplete="email" maxLength={320} />
      <input className={input} aria-label="Phone" type="tel" placeholder="Phone" value={f.phone} onChange={set('phone')} autoComplete="tel" maxLength={40} />
      <input className={input} aria-label="Company" placeholder="Company (optional)" value={f.company} onChange={set('company')} autoComplete="organization" maxLength={120} />
      <textarea className={`${input} h-auto min-h-[76px] py-2.5`} aria-label="Message" placeholder="Message (optional)" value={f.message} onChange={set('message')} maxLength={1000} />
      {/* Honeypot: hidden from people, bots fill it in. The server rejects non-empty values. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} name="website" />
        </label>
      </div>
      {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: accent, color: onColor(accent) }}
      >
        <Send className="h-4 w-4" /> {state === 'sending' ? 'Sending…' : 'Send my details'}
      </button>
    </form>
  )
}

/** `/p/:slug` — a person's public digital card (no login, no dashboard chrome). */
export default function PublicCardPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const via = params.get('via') ?? undefined
  const [copied, setCopied] = useState(false)
  const { data, error, isLoading } = useQuery({
    queryKey: ['public', 'card', slug],
    queryFn: () => publicCardApi.get(slug, via),
    // Every GET counts a view (and an NFC tap with ?via=nfc): load once per visit, never refetch on focus/reconnect.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  })
  const tplId = data && typeof data.card.template === 'object' ? data.card.template.id : typeof data?.card.template === 'string' ? data.card.template : null
  const templates = useQuery({ queryKey: ['personal-templates'], queryFn: templatesApi.list, staleTime: 30 * 60_000, enabled: !!tplId })
  const [side, setSide] = useState<SideId>('front')
  useEffect(() => {
    document.title = data ? `${data.card.fields.full_name}${data.card.fields.company ? ` · ${data.card.fields.company}` : ''}` : 'Digital card'
  }, [data])

  if (isLoading) return <PublicSkeleton />
  if (error || !data) {
    const notFound = error instanceof ApiError && error.status >= 400 && error.status < 500
    return notFound ? <Unavailable title="This card isn’t available" body="The link may have changed, or its owner turned it off." /> : <Unavailable title="Something went wrong" body="We couldn’t load this card. Check your connection and try again." />
  }
  const c = data.card
  const layout: CardLayout = (c.template && typeof c.template === 'object' ? c.template.layout : undefined) ?? 'centered'
  const template = templates.data?.find((t) => t.id === tplId) ?? null
  const portrait = isV2(template) && template.format === 'portrait'
  if (tplId && typeof c.template === 'object' && c.template.engine === 'v2' && templates.isLoading) return <PublicSkeleton />
  const primary = c.design.primary
  const url = c.public_url ?? window.location.href.split('?')[0]

  async function share() {
    try {
      if (navigator.share) return await navigator.share({ title: c.fields.full_name, url })
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* cancelled */
    }
  }

  return (
    <main className="min-h-screen bg-bg" style={{ backgroundImage: `radial-gradient(120% 60% at 50% 0%, ${withAlpha(primary, 0.16)}, transparent 70%)` }}>
      <div className="mx-auto w-full max-w-[440px] space-y-4 px-4 pt-6 pb-10">
        <h1 className="sr-only">{c.fields.full_name}</h1>
        <div className={portrait ? 'mx-auto max-w-[320px]' : undefined}>
          <DigitalCardRender card={c} layout={layout} template={template} side={side} onSideChange={setSide} audience="all" interactive qrValue={isV2(template) ? url : null} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <a
            href={safeHref(data.vcard_url) ?? undefined}
            download={`${c.fields.full_name.replace(/[^\w-]+/g, '-')}.vcf`}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold shadow-sm transition-opacity hover:opacity-90"
            style={{ background: primary, color: onColor(primary) }}
          >
            <UserPlus className="h-5 w-5" /> Save contact
          </a>
          <button type="button" onClick={share} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border-strong bg-surface text-[15px] font-semibold hover:bg-surface-2">
            {copied ? <Check className="h-5 w-5" /> : <Share2 className="h-5 w-5" />} {copied ? 'Link copied' : 'Share'}
          </button>
        </div>
        {data.lead_capture_enabled && <LeadForm slug={slug} accent={primary} />}
        <Link to="/register?type=personal" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xs hover:bg-surface-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Nfc className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14.5px] font-semibold">Get your own digital card</span>
            <span className="block text-[13px] text-muted">Share your details with a tap. Free to start.</span>
          </span>
        </Link>
        <p className="pt-2 text-center">
          <PoweredBy />
        </p>
      </div>
    </main>
  )
}
