import { ChevronLeft, ChevronRight } from 'lucide-react'
import { num } from '@/lib/format'
import { Button } from './Button'

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-[13px] text-muted sm:px-5">
      <span>
        {num(from)}–{num(to)} of {num(total)}
      </span>
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">
          Page {page} of {pages}
        </span>
        <Button size="icon-sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
