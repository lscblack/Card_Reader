import { useMemo, type ReactNode } from 'react'
import { BadgeCheck, Check, Moon, Share2, Sun } from 'lucide-react'
import type { Profile, PublicBusinessInfo, Section } from '@/business/api/types'
import { cn } from '@/lib/cn'
import { PoweredBy } from '@/components/PoweredBy'
import { sectionData } from '../sectionUtils'
import { imgSrc } from './format'
import { PageCtx, type PageCtxValue } from './ctx'
import { useCopy } from './hooks'
import { layoutOf, pageVars, palette, usePageFonts, usePageScheme } from './theme'
import { AboutSection, ContactSection, HoursSection, TextSection } from './sections/Basic'
import { ProductsSection, ServicesSection } from './sections/Commerce'
import { EventSection } from './sections/Event'
import { FormSection } from './sections/Form'
import { GallerySection } from './sections/Gallery'
import { ButtonsSection, LinksSection, SocialSection } from './sections/Links'
import { MenuSection } from './sections/Menu'
import { OfferSection } from './sections/Offer'
import { WifiSection } from './sections/Wifi'
import './page.css'

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '•'
}

function Logo({ src, name }: { src: string | null; name: string }) {
  return <span className="pg-logo">{src ? <img src={src} alt={`${name} logo`} /> : initials(name)}</span>
}

