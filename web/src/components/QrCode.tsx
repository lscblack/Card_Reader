import { useMemo } from 'react'
import { create } from 'qrcode'

/**
 * Renders `value` as an SVG QR code. Always dark-on-white (with a quiet zone) regardless of theme,
 * so phone cameras can read it reliably.
 */
export function QrCode({ value, size = 240, label }: { value: string; size?: number; label: string }) {
  const { path, dim } = useMemo(() => {
    const qr = create(value, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    const margin = 4
    let d = ''
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`
      }
    }
    return { path: d, dim: n + margin * 2 }
  }, [value])

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="h-auto max-w-full rounded-xl bg-white ring-1 ring-border"
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
