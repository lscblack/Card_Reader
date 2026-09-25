import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Horizontally scrollable wrapper so wide tables never cause page-level horizontal scroll. */
export function TableWrap({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('relative w-full overflow-x-auto overscroll-x-contain', className)} {...rest} />
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-left text-[13px]', className)} {...rest} />
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-border bg-surface-2/60', className)} {...rest} />
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...rest} />
}

export function TR({ className, onClick, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('transition-colors', onClick && 'cursor-pointer hover:bg-surface-2/70', className)}
      onClick={onClick}
      {...rest}
    />
  )
}

export function TH({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('px-4 py-2.5 text-xs font-medium whitespace-nowrap text-subtle first:pl-4 sm:first:pl-5 last:pr-4 sm:last:pr-5', className)}
      {...rest}
    />
  )
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle first:pl-4 sm:first:pl-5 last:pr-4 sm:last:pr-5', className)} {...rest} />
}
