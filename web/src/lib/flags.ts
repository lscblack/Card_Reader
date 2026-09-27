// One small SVG file per country, fetched only when a flag is shown.
const FLAGS = import.meta.glob<string>('/node_modules/country-flag-icons/3x2/*.svg', {
  eager: true,
  import: 'default',
  query: '?no-inline',
})

const byCode: Record<string, string> = {}
for (const [path, url] of Object.entries(FLAGS)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -4)
  byCode[code] = url
}

export function flagUrl(code: string | null | undefined): string | null {
  return code ? (byCode[code.toUpperCase()] ?? null) : null
}

