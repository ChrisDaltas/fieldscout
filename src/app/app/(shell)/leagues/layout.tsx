import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Release gate: every /app/leagues route (index, workspace, draft recap)
 *  is unreachable — even by direct URL — until the leagues flag is on.
 *
 *  The LIVE draft room left this group at DR.1 (it is chrome-free, spec
 *  §16.1 v2.12) and carries its own copy of this gate at
 *  `(room)/leagues/layout.tsx`. Change one, change both. */
export default function LeaguesGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.leagues) redirect('/app')
  return <>{children}</>
}
