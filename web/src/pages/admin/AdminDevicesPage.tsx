import { useState } from 'react'
import { Search, Smartphone } from 'lucide-react'
import { itemsOf } from '@/api/admin'
import { useAdminDevices } from '@/hooks/useConsole'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { num } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { SkeletonRows } from '@/components/ui/Spinner'
import { StatCard } from '@/components/StatCard'
import { LiveToggle } from '@/components/AdminBits'
import { AdminDeviceTable } from '@/components/AdminDevices'

export default function AdminDevicesPage() {
  useDocumentTitle('Admin · Devices')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 350)
  const [status, setStatus] = useState('')
  const [online, setOnline] = useState('')
  const [page, setPage] = useState(1)
  const [live, setLive] = useState(true)
  const { data, isLoading, error, refetch } = useAdminDevices({ q: dq || undefined, status: status || undefined, online: online || undefined, page }, live)
  const list = itemsOf(data)
  const onlineCount = list.items.filter((d) => d.online).length

  return (
    <>
      <PageHeader
        title="Device monitor"
        description="Every NFC reader on the platform. Online means a heartbeat or event within the last 2 minutes."
        actions={<LiveToggle live={live} onChange={setLive} />}
      />
      <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard label="Shown" value={num(list.total)} loading={isLoading} />
        <StatCard label="Online (this page)" value={num(onlineCount)} loading={isLoading} />
        <StatCard label="Offline (this page)" value={num(list.items.filter((d) => !d.online && d.status === 'active').length)} loading={isLoading} />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:px-5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search devices" placeholder="Search device, owner or business" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className="pl-8" />
          </div>
          <Select aria-label="Connectivity" value={online} onChange={(e) => { setOnline(e.target.value); setPage(1) }} className="sm:w-36">
            <option value="">Online + offline</option>
            <option value="true">Online</option>
            <option value="false">Offline</option>
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="sm:w-36">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : !list.items.length ? (
          <EmptyState icon={Smartphone} title="No devices match" />
        ) : (
          <>
            <AdminDeviceTable devices={list.items} />
            {list.total > list.page_size && <Pagination page={list.page} pageSize={list.page_size} total={list.total} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  )
}
