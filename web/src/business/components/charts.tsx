import type { ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import { axisProps } from '@/lib/chartColors'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'
import { CHART } from '../lib/chart'

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fmtDay = (d: string) => {
  const t = new Date(`${d}T00:00:00`)
  return Number.isNaN(t.getTime()) ? d : shortDate.format(t)
}

export interface SeriesDef {
  key: string
  label: string
  color: string
}

function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: number; color: string }[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-fg">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} aria-hidden="true" />
          {r.label}
          <span className="ml-auto pl-4 font-medium text-fg tabular-nums">{num(r.value)}</span>
        </p>
      ))}
    </div>
  )
}

export function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </span>
      ))}
    </div>
  )
}

/** Daily timeline. First series is an area (primary metric), the rest are 2px lines. */
export function TimelineChart<T extends { date: string }>({
  data,
  series,
  height = 240,
  label,
}: {
  data: T[]
  series: SeriesDef[]
  height?: number
  label: string
}) {
  const [primary, ...rest] = series
  return (
    <div className="space-y-2">
      <Legend series={series} />
      <div style={{ height }} className="w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${primary.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={primary.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={primary.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="date" tickFormatter={fmtDay} minTickGap={24} {...axisProps} />
            <YAxis allowDecimals={false} width={44} {...axisProps} />
            <Tooltip
              cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }}
              content={(p) => {
                const tp = p as TooltipContentProps<number, string>
                if (!tp.active || !tp.payload?.length) return null
                const row = tp.payload[0].payload as T
                return (
                  <TooltipBox
                    title={fmtDay(row.date)}
                    rows={series.map((s) => ({ label: s.label, value: Number((row as Record<string, unknown>)[s.key] ?? 0), color: s.color }))}
                  />
                )
              }}
            />
            <Area isAnimationActive={false} type="monotone" dataKey={primary.key} name={primary.label} stroke={primary.color} strokeWidth={2} fill={`url(#fill-${primary.key})`} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />
            {rest.map((s) => (
              <Line key={s.key} isAnimationActive={false} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** Horizontal bar list — label, bar, value. Accessible as a plain list. */
export function BarList({
  items,
  color = CHART.primary,
  empty = 'No data for this period.',
  max: maxOverride,
  className,
}: {
  items: { key: string; label: ReactNode; value: number; href?: string; onClick?: () => void }[]
  color?: string
  empty?: string
  max?: number
  className?: string
}) {
  if (!items.length) return <p className="py-6 text-center text-[13px] text-subtle">{empty}</p>
  const max = maxOverride ?? Math.max(1, ...items.map((i) => i.value))
  const total = items.reduce((a, i) => a + i.value, 0)
  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((it) => (
        <li key={it.key} className="group" title={`${num(it.value)} (${total ? Math.round((it.value / total) * 100) : 0}%)`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-fg">
              {it.onClick ? (
                <button type="button" onClick={it.onClick} className="truncate text-left hover:text-accent hover:underline">
                  {it.label}
                </button>
              ) : (
                it.label
              )}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-muted">{num(it.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** 24 vertical bars (taps by hour of day). */
export function HourChart({ data, height = 180 }: { data: { hour: number; taps: number }[]; height?: number }) {
  const full = Array.from({ length: 24 }, (_, h) => ({ hour: h, taps: data.find((d) => d.hour === h)?.taps ?? 0 }))
  const peak = full.reduce((a, b) => (b.taps > a.taps ? b : a), full[0])
  const fmtH = (h: number) => `${String(h).padStart(2, '0')}:00`
  return (
    <div className="space-y-2">
      <p className="text-xs text-subtle">
        Busiest hour: <span className="font-medium text-fg">{peak.taps ? `${fmtH(peak.hour)}–${fmtH((peak.hour + 1) % 24)}` : '—'}</span>
      </p>
      <div style={{ height }} className="w-full" role="img" aria-label="Bar chart of taps by hour of day">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={full} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="hour" tickFormatter={(h: number) => (h % 6 === 0 ? fmtH(h) : '')} interval={0} {...axisProps} />
            <YAxis allowDecimals={false} width={40} {...axisProps} />
            <Tooltip
              cursor={{ fill: CHART.cursor }}
              content={(p) => {
                const tp = p as TooltipContentProps<number, string>
                if (!tp.active || !tp.payload?.length) return null
                const row = tp.payload[0].payload as { hour: number; taps: number }
                return <TooltipBox title={`${fmtH(row.hour)}–${fmtH((row.hour + 1) % 24)}`} rows={[{ label: 'Taps', value: row.taps, color: CHART.primary }]} />
              }}
            />
            <Bar isAnimationActive={false} dataKey="taps" fill={CHART.primary} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** Daily bars for API usage (requests with errors stacked). */
export function RequestsChart({ data, height = 220 }: { data: { date: string; requests: number; errors: number }[]; height?: number }) {
  const rows = data.map((d) => ({ ...d, ok: Math.max(0, d.requests - d.errors) }))
  const series: SeriesDef[] = [
    { key: 'ok', label: 'Successful', color: CHART.secondary },
    { key: 'errors', label: 'Errors', color: CHART.tertiary },
  ]
  return (
    <div className="space-y-2">
      <Legend series={series} />
      <div style={{ height }} className="w-full" role="img" aria-label="Bar chart of daily API requests, successful versus errors">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="date" tickFormatter={fmtDay} minTickGap={24} {...axisProps} />
            <YAxis allowDecimals={false} width={44} {...axisProps} />
            <Tooltip
              cursor={{ fill: CHART.cursor }}
              content={(p) => {
                const tp = p as TooltipContentProps<number, string>
                if (!tp.active || !tp.payload?.length) return null
                const row = tp.payload[0].payload as { date: string; ok: number; errors: number }
                return <TooltipBox title={fmtDay(row.date)} rows={series.map((s) => ({ label: s.label, value: s.key === 'ok' ? row.ok : row.errors, color: s.color }))} />
              }}
            />
            <Bar isAnimationActive={false} dataKey="ok" stackId="a" fill={CHART.secondary} stroke={CHART.surface} strokeWidth={1} />
            <Bar isAnimationActive={false} dataKey="errors" stackId="a" fill={CHART.tertiary} stroke={CHART.surface} strokeWidth={1} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
