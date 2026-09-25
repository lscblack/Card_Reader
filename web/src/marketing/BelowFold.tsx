import type { Audience } from './plans'
import { ProductPreview } from './components/ProductPreview'
import { DigitalCardSection } from './components/DigitalCardSection'
import { Features, Stats } from './components/Features'
import { Integration } from './components/Integration'
import { Security } from './components/Security'
import { Stories } from './components/Stories'
import { Pricing } from './components/Pricing'
import { Faq } from './components/Faq'
import { FinalCta } from './components/Footer'

/** Everything below the audience section — a separate lazy chunk so the hero paints fast. */
export default function BelowFold({ planAudience, onPlanAudience }: { planAudience: Audience; onPlanAudience: (a: Audience) => void }) {
  return (
    <>
      <DigitalCardSection />
      <ProductPreview />
      <Features />
      <Stats />
      <Integration />
      <Security />
      <Stories />
      <Pricing audience={planAudience} onAudience={onPlanAudience} />
      <Faq />
      <FinalCta />
    </>
  )
}
