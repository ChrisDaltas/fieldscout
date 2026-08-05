import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: start or sit is out of the 2026 go-live scope until
 *  it's reskinned. 404 (not a redirect) so a gated surface looks exactly
 *  like a route that doesn't exist. */
export default function StartOrSitGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.startOrSit) redirect('/app')
  return <>{children}</>
}

