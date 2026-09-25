/** Tiny inline trend line (no axes). */
export function Sparkline({ values, width = 96, height = 24, color = 'var(--chart-1)', label }: { values: number[]; width?: number; height?: number; color?: string; label?: string }) {
  if (!values.length) return <span className="text-xs text-subtle">—</span>
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ')
  const area = `0,${height} ${pts} ${width},${height}`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `Trend, peak ${max}`} className="overflow-visible">
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
