import { useState } from 'react'
import { Link } from 'react-router'
import { useAdminRequestLogs } from '@/hooks/useConsole'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { RequestLogExplorer } from '@/components/RequestLogs'
import { useLogFilterParams } from '@/hooks/useLogFilterParams'

export default function AdminRequestLogsPage() {
  useDocumentTitle('Admin · Request logs')
  const f = useLogFilterParams(50)
  const [live, setLive] = useState(false)
  const query = useAdminRequestLogs(f.filters, live)
  return (
    <>
      <PageHeader title="Request logs" description="Every request across the platform. Bodies, secrets and raw IPs are never stored." />
      <RequestLogExplorer
        query={query}
        f={f}
        admin
        live={live}
        onLiveChange={setLive}
        detailExtra={(l) =>
          l.user_id ? (
            <Link to={`/admin/accounts/${l.user_id}`} className="inline-block text-[13px] font-medium text-accent hover:underline">
              Open account →
            </Link>
          ) : null
        }
      />
    </>
  )
}
