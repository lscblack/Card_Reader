import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Download, Eye, EyeOff, Hammer, PackageOpen, ScrollText, Trash2 } from 'lucide-react'
import type { AppRelease, AppReleaseStatus, CreateAppReleaseRequest } from '@/api/types'
import { ApiError } from '@/api/client'
import { adminReleasesApi } from '@/api/platform'
import { itemsOf } from '@/api/admin'
import { apiFileUrl } from '@/hooks/useAppRelease'
import { useServerMeta } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { dateTime, formatBytes, num, relativeTime } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge, type Tone } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Input'
import { ConfirmDialog, Drawer } from '@/components/ui/Modal'
import { SkeletonRows, Spinner } from '@/components/ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToast } from '@/components/ui/toastContext'

const statusTone: Record<AppReleaseStatus, Tone> = { queued: 'info', building: 'warning', succeeded: 'success', failed: 'danger', cancelled: 'neutral' }
const running = (r: AppRelease) => r.status === 'queued' || r.status === 'building'

function duration(r: AppRelease) {
  if (!r.started_at) return null
  const end = r.finished_at ? new Date(r.finished_at).getTime() : Date.now()
  const s = Math.max(0, Math.round((end - new Date(r.started_at).getTime()) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

function useReleases() {
  return useQuery({
    queryKey: ['admin', 'app-releases'],
    queryFn: async () => itemsOf(await adminReleasesApi.list()).items,
    // Live status while anything is building.
    refetchInterval: (q) => (q.state.data?.some(running) ? 2000 : false),
  })
}

function useReleaseMutations() {
  const qc = useQueryClient()
  const inv = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['admin', 'app-releases'] }), qc.invalidateQueries({ queryKey: ['meta', 'app-release'] }), qc.invalidateQueries({ queryKey: ['notifications'] })])
  return {
    create: useMutation({ mutationFn: (b: CreateAppReleaseRequest) => adminReleasesApi.create(b), onSuccess: inv }),
    cancel: useMutation({ mutationFn: (id: string) => adminReleasesApi.cancel(id), onSuccess: inv }),
    publish: useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => (on ? adminReleasesApi.publish(id) : adminReleasesApi.unpublish(id)), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => adminReleasesApi.remove(id), onSuccess: inv }),
  }
}

