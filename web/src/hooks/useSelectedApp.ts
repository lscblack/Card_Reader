import { useSearchParams } from 'react-router'
import { useApplications } from './queries'

/** Selected application from `?app=`, defaulting to the first application. */
export function useSelectedApp() {
  const [params, setParams] = useSearchParams()
  const apps = useApplications()
  const requested = params.get('app')
  const app = apps.data?.find((a) => a.id === requested) ?? apps.data?.[0] ?? null
  const select = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('app', id)
    setParams(next, { replace: true })
  }
  return { apps, app, select }
}
