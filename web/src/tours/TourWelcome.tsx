import { useEffect, useSyncExternalStore } from 'react'
import { ArrowRight, Compass, MousePointerClick, Sparkles, Timer } from 'lucide-react'
import { useBranding } from '@/branding/context'
import { useAuth } from '@/auth/context'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { closeWelcome, dismissAllTours, getTourSteps, getWelcomeTour, markTourSeen, registerWelcomeHost, startTour, subscribeWelcome } from './engine'

/**
 * First-visit welcome dialog shown before a tour auto-starts. Mounted once by DashboardShell,
 * so every dashboard (developer, admin, business) gets it.
 */
export function TourWelcome() {
  const id = useSyncExternalStore(subscribeWelcome, getWelcomeTour)
  const { branding } = useBranding()
  const { user } = useAuth()
  useEffect(() => registerWelcomeHost(), [])
  if (!id) return null
  const steps = getTourSteps(id)?.length ?? 0
  const firstName = user?.full_name?.split(' ')[0]
  const minutes = Math.max(1, Math.round((steps * 8) / 60))

  const later = () => {
    markTourSeen(id)
    closeWelcome()
  }

  return (
    <Modal open onClose={later} title={<span className="sr-only">Welcome</span>} size="md">
      <div className="text-center">
        <div className="tour-welcome-art relative mx-auto mb-5 flex h-28 items-center justify-center overflow-hidden rounded-2xl">
          <span className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/20 backdrop-blur">
            <Compass className="h-7 w-7" />
          </span>
          <Sparkles className="absolute top-4 right-8 h-4 w-4 text-white/60" aria-hidden="true" />
          <Sparkles className="absolute bottom-5 left-10 h-3 w-3 text-white/40" aria-hidden="true" />
        </div>
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Welcome to {branding.product_name}
          {firstName ? `, ${firstName}` : ''}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
          Take a quick guided tour of the essentials — we’ll point out where everything lives so you can get to your first card tap fast.
        </p>
        <div className="mt-5 flex items-center justify-center gap-5 text-xs text-subtle">
          <span className="inline-flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" /> About {minutes} minute{minutes === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MousePointerClick className="h-3.5 w-3.5" /> {steps} steps
          </span>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button variant="ghost" onClick={later}>
            Maybe later
          </Button>
          <Button
            variant="primary"
            size="lg"
            rightIcon={<ArrowRight className="h-4 w-4" />}
            onClick={() => {
              closeWelcome()
              // Let the dialog close (and restore focus) before highlighting.
              setTimeout(() => startTour(id), 200)
            }}
            data-autofocus
          >
            Start the tour
          </Button>
        </div>
        <button
          type="button"
          onClick={() => {
            dismissAllTours()
            closeWelcome()
          }}
          className="mt-4 text-xs text-subtle underline-offset-2 hover:text-fg hover:underline"
        >
          Don’t show tours again
        </button>
        <p className="mt-2 text-[11px] text-subtle">You can replay tours anytime from your user menu.</p>
      </div>
    </Modal>
  )
}
