import { useState } from 'react'
import { Link } from 'react-router'
import { ExternalLink, LifeBuoy, Sparkles } from 'lucide-react'
import { billingApi, checkoutPath } from '@/api/billing'
import { errorMessage } from '@/api/client'
import { useAuth } from '@/auth/context'
import { Button, type ButtonProps } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toastContext'

/** "Upgrade" button leading to the checkout page (disabled with a hint while payments are off). */
export function UpgradeButton({
  planCode,
  businessId,
  enabled,
  children = 'Upgrade',
  ...rest
}: { planCode: string; businessId?: string | null; enabled: boolean } & Omit<ButtonProps, 'onClick'>) {
  if (!enabled) {
    // Online payments are switched off by the admin: send the customer to support instead of a dead button.
    return (
      <Link to="/support" className="block">
        <Button {...rest} variant="secondary" leftIcon={<LifeBuoy className="h-4 w-4" />}>
          Contact us to upgrade
        </Button>
      </Link>
    )
  }
  return (
    <Link to={checkoutPath(planCode, { businessId })} className="block">
      <Button leftIcon={<Sparkles className="h-4 w-4" />} {...rest}>
        {children}
      </Button>
    </Link>
  )
}

/** Opens the Stripe customer portal (card, invoices, cancellation). */
export function ManageBillingButton({ businessId, ...rest }: { businessId?: string | null } & Omit<ButtonProps, 'onClick'>) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    try {
      const { url } = await billingApi.portal(businessId)
      window.location.assign(url)
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Button onClick={open} loading={busy} rightIcon={<ExternalLink className="h-3.5 w-3.5" />} {...rest}>
      Manage billing
    </Button>
  )
}

/** Shown while online payments are off: admins get a link to turn them on, everyone else to support. */
export function PaymentsOffNote() {
  const { user } = useAuth()
  if (user?.role === 'admin') {
    return (
      <>
        Online payments are off.{' '}
        <Link to="/admin/payments" className="font-medium text-accent hover:underline">
          Turn them on in Admin → Payments
        </Link>
        .
      </>
    )
  }
  return (
    <>
      Online payments are unavailable right now.{' '}
      <Link to="/support" className="font-medium text-accent hover:underline">
        Contact support
      </Link>{' '}
      to change your plan.
    </>
  )
}
