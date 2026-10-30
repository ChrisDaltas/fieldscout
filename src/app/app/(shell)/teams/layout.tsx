import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: fantasy teams are out of the 2026 go-live scope until
 *  they're reskinned (they return with the native league workspace).
 *  Redirects to /app (not a 404): the route shipped before the gate, so real
 *  users hold bookmarks into it, and a dead end reads as a broken site
 *  (`launch-scope-gates.test.ts`). */
export default function TeamsGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.teams) redirect('/app')
  return <>{children}</>
}

