import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Launch-scope gate: the public big board mirrors /app/big-board, so it
 *  hides with the same flag. Redirects to the home page (not a 404): the
 *  route shipped before the gate, so real visitors hold links into it, and a
 *  dead end reads as a broken site (`launch-scope-gates.test.ts`). */
export default function PublicBigBoardGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.bigBoard) redirect('/')
  return <>{children}</>
}

