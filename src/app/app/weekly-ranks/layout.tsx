import { notFound } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: weekly rankings are out of the 2026 go-live scope
 *  until they're reskinned. 404 (not a redirect) so a gated surface looks
 *  exactly like a route that doesn't exist. */
export default function WeeklyRanksGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.weeklyRanks) notFound()
  return <>{children}</>
}
