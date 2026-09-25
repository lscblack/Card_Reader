import { chartColors } from '@/lib/chartColors'

/** Business charts use the shared platform chart palette (fixed categorical order, never purple). */
export const CHART = {
  primary: chartColors.primary,
  secondary: chartColors.series[1],
  tertiary: chartColors.series[2],
  grid: chartColors.grid,
  axis: chartColors.axis,
  cursor: chartColors.cursor,
  surface: chartColors.surface,
}

export const SERIES = chartColors.series
