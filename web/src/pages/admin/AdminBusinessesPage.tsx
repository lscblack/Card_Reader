import { useState } from 'react'
import { Building2, Search } from 'lucide-react'
import { itemsOf } from '@/api/admin'
import type { AdminBusiness } from '@/api/types'
import { usePlans } from '@/hooks/queries'
import { useAdminBusinesses, useAdminMutations } from '@/hooks/useConsole'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { dateOnly, num } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/toastContext'

function planCode(p: AdminBusiness['plan']): string {
  if (!p) return ''
  return typeof p === 'string' ? p : p.code
}

interface Pending {
  b: AdminBusiness
  body: { status?: 'active' | 'suspended'; plan_code?: string }
  title: string
  description: string
  danger: boolean
}

export default function AdminBusinessesPage() {
  useDocumentTitle('Admin · Businesses')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 350)
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useAdminBusinesses({ q: dq || undefined, status: status || undefined, page })
  const plans = usePlans()
  const bizPlans = (plans.data ?? []).filter((p) => p.audience === 'business')
  const { patchBusiness } = useAdminMutations()
  const toast = useToast()
  const [pending, setPending] = useState<Pending | null>(null)
  const list = itemsOf(data)

  return (
    <>
      <PageHeader title="Businesses" description="Business workspaces. Suspending one blocks its devices (403 business_suspended) and hides its public pages." />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:px-5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search businesses" placeholder="Search name, slug or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className="pl-8" />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="sm:w-40">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={6} cols={5} />
        ) : !list.items.length ? (
          <EmptyState icon={Building2} title="No businesses match" />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[900px]">
                <THead>
                  <tr>
                    <TH>Business</TH>
                    <TH>Owner</TH>
                    <TH>Status</TH>
                    <TH>Plan</TH>
                    <TH className="text-right">Members / devices / cards</TH>
                    <TH>Created</TH>
                    <TH className="w-32">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {list.items.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <p className="font-medium">{b.name}</p>
                        <p className="font-mono text-xs text-subtle">/{b.slug}</p>
                      </TD>
                      <TD className="text-muted">{b.owner_email ?? b.email ?? '—'}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={b.status === 'active' ? 'success' : 'danger'} dot>
                            {b.status}
                          </Badge>
                          {!b.verified && <Badge tone="warning">Unverified</Badge>}
                        </div>
                      </TD>
                      <TD>
                        <Select
                          aria-label={`Plan for ${b.name}`}
                          value={planCode(b.plan)}
                          onChange={(e) =>
                            setPending({
                              b,
                              body: { plan_code: e.target.value },
                              title: 'Change plan?',
                              description: `${b.name} moves to “${e.target.value}”. Limits change immediately.`,
                              danger: false,
                            })
                          }
                          className="h-8 w-36 text-[13px]"
                        >
                          {!bizPlans.some((p) => p.code === planCode(b.plan)) && <option value={planCode(b.plan)}>{planCode(b.plan) || '—'}</option>}
                          {bizPlans.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.name}
                            </option>
                          ))}
                        </Select>
                      </TD>
                      <TD className="text-right text-muted tabular-nums">
                        {num(b.stats?.members)} / {num(b.stats?.devices)} / {num(b.stats?.cards)}
                      </TD>
                      <TD className="whitespace-nowrap text-muted">{dateOnly(b.created_at)}</TD>
                      <TD className="text-right">
                        {b.status === 'active' ? (
                          <Button
                            size="sm"
                            variant="danger-soft"
                            onClick={() =>
                              setPending({
                                b,
                                body: { status: 'suspended' },
                                title: `Suspend ${b.name}?`,
                                description: 'Its devices get 403 business_suspended and its public profile and tap pages show a neutral page.',
                                danger: true,
                              })
                            }
                          >
                            Suspend
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() =>
                              setPending({ b, body: { status: 'active' }, title: `Unsuspend ${b.name}?`, description: 'Devices and public pages start working again.', danger: false })
                            }
                          >
                            Unsuspend
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            {list.total > list.page_size && <Pagination page={list.page} pageSize={list.page_size} total={list.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending?.title ?? ''}
        description={pending?.description}
        danger={pending?.danger}
        confirmLabel="Confirm"
        loading={patchBusiness.isPending}
        onConfirm={async () => {
          if (!pending) return
          try {
            await patchBusiness.mutateAsync({ id: pending.b.id, body: pending.body })
            toast.success(`${pending.b.name} updated`)
            setPending(null)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
    </>
  )
}
