import { notFound } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: fantasy teams are out of the 2026 go-live scope until
 *  they're reskinned (they return with the native league workspace). 404
 *  (not a redirect) so a gated surface looks exactly like a route that
 *  doesn't exist. */
export default function TeamsGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.teams) notFound()
  return <>{children}</>
}
