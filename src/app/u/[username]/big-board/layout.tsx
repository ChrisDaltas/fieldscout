import { notFound } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: the public big board mirrors /app/big-board, so it
 *  hides with the same flag. 404 (not a redirect) so a gated surface looks
 *  exactly like a route that doesn't exist. */
export default function PublicBigBoardGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.bigBoard) notFound()
  return <>{children}</>
}
