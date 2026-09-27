import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, Earth, MapPinOff, Search, UserPlus, Users } from 'lucide-react'
import type { CountryStat, Demographics } from '@/api/types'
import { useAdminDemographics } from '@/hooks/useConsole'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { axisProps, chartColors } from '@/lib/chartColors'
import { countries } from '@/lib/countries'
import { compact, num, percent } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { StatCard } from '@/components/StatCard'
import { Flag } from '@/components/Flag'

const tooltipStyle = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--fg)' },
  labelStyle: { color: 'var(--muted)', marginBottom: 4 },
  cursor: { fill: chartColors.cursor },
}

const TYPES = [
  { key: 'developer', label: 'Developer', color: chartColors.series[0] },
  { key: 'business', label: 'Business', color: chartColors.series[1] },
  { key: 'personal', label: 'Personal', color: chartColors.series[3] },
] as const

function useCountryName() {
  return useMemo(() => {
    const map = new Map(countries().map((c) => [c.code, c.name]))
    return (code: string | null) => (code ? (map.get(code) ?? code) : 'No country')
  }, [])
}

function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function FlagTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const code = payload?.value ?? ''
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <foreignObject x={-58} y={-8} width={56} height={16}>
        <div className="flex h-4 items-center justify-end gap-1.5 font-mono text-[11px] text-subtle">
          <Flag code={code} className="h-3 w-[18px]" />
          {code}
        </div>
      </foreignObject>
    </g>
  )
}

