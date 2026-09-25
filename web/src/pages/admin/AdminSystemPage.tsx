import { useState, type ReactNode } from 'react'
import { CheckCircle2, Cpu, Database, HardDrive, Inbox, Layers, Server, XCircle } from 'lucide-react'
import { useAdminSystem } from '@/hooks/useConsole'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { dateTime, num, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { LiveToggle } from '@/components/AdminBits'

function Tile({ icon: Icon, title, ok, value, detail }: { icon: typeof Database; title: string; ok: boolean | null; value: ReactNode; detail?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <Icon className="h-4 w-4 text-subtle" /> {title}
        </span>
        {ok != null &&
          (ok ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Healthy
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" /> Problem
            </span>
          ))}
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tracking-tight', ok === false && 'text-red-600 dark:text-red-400')}>{value}</p>
      {detail && <p className="mt-1 text-xs text-subtle">{detail}</p>}
    </Card>
  )
}

const isOk = (s: string) => /^(ok|up|healthy)$/i.test(s)

export default function AdminSystemPage() {
  useDocumentTitle('Admin · System health')
  const [live, setLive] = useState(true)
  const { data: s, error, refetch, dataUpdatedAt } = useAdminSystem(live)
  const now = useNow(5000)
  const workerStale = s?.worker.last_heartbeat_at ? now - new Date(s.worker.last_heartbeat_at).getTime() > 120_000 : true

  return (
    <>
      <PageHeader
        title="System health"
        description={s ? `Version ${s.version} · ${s.environment} · checked ${dataUpdatedAt ? relativeTime(new Date(dataUpdatedAt).toISOString(), now) : '—'}` : 'Database, cache, worker and queues.'}
        actions={<LiveToggle live={live} onChange={setLive} />}
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : !s ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Tile icon={Database} title="Database" ok={isOk(s.database)} value={s.database} />
          <Tile icon={HardDrive} title="Redis" ok={isOk(s.redis)} value={s.redis} detail="Rate limiting, request-log buffer, queues" />
          <Tile
            icon={Cpu}
            title="Worker"
            ok={s.worker.alive && !workerStale}
            value={s.worker.alive ? 'Alive' : 'Down'}
            detail={s.worker.last_heartbeat_at ? `Last heartbeat ${relativeTime(s.worker.last_heartbeat_at, now)} (${dateTime(s.worker.last_heartbeat_at, true)})` : 'No heartbeat recorded'}
          />
          <Tile
            icon={Inbox}
            title="Delivery queue"
            ok={s.delivery_queue_depth < 500}
            value={num(s.delivery_queue_depth)}
            detail="Relay deliveries waiting (incl. scheduled retries)"
          />
          <Tile
            icon={Layers}
            title="Request-log buffer"
            ok={s.request_log_buffer_depth < 5000}
            value={num(s.request_log_buffer_depth)}
            detail="Entries waiting to be flushed by the worker"
          />
          <Tile icon={Server} title="API" ok={null} value={s.version} detail={`Environment: ${s.environment}`} />
        </div>
      )}
    </>
  )
}
