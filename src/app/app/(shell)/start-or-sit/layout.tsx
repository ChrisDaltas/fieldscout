import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: start or sit is out of the 2026 go-live scope until
 *  it's reskinned. Redirects to /app (not a 404): the route shipped before
 *  the gate, so real users hold bookmarks into it, and a dead end reads as a
 *  broken site (`launch-scope-gates.test.ts`). */
export default function StartOrSitGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.startOrSit) redirect('/app')
  return <>{children}</>
}