function BuildForm() {
  const meta = useServerMeta()
  const m = useReleaseMutations()
  const toast = useToast()
  const [version, setVersion] = useState('')
  const [build, setBuild] = useState('')
  const [type, setType] = useState<'release' | 'debug'>('release')
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [apiUrl, setApiUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [publish, setPublish] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const fe = error instanceof ApiError ? error.fieldErrors : {}
  const urlErr = apiUrl.trim() && !/^https?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/.test(apiUrl.trim()) ? 'Use an http(s) URL.' : null
  const verErr = version.trim() && !/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version.trim()) ? 'Use semantic versioning, e.g. 1.4.0' : null

  async function submit() {
    setError(null)
    try {
      const r = await m.create.mutateAsync({
        version_name: version.trim() || undefined,
        build_number: build ? Number(build) : undefined,
        build_type: type,
        channel,
        api_base_url: apiUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        publish_on_success: publish,
      })
      toast.success(`Build ${r.version_name} (${r.build_number}) queued. You’ll get a notification when it finishes.`)
      setVersion('')
      setBuild('')
      setNotes('')
    } catch (e) {
      setError(e)
    }
  }

  return (
    <Card>
      <CardHeader title="Build a new APK" description="Runs `flutter build apk` on the server with fixed, validated arguments. One build at a time." />
      <CardBody className="space-y-4">
        {error != null && (
          <ErrorAlert
            error={error}
            title={
              error instanceof ApiError && error.code === 'app_builds_disabled'
                ? 'Builds are disabled on this server (APP_BUILD_ENABLED=false)'
                : error instanceof ApiError && error.code === 'build_in_progress'
                  ? 'A build is already running'
                  : undefined
            }
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Version" optional hint="Default: next patch" error={verErr ?? fe.version_name}>
            {(p) => <Input {...p} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.4.0" className="font-mono" />}
          </Field>
          <Field label="Build number" optional hint="Default: auto-increment" error={fe.build_number}>
            {(p) => <Input {...p} inputMode="numeric" value={build} onChange={(e) => setBuild(e.target.value.replace(/\D/g, ''))} className="font-mono" />}
          </Field>
          <Field label="Build type">
            {(p) => (
              <Select {...p} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="release">Release</option>
                <option value="debug">Debug</option>
              </Select>
            )}
          </Field>
          <Field label="Channel">
            {(p) => (
              <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="API base URL baked into the app" optional hint={`Default: ${meta.data?.device_server_url ?? 'PUBLIC_API_URL'}`} error={urlErr ?? fe.api_base_url}>
          {(p) => <Input {...p} type="url" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder={meta.data?.device_server_url ?? 'https://api.example.com'} className="font-mono text-[13px]" />}
        </Field>
        <Field label="Release notes" optional>
          {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />}
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={publish} onChange={setPublish} label="Publish on success" /> Publish automatically when the build succeeds {channel === 'beta' && <span className="text-subtle">(beta builds aren’t shown on the download page)</span>}
          </label>
          <Button variant="primary" leftIcon={<Hammer className="h-4 w-4" />} onClick={submit} loading={m.create.isPending} disabled={!!urlErr || !!verErr}>
            Start build
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function LogDrawer({ release, onClose }: { release: AppRelease | null; onClose: () => void }) {
  const full = useQuery({
    queryKey: ['admin', 'app-release', release?.id, 'log'],
    queryFn: () => adminReleasesApi.get(release!.id, true),
    enabled: !!release,
    refetchInterval: (q) => (q.state.data && running(q.state.data) ? 2000 : false),
  })
  const r = full.data ?? release
  const log = r?.log ?? r?.log_excerpt ?? ''
  return (
    <Drawer open={!!release} onClose={onClose} title={r ? `Build ${r.version_name} (${r.build_number})` : 'Build log'}>
      {r && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Badge tone={statusTone[r.status]} dot>
              {r.status}
            </Badge>
            {running(r) && <Spinner className="h-3.5 w-3.5 text-subtle" />}
            <span className="text-muted">
              {r.build_type} · {r.channel}
              {duration(r) ? ` · ${duration(r)}` : ''}
            </span>
          </div>
          {r.sha256 && (
            <p className="flex items-center gap-1 text-xs text-muted">
              SHA-256 <code className="truncate font-mono">{r.sha256}</code> <CopyButton value={r.sha256} label="Copy SHA-256" />
            </p>
          )}
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-code-bg text-code-fg">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
              <span className="text-xs text-zinc-400">{r.log ? 'Full log' : 'Last 200 lines'}</span>
              <CopyButton value={log} className="text-zinc-400 hover:bg-white/10 hover:text-white" showLabel />
            </div>
            <pre className="max-h-[60vh] overflow-auto p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">{log || 'No output yet.'}</pre>
          </div>
        </div>
      )}
    </Drawer>
  )
}

export default function AdminReleasesPage() {
  useDocumentTitle('Admin · App releases')
  const { data, isLoading, error, refetch } = useReleases()
  const m = useReleaseMutations()
  const toast = useToast()
  const now = useNow(5000)
  const [logFor, setLogFor] = useState<AppRelease | null>(null)
  const [pending, setPending] = useState<{ kind: 'cancel' | 'delete' | 'publish' | 'unpublish'; r: AppRelease } | null>(null)

  async function confirm() {
    if (!pending) return
    const { kind, r } = pending
    try {
      if (kind === 'cancel') await m.cancel.mutateAsync(r.id)
      else if (kind === 'delete') await m.remove.mutateAsync(r.id)
      else await m.publish.mutateAsync({ id: r.id, on: kind === 'publish' })
      toast.success(kind === 'cancel' ? 'Build cancelled' : kind === 'delete' ? 'Release deleted' : kind === 'publish' ? `${r.version_name} is now the published download` : `${r.version_name} unpublished`)
      setPending(null)
    } catch (e) {
      toast.fromError(e)
    }
  }

  return (
    <>
      <PageHeader title="App releases" description="Build, publish and distribute the NFC Terminal Android app. The published stable release is what customers download." />
      <div className="space-y-6">
        <BuildForm />
        <Card>
          <CardHeader title="Releases" description={data?.some(running) ? 'A build is running — this list refreshes every 2 seconds.' : undefined} />
          {error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <SkeletonRows rows={4} cols={5} />
          ) : !data?.length ? (
            <EmptyState icon={PackageOpen} title="No releases yet" description="Start a build above." />
          ) : (
            <TableWrap>
              <Table className="min-w-[900px]">
                <THead>
                  <tr>
                    <TH>Version</TH>
                    <TH>Status</TH>
                    <TH>Build</TH>
                    <TH>Size</TH>
                    <TH>Started</TH>
                    <TH className="text-right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {data.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <p className="flex items-center gap-1.5 font-medium">
                          {r.version_name} <span className="font-mono text-xs text-subtle">({r.build_number})</span>
                          {r.is_published && <Badge tone="accent">Published</Badge>}
                        </p>
                        {r.notes && <p className="max-w-[260px] truncate text-xs text-muted">{r.notes}</p>}
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone={statusTone[r.status]} dot>
                            {r.status}
                          </Badge>
                          {running(r) && <Spinner className="h-3.5 w-3.5 text-subtle" />}
                        </span>
                        {duration(r) && <p className="mt-0.5 text-xs text-subtle">{duration(r)}</p>}
                      </TD>
                      <TD className="text-xs text-muted">
                        {r.build_type} · {r.channel}
                        <p className="max-w-[200px] truncate font-mono" title={r.api_base_url}>
                          {r.api_base_url}
                        </p>
                      </TD>
                      <TD className="whitespace-nowrap text-muted">
                        {formatBytes(r.file_size)}
                        {r.downloads != null && <p className="text-xs text-subtle">{num(r.downloads)} downloads</p>}
                      </TD>
                      <TD className="whitespace-nowrap text-muted" title={dateTime(r.created_at)}>
                        {relativeTime(r.started_at ?? r.created_at, now)}
                        <p className="text-xs text-subtle">{r.created_by}</p>
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1">
                          <Button size="icon-sm" variant="ghost" aria-label="View log" title="Log" onClick={() => setLogFor(r)}>
                            <ScrollText className="h-4 w-4" />
                          </Button>
                          {r.download_url && (
                            <a href={apiFileUrl(r.download_url)} download className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Download APK" title="Download">
                              <Download className="h-4 w-4" />
                            </a>
                          )}
                          {running(r) && (
                            <Button size="icon-sm" variant="ghost" aria-label="Cancel build" title="Cancel" onClick={() => setPending({ kind: 'cancel', r })}>
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}
                          {r.status === 'succeeded' &&
                            (r.is_published ? (
                              <Button size="icon-sm" variant="ghost" aria-label="Unpublish" title="Unpublish" onClick={() => setPending({ kind: 'unpublish', r })}>
                                <EyeOff className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button size="icon-sm" variant="ghost" aria-label="Publish" title="Publish" onClick={() => setPending({ kind: 'publish', r })}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            ))}
                          {!r.is_published && !running(r) && (
                            <Button size="icon-sm" variant="ghost" aria-label="Delete release" title="Delete" onClick={() => setPending({ kind: 'delete', r })}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>
      <LogDrawer release={logFor} onClose={() => setLogFor(null)} />
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={
          pending?.kind === 'cancel'
            ? 'Cancel this build?'
            : pending?.kind === 'delete'
              ? `Delete ${pending.r.version_name} (${pending.r.build_number})?`
              : pending?.kind === 'publish'
                ? `Publish ${pending.r.version_name}?`
                : `Unpublish ${pending?.r.version_name}?`
        }
        description={
          pending?.kind === 'publish'
            ? pending.r.channel === 'stable'
              ? 'It replaces the current download for everyone (landing page, dashboard and the pairing QR).'
              : 'Beta releases are published to the beta channel only.'
            : pending?.kind === 'unpublish'
              ? 'The download page will show no release until another is published.'
              : pending?.kind === 'delete'
                ? 'The APK file and its log are deleted.'
                : 'The build process is stopped.'
        }
        danger={pending?.kind !== 'publish'}
        confirmLabel={pending?.kind === 'publish' ? 'Publish' : pending?.kind === 'cancel' ? 'Cancel build' : pending?.kind === 'delete' ? 'Delete' : 'Unpublish'}
        loading={m.cancel.isPending || m.publish.isPending || m.remove.isPending}
        onConfirm={confirm}
      />
    </>
  )
}
