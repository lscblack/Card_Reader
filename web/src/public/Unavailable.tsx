import { Nfc } from 'lucide-react'
import { PoweredBy } from '@/components/PoweredBy'

/** Neutral page for unknown / inactive / unpublished / unverified targets — reveals nothing. */
export function Unavailable({ title = 'This page isn’t available', body }: { title?: string; body?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-2 text-subtle ring-1 ring-border">
        <Nfc className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-xs text-[15px] text-muted">
        {body ?? 'The card or link you used isn’t active right now. If you think this is a mistake, contact the business that gave it to you.'}
      </p>
      <p className="mt-10 text-center"><PoweredBy /></p>
    </main>
  )
}

export function PublicSkeleton() {
  return (
    <div className="mx-auto w-full max-w-lg" role="status" aria-label="Loading">
      <div className="skeleton h-36 w-full rounded-none" />
      <div className="-mt-12 px-5">
        <div className="skeleton h-[96px] w-[96px] rounded-[28px] ring-4 ring-bg" />
        <div className="skeleton mt-3 h-7 w-48" />
        <div className="skeleton mt-2 h-4 w-32" />
      </div>
      <div className="space-y-3 px-4 pt-6">
        <div className="skeleton h-16 w-full rounded-2xl" />
        <div className="skeleton h-12 w-full rounded-2xl" />
        <div className="skeleton h-40 w-full rounded-2xl" />
      </div>
    </div>
  )
}
