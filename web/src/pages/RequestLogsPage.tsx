import { useState } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRequestLogs } from '@/hooks/useConsole'
import { PageHeader } from '@/components/ui/PageHeader'
import { RequestLogExplorer } from '@/components/RequestLogs'
import { useLogFilterParams } from '@/hooks/useLogFilterParams'

export default function RequestLogsPage() {
  useDocumentTitle('Request Logs')
  const f = useLogFilterParams(25)
  const [live, setLive] = useState(false)
  const query = useRequestLogs(f.filters, live ? 5000 : false)
  return (
    <>
      <PageHeader
        title="Request Logs"
        description="Every request made with your account, API keys and devices — successful and failed. Search by the request ID shown in error messages."
      />
      <RequestLogExplorer query={query} f={f} live={live} onLiveChange={setLive} />
    </>
  )
}
