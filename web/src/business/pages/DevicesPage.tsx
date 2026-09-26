import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, Ban, Pencil, QrCode, Smartphone, UserRound } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog, Drawer, Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Input'
import { Menu } from '@/components/ui/Menu'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToast } from '@/components/ui/toastContext'
import { PairPhoneModal } from '@/components/PairPhoneModal'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { dateTime, relativeTime, shortId } from '@/lib/format'
import type { BusinessDevice, CardTap } from '../api/types'
import { bizDevicesApi } from '../api/integrations'
import { useBusiness, useCan } from '../hooks/context'
import { bk, useBizApps, useBizDevices, useBizMutation, useDeviceActivity } from '../hooks/queries'
import { useErrorToast } from '../hooks/useErrorToast'
import { DetailRow } from '../components/bits'
import { BizErrorState } from '../components/BizError'
import { EmployeeSelect } from '../components/Pickers'
import { TapDetailDrawer, TapsTable } from '../components/Taps'
import { DownloadAppCard } from '@/components/DownloadApp'
import { ReaderTapHelp } from '../components/ReaderTapHelp'

function OnlineDot({ online, revoked }: { online: boolean; revoked: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" title={revoked ? 'Revoked' : online ? 'Online' : 'Offline'}>
      {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', revoked ? 'bg-zinc-400' : online ? 'bg-emerald-500' : 'bg-amber-500')} />
      <span className="sr-only">{revoked ? 'Revoked' : online ? 'Online' : 'Offline'}</span>
    </span>
  )
}

function ActivityDrawer({ device, onClose }: { device: BusinessDevice | null; onClose: () => void }) {
  const { business } = useBusiness()
  const { data, error, isLoading, refetch } = useDeviceActivity(business.id, device?.id ?? null)
  const [tap, setTap] = useState<CardTap | null>(null)
  return (
    <>
      <Drawer open={!!device && !tap} onClose={onClose} title={device ? `${device.name} — activity` : 'Activity'}>
        {device && (
          <div className="space-y-5">
            <dl className="divide-y divide-border rounded-lg border border-border px-3">
              <DetailRow label="Status">
                <span className="inline-flex items-center gap-2">
                  <OnlineDot online={device.online} revoked={device.status === 'revoked'} />
                  {device.status === 'revoked' ? 'Revoked' : device.online ? 'Online' : 'Offline'}
                </span>
              </DetailRow>
              <DetailRow label="Model">{[device.model, device.os_version].filter(Boolean).join(' · ') || '—'}</DetailRow>
              <DetailRow label="App version">{device.app_version ?? '—'}</DetailRow>
              <DetailRow label="Last seen">{dateTime(device.last_seen_at)}</DetailRow>
              <DetailRow label="Last NFC scan">{dateTime(device.last_scan_at)}</DetailRow>
              <DetailRow label="Events">{device.events_count}</DetailRow>
            </dl>
            {error ? (
              <BizErrorState error={error} onRetry={() => refetch()} />
            ) : isLoading || !data ? (
              <SkeletonRows rows={5} cols={3} />
            ) : (
              <>
                <section>
                  <h3 className="mb-2 text-[13px] font-semibold">Recent scans</h3>
                  {data.taps.length ? (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <TapsTable taps={data.taps} compact onOpen={setTap} />
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted">No scans yet.</p>
                  )}
                </section>
                <section>
                  <h3 className="mb-2 text-[13px] font-semibold">Recent requests</h3>
                  {data.request_logs.length ? (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {data.request_logs.map((l) => (
                        <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                          <Badge tone={l.outcome === 'success' ? 'success' : l.outcome === 'client_error' ? 'warning' : 'danger'} className="font-mono">
                            {l.status_code}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate font-mono text-muted">
                            {l.method} {l.route}
                          </span>
                          {l.error_ref && <span className="font-mono text-xs text-subtle">{l.error_ref}</span>}
                          <span className="shrink-0 text-xs text-subtle">{relativeTime(l.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted">No requests recorded.</p>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </Drawer>
      <TapDetailDrawer tap={tap} onClose={() => setTap(null)} />
    </>
  )
}

export default function DevicesPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const now = useNow()
  const toast = useToast()
  const onError = useErrorToast()
  useDocumentTitle('Devices')
  const [params, setParams] = useSearchParams()
  const pairing = params.get('pair') === '1'
  const qc = useQueryClient()
  const setPairing = (v: boolean) => {
    setParams(v ? { pair: '1' } : {}, { replace: true })
    // A paired phone shows up in the business device list (not only the Part 1 caches).
    if (!v) void qc.invalidateQueries({ queryKey: bk.scope(business.id) })
  }
  const { data, error, isLoading, refetch } = useBizDevices(business.id)
  // Listing applications needs api.view, which managers (devices.manage) don't have: fall back to the terminal
  // application the existing devices are paired to.
  const apps = useBizApps(business.id, can('api.view'))
  const terminalId = (apps.data?.find((a) => a.name === 'Business Terminal') ?? apps.data?.[0])?.id ?? data?.find((d) => d.application_id)?.application_id
  const [activity, setActivity] = useState<BusinessDevice | null>(null)
  const [renaming, setRenaming] = useState<BusinessDevice | null>(null)
  const [assigning, setAssigning] = useState<BusinessDevice | null>(null)
  const [revoking, setRevoking] = useState<BusinessDevice | null>(null)
  const [name, setName] = useState('')
  const [emp, setEmp] = useState('')
  const update = useBizMutation(business.id, (v: { id: string; name?: string; assigned_employee_id?: string | null }) => bizDevicesApi.update(business.id, v.id, { name: v.name, assigned_employee_id: v.assigned_employee_id }), [['devices']])
  const revoke = useBizMutation(business.id, (id: string) => bizDevicesApi.revoke(id), [['devices']])
  const manage = can('devices.manage')
  const online = data?.filter((d) => d.online).length ?? 0

  return (
    <>
      <PageHeader
        title="Devices"
        description="Android phones running nexTap as readers — at the counter, at events or for programming cards."
        actions={
          manage && (
            <Button variant="primary" leftIcon={<QrCode className="h-4 w-4" />} onClick={() => setPairing(true)} disabled={!terminalId}>
              Add device
            </Button>
          )
        }
      />
      <Card>
        <CardHeader
          title={`${data?.filter((d) => d.status === 'active').length ?? 0} devices`}
          description={`${online} online now`}
          actions={
            can('settings.manage') && (
              <Link to={`${base}/settings#devices`} className="text-[13px] font-medium text-accent hover:underline">
                Device settings
              </Link>
            )
          }
        />
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={4} cols={6} />
        ) : !data?.length ? (
          <EmptyState
            icon={Smartphone}
            title="No devices yet"
            description="Install nexTap on an NFC-capable Android phone, then pair it by scanning a QR code. It can read cards at your counter and program new ones."
            action={
              manage && (
                <Button variant="primary" size="sm" leftIcon={<QrCode className="h-3.5 w-3.5" />} onClick={() => setPairing(true)} disabled={!terminalId}>
                  Add device
                </Button>
              )
            }
          />
        ) : (
          <TableWrap>
            <Table className="min-w-[900px]">
              <THead>
                <tr>
                  <TH>Device name</TH>
                  <TH>Device ID</TH>
                  <TH>Assigned employee</TH>
                  <TH>Status</TH>
                  <TH>Last seen</TH>
                  <TH>Last NFC scan</TH>
                  <TH className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {data.map((d) => (
                  <TR key={d.id} onClick={() => setActivity(d)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setActivity(d)} className={d.status === 'revoked' ? 'opacity-60' : undefined}>
                    <TD>
                      <span className="flex items-center gap-2.5">
                        <OnlineDot online={d.online} revoked={d.status === 'revoked'} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{d.name}</span>
                          <span className="block truncate text-xs text-subtle">{[d.model, d.os_version].filter(Boolean).join(' · ')}</span>
                        </span>
                      </span>
                    </TD>
                    <TD onClick={(e) => e.stopPropagation()}>
                      <span className="inline-flex items-center gap-0.5 font-mono text-[12px] text-muted">
                        {shortId(d.id)} <CopyButton value={d.id} label="Copy device ID" />
                      </span>
                    </TD>
                    <TD className="text-muted">
                      {d.assigned_employee ? (
                        <span className="inline-flex items-center gap-1.5">
                          <UserRound className="h-3.5 w-3.5 text-subtle" /> {d.assigned_employee.name}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>
                      {d.status === 'revoked' ? (
                        <Badge tone="neutral">Revoked</Badge>
                      ) : d.online ? (
                        <Badge tone="success" dot>
                          Online
                        </Badge>
                      ) : (
                        <Badge tone="warning" dot>
                          Offline
                        </Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-muted" title={dateTime(d.last_seen_at)}>
                      {relativeTime(d.last_seen_at, now)}
                    </TD>
                    <TD className="whitespace-nowrap text-muted" title={dateTime(d.last_scan_at)}>
                      {d.last_scan_at ? relativeTime(d.last_scan_at, now) : 'Never'}
                    </TD>
                    <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Menu
                        label={`Actions for ${d.name}`}
                        items={[
                          { label: 'View activity', icon: <Activity className="h-4 w-4 text-subtle" />, onSelect: () => setActivity(d) },
                          ...(manage && d.status !== 'revoked'
                            ? [
                                { label: 'Rename', icon: <Pencil className="h-4 w-4 text-subtle" />, onSelect: () => (setName(d.name), setRenaming(d)) },
                                { label: 'Assign employee', icon: <UserRound className="h-4 w-4 text-subtle" />, onSelect: () => (setEmp(d.assigned_employee?.id ?? ''), setAssigning(d)) },
                                { label: 'Revoke', icon: <Ban className="h-4 w-4" />, danger: true, onSelect: () => setRevoking(d) },
                              ]
                            : []),
                        ]}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {!isLoading && (
        <Card className="mt-6">
          <CardBody className="flex flex-col gap-3 text-[13px] text-muted sm:flex-row sm:items-center">
            <Smartphone className="h-5 w-5 shrink-0 text-subtle" />
            <p className="flex-1">
              Devices connect through your <span className="font-medium text-fg">Business Terminal</span> application. Taps they read show up in NFC Events with a “Reader” badge;
              {business.settings.devices_can_register_cards ? ' they can also register and program new cards.' : ' registering new cards from devices is turned off.'}
            </p>
          </CardBody>
        </Card>
      )}
      <div className="mt-6 space-y-6">
        <DownloadAppCard />
        <ReaderTapHelp canRegister={business.settings.devices_can_register_cards} />
      </div>

      {terminalId && <PairPhoneModal open={pairing} onClose={() => setPairing(false)} applicationId={terminalId} />}
      <ActivityDrawer device={activity} onClose={() => setActivity(null)} />
      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        size="sm"
        title="Rename device"
        footer={
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" type="submit" form="rename-device" loading={update.isPending} disabled={!name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <form
          id="rename-device"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await update.mutateAsync({ id: renaming!.id, name: name.trim() })
              toast.success('Device renamed')
              setRenaming(null)
            } catch (err) {
              onError(err)
            }
          }}
        >
          <Field label="Device name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-autofocus />}</Field>
        </form>
      </Modal>
      <Modal
        open={!!assigning}
        onClose={() => setAssigning(null)}
        size="sm"
        title="Assign employee"
        description="Who usually operates this device. Shown in the app and on reader taps."
        footer={
          <>
            <Button onClick={() => setAssigning(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={update.isPending}
              onClick={async () => {
                try {
                  await update.mutateAsync({ id: assigning!.id, assigned_employee_id: emp || null })
                  toast.success(emp ? 'Employee assigned' : 'Assignment removed')
                  setAssigning(null)
                } catch (err) {
                  onError(err)
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Employee">{(p) => <EmployeeSelect id={p.id} value={emp} onChange={setEmp} emptyLabel="Nobody" />}</Field>
      </Modal>
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={`Revoke ${revoking?.name}?`}
        description="The phone is signed out immediately and can no longer read or program cards. To use it again, pair it with a new QR code."
        confirmLabel="Revoke device"
        loading={revoke.isPending}
        onConfirm={async () => {
          try {
            await revoke.mutateAsync(revoking!.id)
            toast.success('Device revoked')
            setRevoking(null)
          } catch (err) {
            onError(err)
          }
        }}
      />
    </>
  )
}
