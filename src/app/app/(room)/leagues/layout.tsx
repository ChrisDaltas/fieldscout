import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Release gate: every /app/leagues route (index, workspace, live draft)
 *  is unreachable — even by direct URL — until the leagues flag is on.
 *
 *  This is the `(room)` group's copy of `(shell)/leagues/layout.tsx`, and it
 *  exists because DR.1 moved the live draft OUT of `(shell)` — without it the
 *  one route the original gate names first ("live draft") would have been the
 *  only /app/leagues URL that survived the flag being off. The two files must
 *  stay identical in effect; `src/lib/route-groups.test.ts` pins both. */
export default function LeaguesGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.leagues) redirect('/app')
  return <>{children}</>
}
