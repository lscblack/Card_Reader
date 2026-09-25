/**
 * Shared chart colours (validated for light + dark surfaces and colour-vision deficiency).
 * Values are CSS variables so charts re-theme automatically — pass them straight to recharts
 * `fill` / `stroke` props. Assign categorical series in this fixed order; never cycle past 4.
 */
export const chartColors = {
  /** Categorical order: crimson, teal, amber, blue. */
  series: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'] as const,
  /** Primary metric (brand crimson). */
  primary: 'var(--chart-1)',
  /** Good outcome (delivered, success). */
  success: 'var(--chart-2)',
  /** Warning / slow / client errors. */
  warning: 'var(--chart-3)',
  /** Failure / server errors. */
  danger: 'var(--chart-1)',
  /** Neutral comparison series (e.g. previous period). */
  neutral: 'var(--chart-4)',
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  surface: 'var(--surface)',
  cursor: 'var(--surface-2)',
} as const

/** Common recharts axis props. */
export const axisProps = {
  tick: { fill: 'var(--chart-axis)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const
