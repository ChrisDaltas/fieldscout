import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: the big board is out of the 2026 go-live scope until
 *  it's reskinned. Redirects to /app (not a 404): the route shipped before
 *  the gate, so real users hold bookmarks into it, and a dead end reads as a
 *  broken site (`launch-scope-gates.test.ts`). */
export default function BigBoardGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.bigBoard) redirect('/app')
  return <>{children}</>
}

