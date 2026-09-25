import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { Unavailable } from './Unavailable'
import { UNAVAILABLE_REASONS } from './reasons'

/** `/tap/unavailable?reason=unknown|inactive|suspended|unverified` — neutral page for taps that can't resolve. */
export default function TapUnavailablePage() {
  const [params] = useSearchParams()
  const r = UNAVAILABLE_REASONS[params.get('reason') ?? '']
  useEffect(() => {
    document.title = 'Not available'
  }, [])
  return <Unavailable title={r?.title} body={r?.body} />
}
