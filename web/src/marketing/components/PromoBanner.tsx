import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, X } from 'lucide-react'
import { fetchActivePromotions, promoLabel } from '../plans'
import { useCountdown } from '../useCountdown'

const KEY = 'nfc.promo.dismissed'

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as string[]
  } catch {
    return []
  }
}

/** Dismissible top banner for the first active landing promotion (`GET /billing/promotions/active`). */
export function PromoBanner({ onSeePricing }: { onSeePricing: () => void }) {
  const q = useQuery({ queryKey: ['public', 'promotions-active'], queryFn: fetchActivePromotions, staleTime: 5 * 60_000, retry: false })
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)
  const promo = (q.data ?? []).find((p) => !dismissed.includes(p.id))
  const left = useCountdown(promo?.ends_at, 7 * 86_400_000)
  if (!promo) return null

  const dismiss = () => {
    const next = [...dismissed, promo.id]
    setDismissed(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  return (
    <div role="region" aria-label="Current offer" className="relative z-50 bg-accent-solid text-accent-fg">
      <div className="mx-auto flex w-11/12 items-center justify-center gap-x-3 gap-y-1 py-2 pr-8 text-center text-[13px] font-medium max-sm:flex-wrap">
        <Sparkles className="h-4 w-4 shrink-0 max-sm:hidden" aria-hidden="true" />
        <span>{promo.banner_text || `${promo.name}: ${promoLabel(promo, promo.currency ?? 'usd')}`}</span>
        {left && <span className="rounded-md bg-black/20 px-1.5 py-0.5 font-mono text-[12px] tabular-nums">ends in {left}</span>}
        <button type="button" onClick={onSeePricing} className="font-semibold underline underline-offset-2 hover:no-underline">
          See pricing
        </button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss offer"
        className="absolute top-1/2 right-2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md hover:bg-black/20 sm:right-4"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