function Controls({ dark, onToggle, onDarkBg, title }: { dark: boolean; onToggle: () => void; onDarkBg: boolean; title: string }) {
  const [copied, copy] = useCopy()
  const cls = cn('pg-ctrl', onDarkBg && 'pg-ctrl-dark')
  async function share() {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title, url })
      else await copy(url)
    } catch {
      /* cancelled */
    }
  }
  return (
    <div className="pg-ctrls">
      <button type="button" className={cls} onClick={onToggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <button type="button" className={cls} onClick={share} aria-label={copied ? 'Link copied' : 'Share this page'}>
        {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        <span>{copied ? 'Copied' : 'Share'}</span>
      </button>
    </div>
  )
}

function renderSection(s: Section, i: number): ReactNode {
  const id = s.id ?? `s${i}`
  const title = (s as { title?: string }).title ?? null
  switch (s.type) {
    case 'about':
      return <AboutSection key={id} d={sectionData(s)} title={title} />
    case 'text':
      return <TextSection key={id} d={sectionData(s)} />
    case 'contact':
      return <ContactSection key={id} d={sectionData(s)} title={title} />
    case 'hours':
      return <HoursSection key={id} d={sectionData(s)} title={title} />
    case 'social':
      return <SocialSection key={id} d={sectionData(s)} />
    case 'services':
      return <ServicesSection key={id} d={sectionData(s)} title={title} />
    case 'products':
      return <ProductsSection key={id} d={sectionData(s)} />
    case 'menu':
      return <MenuSection key={id} d={sectionData(s)} sectionId={id} />
    case 'buttons':
      return <ButtonsSection key={id} d={sectionData(s)} />
    case 'gallery':
      return <GallerySection key={id} d={sectionData(s)} title={title} />
    case 'links':
      return <LinksSection key={id} d={sectionData(s)} />
    case 'offer':
      return <OfferSection key={id} d={sectionData(s)} />
    case 'event':
      return <EventSection key={id} d={sectionData(s)} sectionId={id} />
    case 'wifi':
      return <WifiSection key={id} d={sectionData(s)} />
    case 'form':
      return <FormSection key={id} d={sectionData(s)} sectionId={id} />
    default:
      return null
  }
}

/**
 * Part 6 built-in page: layout + theme (colours, fonts, header, light/dark) + sections. Used by the public route,
 * the editor's live preview and the template gallery thumbnails (`preview`).
 */
export function PageView({
  business,
  profile,
  preview = false,
  scheme,
  profileSlug = null,
}: {
  business: PublicBusinessInfo & { accent?: string | null }
  profile: Pick<Profile, 'type' | 'title' | 'theme' | 'sections'>
  preview?: boolean
  /** Force light/dark (previews). */
  scheme?: 'light' | 'dark'
  profileSlug?: string | null
}) {
  const theme = profile.theme
  const layout = layoutOf(theme?.layout)
  const { dark, toggle } = usePageScheme(theme, `${business.slug}/${profileSlug ?? ''}`, scheme)
  const pal = useMemo(() => palette(theme, dark, business.accent), [theme, dark, business.accent])
  usePageFonts(theme?.font, layout.decor)
  const header = theme?.header ?? layout.header
  const logo = imgSrc(theme?.logo_url) ?? imgSrc(business.logo_url)
  const cover = imgSrc(theme?.cover_image_url)
  const title = profile.title || business.name
  const sub = title.trim().toLowerCase() !== business.name.trim().toLowerCase() ? business.name : business.category
  const ctx: PageCtxValue = {
    layout,
    palette: pal,
    preview,
    businessSlug: business.slug,
    profileSlug,
    businessName: business.name,
    pageUrl: typeof window !== 'undefined' ? window.location.href.split('#')[0] : '',
  }
  const verified = business.verified && <BadgeCheck className="h-4.5 w-4.5" style={{ color: header === 'banner' ? 'currentColor' : 'var(--pg-accent-text)' }} aria-label="Verified business" />
  const subLine = sub && (
    <p className="pg-sub">
      {sub}
      {verified}
    </p>
  )
  // Previews force the scheme from outside (editor toggle / gallery), so the page's own controls are hidden there.
  const controls = (onDarkBg: boolean) => (preview ? null : <Controls dark={dark} onToggle={toggle} onDarkBg={onDarkBg} title={title} />)

  return (
    <PageCtx.Provider value={ctx}>
      <div
        className={cn(
          'pg',
          `pg-l-${layout.id}`,
          `pg-chrome-${layout.chrome}`,
          `pg-titles-${layout.titles}`,
          `pg-tex-${layout.texture}`,
          layout.width === 'wide' && 'pg-wide',
          layout.align === 'center' && 'pg-center',
          layout.upper && 'pg-upper',
          pal.dark && 'pg-dark',
          preview && 'pg-preview',
        )}
        style={pageVars(pal, theme?.font, theme?.corner_radius)}
      >
        <div className="pg-inner">
          <header className={`pg-head pg-h-${header}`}>
            {header === 'cover' && (
              <>
                <div className="pg-cover">{cover ? <img src={cover} alt="" /> : <div className="pg-cover-fill" />}</div>
                {controls(true)}
                <div className="pg-cover-meta">
                  <Logo src={logo} name={business.name} />
                  <h1 className="pg-title">{title}</h1>
                  {subLine}
                </div>
              </>
            )}
            {header === 'logo' && (
              <>
                {controls(false)}
                <Logo src={logo} name={business.name} />
                <h1 className="pg-title">{title}</h1>
                {subLine}
              </>
            )}
            {header === 'minimal' && (
              <>
                <div className="pg-bar">
                  <Logo src={logo} name={business.name} />
                  <span className="pg-bar-name">{business.name}</span>
                  {verified}
                </div>
                {controls(false)}
                <div className="pg-meta">
                  <h1 className="pg-title">{title}</h1>
                  {sub && sub !== business.name && subLine}
                </div>
              </>
            )}
            {header === 'banner' && (
              <div className="pg-banner">
                {controls(true)}
                <Logo src={logo} name={business.name} />
                <h1 className="pg-title">{title}</h1>
                {subLine}
              </div>
            )}
          </header>
          <main className="pg-body">
            {profile.sections.map(renderSection)}
            {profile.sections.length === 0 && <p className="pg-subtle" style={{ padding: '32px 0', textAlign: 'center' }}>Nothing here yet.</p>}
          </main>
          <footer className="pg-foot">
            <PoweredBy />
          </footer>
        </div>
      </div>
    </PageCtx.Provider>
  )
}
