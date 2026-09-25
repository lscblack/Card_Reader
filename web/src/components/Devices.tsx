import { useState, type FormEvent } from 'react'
import { Ban, Pencil, Smartphone, Trash2 } from 'lucide-react'
import type { Device } from '@/api/types'
import { useDeleteDevice, useRenameDevice, useRevokeDevice } from '@/hooks/queries'
import { dateTime, num, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useNow } from '@/hooks/useNow'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from './ui/Table'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ConfirmDialog, Modal } from './ui/Modal'
import { Field, Input } from './ui/Input'
import { Menu } from './ui/Menu'
import { useToast } from './ui/toastContext'

const ONLINE_WINDOW_MS = 5 * 60_000

function Presence({ device, now }: { device: Device; now: number }) {
  if (device.status === 'revoked') return <Badge tone="danger" dot>Revoked</Badge>
  const recent = device.last_seen_at && now - new Date(device.last_seen_at).getTime() < ONLINE_WINDOW_MS
  return (
    <Badge tone={recent ? 'success' : 'neutral'} dot title={recent ? 'Seen in the last 5 minutes' : undefined}>
      {recent ? 'Online' : 'Active'}
    </Badge>
  )
}

export function DevicesTable({ devices, showApp = true }: { devices: Device[]; showApp?: boolean }) {
  const toast = useToast()
  const now = useNow()
  const rename = useRenameDevice()
  const revoke = useRevokeDevice()
  const del = useDeleteDevice()
  const [renaming, setRenaming] = useState<Device | null>(null)
  const [newName, setNewName] = useState('')
  const [revoking, setRevoking] = useState<Device | null>(null)
  const [deleting, setDeleting] = useState<Device | null>(null)

  async function onRename(e: FormEvent) {
    e.preventDefault()
    if (!renaming) return
    try {
      await rename.mutateAsync({ id: renaming.id, name: newName.trim() })
      toast.success('Device renamed')
      setRenaming(null)
    } catch (err) {
      toast.fromError(err)
    }
  }

  return (
    <>
      <TableWrap>
        <Table className="min-w-[720px]">
          <THead>
            <tr>
              <TH>Device</TH>
              <TH>Status</TH>
              {showApp && <TH>Application</TH>}
              <TH>Model</TH>
              <TH>Last seen</TH>
              <TH className="text-right">Events</TH>
              <TH className="w-10">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {devices.map((d) => (
              <TR key={d.id} className={cn(d.status === 'revoked' && 'opacity-70')}>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-subtle">
                      <Smartphone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.name}</p>
                      <p className="truncate text-xs text-subtle">
                        {d.platform}
                        {d.app_version ? ` · app ${d.app_version}` : ''}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <Presence device={d} now={now} />
                </TD>
                {showApp && <TD className="text-muted">{d.application_name}</TD>}
                <TD className="text-muted">
                  <p className="whitespace-nowrap">{d.model ?? '—'}</p>
                  {d.os_version && <p className="text-xs whitespace-nowrap text-subtle">{d.os_version}</p>}
                </TD>
                <TD className="whitespace-nowrap text-muted" title={dateTime(d.last_seen_at)}>
                  {relativeTime(d.last_seen_at, now)}
                  {d.last_ip && <p className="font-mono text-[11px] text-subtle">{d.last_ip}</p>}
                </TD>
                <TD className="text-right tabular-nums">{num(d.events_count)}</TD>
                <TD className="text-right">
                  <Menu
                    label={`Actions for ${d.name}`}
                    items={[
                      {
                        label: 'Rename',
                        icon: <Pencil className="h-4 w-4 text-subtle" />,
                        onSelect: () => {
                          setNewName(d.name)
                          setRenaming(d)
                        },
                      },
                      ...(d.status === 'active'
                        ? [{ label: 'Revoke', icon: <Ban className="h-4 w-4" />, danger: true, onSelect: () => setRevoking(d) }]
                        : []),
                      { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setDeleting(d) },
                    ]}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename device"
        size="sm"
        footer={
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" type="submit" form="rename-device" loading={rename.isPending} disabled={!newName.trim()}>
              Save
            </Button>
          </>
        }
      >
        <form id="rename-device" onSubmit={onRename}>
          <Field label="Name">{(p) => <Input {...p} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} data-autofocus />}</Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke device?"
        description={revoking ? `“${revoking.name}” will stop sending events immediately.` : undefined}
        confirmLabel="Revoke device"
        loading={revoke.isPending}
        onConfirm={async () => {
          if (!revoking) return
          try {
            await revoke.mutateAsync(revoking.id)
            toast.success('Device revoked')
            setRevoking(null)
          } catch (err) {
            toast.fromError(err)
          }
        }}
      >
        <p className="text-[13px] text-muted">Its device token is invalidated. The app will return to its setup screen and must be registered again.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete device?"
        description={deleting ? `“${deleting.name}” will be removed from your account. This cannot be undone.` : undefined}
        confirmLabel="Delete device"
        loading={del.isPending}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await del.mutateAsync(deleting.id)
            toast.success('Device deleted')
            setDeleting(null)
          } catch (err) {
            toast.fromError(err)
          }
        }}
      />
    </>
  )
}
