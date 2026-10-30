import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: the Community feed stays off until its switch
 *  (`featureFlags.community`) is on. Redirects to /app (not a 404): the route
 *  shipped before the gate, so real users hold bookmarks into it, and a dead
 *  end reads as a broken site (`launch-scope-gates.test.ts`). */
export default function CommunityGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.community) redirect('/app')
  return <>{children}</>
}

