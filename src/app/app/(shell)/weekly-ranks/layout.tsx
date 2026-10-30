import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: weekly rankings are out of the 2026 go-live scope
 *  until they're reskinned. Redirects to /app (not a 404): the route shipped
 *  before the gate, so real users hold bookmarks into it, and a dead end
 *  reads as a broken site (`launch-scope-gates.test.ts`). */
export default function WeeklyRanksGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.weeklyRanks) redirect('/app')
  return <>{children}</>
}

