import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: the public consensus rankings are out of the 2026
 *  go-live scope until they're reskinned. Redirects to the home page (not a
 *  404): the route shipped before the gate, so real visitors hold bookmarks
 *  into it, and a dead end reads as a broken site
 *  (`launch-scope-gates.test.ts`). */
export default function ConsensusGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.consensus) redirect('/')
  return <>{children}</>
}
