import { useState } from 'react'
import { Ban, Smartphone } from 'lucide-react'
import type { AdminDevice, Device } from '@/api/types'
import { useAdminMutations } from '@/hooks/useConsole'
import { useNow } from '@/hooks/useNow'
import { dateTime, num, relativeTime } from '@/lib/format'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ConfirmDialog } from './ui/Modal'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from './ui/Table'
import { useToast } from './ui/toastContext'

function isOnline(d: Device | AdminDevice, now: number): boolean {
  if ('online' in d && typeof d.online === 'boolean') return d.online
  return d.status === 'active' && !!d.last_seen_at && now - new Date(d.last_seen_at).getTime() < 2 * 60_000
}

/** Admin device table: online/offline, owner, revoke (admin endpoint). */
export function AdminDeviceTable({ devices }: { devices: (AdminDevice | Device)[] }) {
  const now = useNow(10_000)
  const { revokeDevice } = useAdminMutations()
  const toast = useToast()
  const [target, setTarget] = useState<AdminDevice | Device | null>(null)
  return (
    <>
      <TableWrap>
        <Table className="min-w-[860px]">
          <THead>
            <tr>
              <TH>Device</TH>
              <TH>State</TH>
              <TH>Owner</TH>
              <TH>Application</TH>
              <TH>Last seen</TH>
              <TH className="text-right">Events</TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {devices.map((d) => {
              const online = isOnline(d, now)
              const ad = d as AdminDevice
              return (
                <TR key={d.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-subtle">
                        <Smartphone className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.name}</p>
                        <p className="truncate text-xs text-subtle">
                          {d.model ?? d.platform}
                          {d.app_version ? ` · app ${d.app_version}` : ''}
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {d.status === 'revoked' ? (
                      <Badge tone="danger" dot>
                        Revoked
                      </Badge>
                    ) : online ? (
                      <Badge tone="success" dot>
                        Online
                      </Badge>
                    ) : (
                      <Badge dot>Offline</Badge>
                    )}
                  </TD>
                  <TD className="text-muted">
                    {ad.business ? <p className="truncate font-medium text-fg">{ad.business.name}</p> : null}
                    <p className="truncate text-xs">{ad.owner?.email ?? '—'}</p>
                  </TD>
                  <TD className="max-w-[180px] truncate text-muted">{d.application_name}</TD>
                  <TD className="whitespace-nowrap text-muted" title={dateTime(d.last_seen_at)}>
                    {relativeTime(d.last_seen_at, now)}
                  </TD>
                  <TD className="text-right tabular-nums">{num(d.events_count)}</TD>
                  <TD className="text-right">
                    {d.status === 'active' && (
                      <Button size="sm" variant="danger-soft" leftIcon={<Ban className="h-3.5 w-3.5" />} onClick={() => setTarget(d)}>
                        Revoke
                      </Button>
                    )}
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </TableWrap>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Revoke device?"
        description={target ? `“${target.name}” (${target.application_name}) stops working immediately. The owner will have to pair it again.` : undefined}
        confirmLabel="Revoke device"
        loading={revokeDevice.isPending}
        onConfirm={async () => {
          if (!target) return
          try {
            await revokeDevice.mutateAsync(target.id)
            toast.success('Device revoked')
            setTarget(null)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
    </>
  )
}
