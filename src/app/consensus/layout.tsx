import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: the public consensus rankings are out of the 2026
 *  go-live scope until they're reskinned. 404 (not a redirect) so a gated
 *  surface looks exactly like a route that doesn't exist — this one is
 *  public, so crawlers see a plain 404 too. */
export default function ConsensusGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.consensus) redirect('/')
  return <>{children}</>
}
