import { redirect } from 'next/navigation'

import { PRO_UPSELL_ENABLED } from '@/lib/pro-upsell'

/**
 * Pro gate: while the app offers no Pro (`PRO_UPSELL_ENABLED`, the free-only
 * launch), the Pro subscription page is unreachable on both layouts, even by
 * direct URL. It goes to Account settings, its parent. A redirect rather
 * than notFound(), the way the other gated surfaces behave.
 */
export default function BillingGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!PRO_UPSELL_ENABLED) redirect('/app/settings')
  return <>{children}</>
}
