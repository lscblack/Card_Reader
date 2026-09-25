import { useEffect } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { publicApi } from './api'
import { ProfileView } from './ProfileView'
import { PublicSkeleton, Unavailable } from './Unavailable'
import { UNAVAILABLE_REASONS } from './reasons'

/** `/b/:slug` and `/b/:slug/:profileSlug` — what customers see after tapping a card. No login. */
export default function PublicProfilePage() {
  const { slug = '', profileSlug } = useParams()
  const { data, error, isLoading } = useQuery({
    queryKey: ['public', 'profile', slug, profileSlug ?? ''],
    queryFn: () => publicApi.profile(slug, profileSlug),
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  })
  const categories = useQuery({ queryKey: ['public', 'categories'], queryFn: publicApi.categories, staleTime: Infinity, enabled: !!data })
  useEffect(() => {
    document.title = data ? `${data.profile.title}${data.profile.type === 'employee' ? ` · ${data.business.name}` : ''}` : 'Loading…'
  }, [data])

  if (isLoading) return <PublicSkeleton />
  if (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      const reason = (error.details as { reason?: string } | null)?.reason ?? ''
      const r = UNAVAILABLE_REASONS[reason]
      return <Unavailable title={r?.title} body={r?.body} />
    }
    return <Unavailable title="Something went wrong" body="We couldn’t load this page. Check your connection and try again." />
  }
  if (!data) return <Unavailable />
  const category = categories.data?.find((c) => c.code === data.business.category)?.label ?? null
  return (
    <main className="min-h-screen bg-bg">
      <ProfileView business={{ ...data.business, category }} profile={data.profile} employee={data.employee ?? null} vcardUrl={data.vcard_url} />
    </main>
  )
}
