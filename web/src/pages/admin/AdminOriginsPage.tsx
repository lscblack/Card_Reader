import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { AllowedOriginsCard } from '@/components/AllowedOrigins'

export default function AdminOriginsPage() {
  useDocumentTitle('Admin · Allowed origins')
  return (
    <>
      <PageHeader title="Allowed origins" description="Browser origins allowed to call the API (CORS)." />
      <AllowedOriginsCard />
    </>
  )
}