function TopCountries({ d, name }: { d: Demographics; name: (c: string | null) => string }) {
  const navigate = useNavigate()
  const data = d.by_country.filter((c) => c.country).slice(0, 15)
  if (!data.length) return <EmptyState icon={Earth} title="No countries yet" />
  return (
    <div style={{ height: Math.max(160, data.length * 28 + 24) }} role="img" aria-label="Users in the top 15 countries">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} stroke={chartColors.grid} />
          <XAxis type="number" {...axisProps} allowDecimals={false} tickFormatter={(v: number) => compact(v)} />
          <YAxis type="category" dataKey="country" {...axisProps} width={62} interval={0} tick={<FlagTick />} />
          <Tooltip {...tooltipStyle} labelFormatter={(c) => name(String(c))} formatter={(v) => [num(Number(v)), 'Users']} />
          <Bar
            dataKey="users"
            name="Users"
            fill={chartColors.primary}
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
            className="cursor-pointer"
            onClick={(entry) => {
              const code = (entry as unknown as { payload?: CountryStat }).payload?.country
              if (code) navigate(`/admin/accounts?country=${code}`)
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Signups({ d }: { d: Demographics }) {
  const data = d.signups_by_month.map((m) => ({ ...m, label: monthLabel(m.month) }))
  if (!data.some((m) => m.users)) return <EmptyState icon={UserPlus} title="No sign-ups in the last 12 months" />
  return (
    <div className="h-60" role="img" aria-label="Sign-ups per month over the last 12 months">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke={chartColors.grid} />
          <XAxis dataKey="label" {...axisProps} minTickGap={12} />
          <YAxis {...axisProps} width={44} allowDecimals={false} tickFormatter={(v: number) => compact(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => [num(Number(v)), 'Sign-ups']} />
          <Bar dataKey="users" name="Sign-ups" fill={chartColors.primary} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function TypeSplit({ d }: { d: Demographics }) {
  const total = TYPES.reduce((s, t) => s + d.by_account_type[t.key], 0)
  return (
    <div className="space-y-4">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={TYPES.map((t) => `${t.label} ${d.by_account_type[t.key]}`).join(', ')}>
        {total > 0 &&
          TYPES.map((t) =>
            d.by_account_type[t.key] > 0 ? <div key={t.key} className="h-full rounded-full" style={{ width: `${(d.by_account_type[t.key] / total) * 100}%`, background: t.color }} /> : null,
          )}
      </div>
      <ul className="space-y-2.5">
        {TYPES.map((t) => (
          <li key={t.key} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
            <span className="flex-1 text-muted">{t.label}</span>
            <span className="font-medium tabular-nums">{num(d.by_account_type[t.key])}</span>
            <span className="w-14 text-right text-xs text-subtle tabular-nums">{total ? percent(d.by_account_type[t.key] / total) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CountryTable({ d, name }: { d: Demographics; name: (c: string | null) => string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? d.by_country.filter((c) => name(c.country).toLowerCase().includes(t) || (c.country ?? '').toLowerCase() === t) : d.by_country
  }, [d, q, name])
  const open = (c: CountryStat) => navigate(`/admin/accounts?country=${c.country ?? 'none'}`)
  // Accounts without a country may only be reported as a total.
  const noCountryRow = d.without_country > 0 && !d.by_country.some((c) => !c.country) && 'no country'.includes(q.trim().toLowerCase())
  return (
    <Card>
      <CardHeader
        title="All countries"
        description="Click a country to see its accounts."
        actions={
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search countries" placeholder="Search countries" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
        }
      />
      {!rows.length && !noCountryRow ? (
        <EmptyState icon={Earth} title="No matching countries" />
      ) : (
        <TableWrap>
          <Table className="min-w-[760px]">
            <THead>
              <tr>
                <TH>Country</TH>
                <TH className="text-right">Users</TH>
                <TH className="text-right">Developer</TH>
                <TH className="text-right">Business</TH>
                <TH className="text-right">Personal</TH>
                <TH className="text-right">Active 30d</TH>
                <TH className="text-right">New 30d</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.country ?? 'none'} onClick={() => open(c)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(c)}>
                  <TD>
                    <span className="flex items-center gap-2.5">
                      {c.country ? <Flag code={c.country} /> : <MapPinOff className="h-3.5 w-[21px] text-subtle" />}
                      <span className={c.country ? 'font-medium' : 'text-muted'}>{name(c.country)}</span>
                      {c.country && <span className="font-mono text-[11px] text-subtle">{c.country}</span>}
                    </span>
                  </TD>
                  <TD className="text-right font-medium tabular-nums">{num(c.users)}</TD>
                  <TD className="text-right text-muted tabular-nums">{num(c.developer)}</TD>
                  <TD className="text-right text-muted tabular-nums">{num(c.business)}</TD>
                  <TD className="text-right text-muted tabular-nums">{num(c.personal)}</TD>
                  <TD className="text-right text-muted tabular-nums">{num(c.active_30d)}</TD>
                  <TD className="text-right text-muted tabular-nums">{num(c.new_30d)}</TD>
                </TR>
              ))}
              {noCountryRow && (
                <TR onClick={() => navigate('/admin/accounts?country=none')} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate('/admin/accounts?country=none')}>
                  <TD>
                    <span className="flex items-center gap-2.5 text-muted">
                      <MapPinOff className="h-3.5 w-[21px] text-subtle" /> No country
                    </span>
                  </TD>
                  <TD className="text-right font-medium tabular-nums">{num(d.without_country)}</TD>
                  <TD colSpan={5} className="text-right text-xs text-subtle">
                    Asked to choose on next sign-in
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  )
}

export default function AdminDemographicsPage() {
  useDocumentTitle('Admin · Demographics')
  const { data: d, error, refetch } = useAdminDemographics()
  const name = useCountryName()

  return (
    <>
      <PageHeader title="Demographics" description="Where people using the platform are, which account types they use, and how sign-ups trend." />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <StatCard label="Total users" value={num(d?.total_users)} icon={Users} loading={!d} />
            <StatCard label="Countries" value={num(d?.countries)} icon={Earth} loading={!d} />
            <StatCard label="Active 30d" value={num(d?.active_30d)} icon={Activity} loading={!d} hint={d && d.total_users ? `${percent(d.active_30d / d.total_users)} of users` : undefined} />
            <StatCard label="New 30d" value={num(d?.new_30d)} icon={UserPlus} loading={!d} />
            <StatCard label="Without country" value={num(d?.without_country)} icon={MapPinOff} loading={!d} hint="Asked on next sign-in" className="col-span-2 lg:col-span-1" />
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader title="Top countries" description="Users per country — the 15 largest. Click a bar to see the accounts." />
              <CardBody>{!d ? <Skeleton className="h-80 w-full" /> : <TopCountries d={d} name={name} />}</CardBody>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader title="Account types" />
                <CardBody>{!d ? <Skeleton className="h-24 w-full" /> : <TypeSplit d={d} />}</CardBody>
              </Card>
              <Card>
                <CardHeader title="Sign-ups by month" description="New accounts over the last 12 months." />
                <CardBody>{!d ? <Skeleton className="h-60 w-full" /> : <Signups d={d} />}</CardBody>
              </Card>
            </div>
          </div>

          {d ? <CountryTable d={d} name={name} /> : <Skeleton className="h-60 w-full" />}
        </div>
      )}
    </>
  )
}
