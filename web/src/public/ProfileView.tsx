import { useState } from 'react'
import { BadgeCheck, Check, Mail, MapPin, MessageCircle, Phone, Share2, UserPlus } from 'lucide-react'
import type { Profile, PublicBusinessInfo, PublicEmployee } from '@/business/api/types'
import { cn } from '@/lib/cn'
import { cssImage, safeHref, safeImageUrl } from '@/lib/url'
import { SectionView } from './Sections'
import { mapsLink, onColor, safeAccent, sectionData, waLink } from './sectionUtils'
import { PoweredBy } from '@/components/PoweredBy'

function ShareButton({ title, className }: { title: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  async function share() {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* user cancelled */
    }
  }
  return (
    <button
      type="button"
      onClick={share}
      aria-label={copied ? 'Link copied' : 'Share this page'}
      className={cn('inline-flex h-9 items-center gap-1.5 rounded-full bg-black/25 px-3 text-[13px] font-medium text-white backdrop-blur-md hover:bg-black/35', className)}
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      {copied ? 'Copied' : 'Share'}
    </button>
  )
}

function Initials({ name, accent, size }: { name: string; accent: string; size: number }) {
  const parts = name.trim().split(/\s+/)
  const txt = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
  return (
    <span className="flex items-center justify-center rounded-3xl font-semibold" style={{ width: size, height: size, background: accent, color: onColor(accent), fontSize: size * 0.36 }}>
      {txt || '•'}
    </span>
  )
}

/**
 * The customer-facing profile page. Used by the public route and by the dashboard editor's live
 * preview (`preview` disables the share button and uses the container width).
 */
export function ProfileView({
  business,
  profile,
  employee = null,
  vcardUrl,
  preview = false,
}: {
  business: PublicBusinessInfo
  profile: Pick<Profile, 'type' | 'title' | 'theme' | 'sections'>
  /** Live employee data for employee profiles (photo, position, contact). */
  employee?: PublicEmployee | null
  vcardUrl?: string | null
  preview?: boolean
}) {
  const accent = safeAccent(profile.theme?.accent)
  const fg = onColor(accent)
  const contact = profile.sections.find((s) => s.type === 'contact')
  const fromSection = contact ? (sectionData(contact) as { phone?: string; email?: string; address?: string }) : {}
  const c = { phone: fromSection.phone || employee?.phone || undefined, email: fromSection.email || employee?.email || undefined, address: fromSection.address }
  const isPerson = profile.type === 'employee'
  const about = profile.sections.find((s) => s.type === 'about')
  const position = employee ? [employee.position, employee.department].filter(Boolean).join(' · ') : ''
  const tagline = isPerson ? position || (about ? (sectionData(about) as { text: string }).text.split('\n')[0] : business.name) : business.category
  const title = isPerson && employee?.full_name ? employee.full_name : profile.title
  const extraSocial = employee?.social_links?.length && !profile.sections.some((s) => s.type === 'social') ? employee.social_links : null
  const quick = [
    c.phone && { label: 'Call', icon: Phone, href: `tel:${c.phone}` },
    c.phone && { label: 'WhatsApp', icon: MessageCircle, href: waLink(c.phone) },
    c.email && { label: 'Email', icon: Mail, href: `mailto:${c.email}` },
    c.address && { label: 'Directions', icon: MapPin, href: mapsLink(c.address) },
  ].filter(Boolean) as { label: string; icon: typeof Phone; href: string }[]
  const cover = cssImage(profile.theme?.cover_image_url)
  const photo = safeImageUrl(employee?.photo_url)
  const logo = safeImageUrl(business.logo_url)
  const vcard = safeHref(vcardUrl)

  return (
    <div className={cn('mx-auto w-full', preview ? '' : 'max-w-lg')}>
      <header className="relative">
        <div
          className="h-36 w-full sm:h-40"
          style={
            cover
              ? { backgroundImage: cover, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: `radial-gradient(120% 140% at 0% 0%, ${accent} 0%, ${accent}cc 45%, #0c0a0a 140%)` }
          }
        />
        {!preview && <ShareButton title={title} className="absolute top-3 right-3" />}
        <div className="-mt-12 px-5">
          <div className="inline-block rounded-[28px] bg-bg p-1.5">
            {isPerson && photo ? (
              <img src={photo} alt={title} className="h-[84px] w-[84px] rounded-3xl object-cover" />
            ) : !isPerson && logo ? (
              <img src={logo} alt={`${business.name} logo`} className="h-[84px] w-[84px] rounded-3xl object-cover" />
            ) : (
              <Initials name={title} accent={accent} size={84} />
            )}
          </div>
          <h1 className="mt-2 flex items-center gap-1.5 text-[26px] leading-tight font-bold tracking-tight">
            <span className="min-w-0 break-words">{title}</span>
            {business.verified && !isPerson && <BadgeCheck className="h-6 w-6 shrink-0" style={{ color: accent }} aria-label="Verified business" />}
          </h1>
          {tagline && <p className="mt-1 text-[15px] text-muted">{tagline}</p>}
          {isPerson && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-subtle">
              {business.name}
              {business.verified && <BadgeCheck className="h-4 w-4" style={{ color: accent }} aria-label="Verified business" />}
            </p>
          )}
        </div>
      </header>

      <div className="space-y-4 px-4 pt-5 pb-10">
        {quick.length > 0 && (
          <div className={cn('grid gap-2', quick.length >= 4 ? 'grid-cols-4' : quick.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {quick.map((q) => (
              <a
                key={q.label}
                href={q.href}
                target={q.href.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-surface py-3 text-[12.5px] font-medium shadow-xs transition-colors hover:bg-surface-2"
              >
                <q.icon className="h-5 w-5" style={{ color: accent }} />
                {q.label}
              </a>
            ))}
          </div>
        )}
        {vcard && (
          <a
            href={vcard}
            download={`${title.replace(/[^\w-]+/g, '-')}.vcf`}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold shadow-sm transition-opacity hover:opacity-90"
            style={{ background: accent, color: fg }}
          >
            <UserPlus className="h-5 w-5" /> Save contact
          </a>
        )}
        {profile.sections.map((s, i) => (
          <SectionView key={s.id ?? i} section={s} accent={accent} businessSlug={business.slug} />
        ))}
        {extraSocial && <SectionView section={{ type: 'social', links: extraSocial }} accent={accent} businessSlug={business.slug} />}
        {profile.sections.length === 0 && !extraSocial && <p className="py-8 text-center text-sm text-subtle">Nothing here yet.</p>}
        <p className="pt-4 text-center"><PoweredBy brand /></p>
      </div>
    </div>
  )
}
