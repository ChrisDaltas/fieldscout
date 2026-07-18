import { redirect } from 'next/navigation'

import { featureFlags } from '@/lib/feature-flags'

/** Release gate: every /app/leagues route (index, workspace, live draft)
 *  is unreachable — even by direct URL — until the leagues flag is on. */
export default function LeaguesGate({
  children,
}: {
  children: React.ReactNode
}) {
  if (!featureFlags.leagues) redirect('/app')
  return <>{children}</>
}
