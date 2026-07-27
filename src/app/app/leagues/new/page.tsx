import { LeagueCreateWizard } from '@/components/leagues/league-create-wizard'

export const metadata = { title: 'Create a league · FieldScout' }

/**
 * Create-league wizard (M1 task L.A2.1; spec §16.2). Free to create (Q6/v2.8),
 * gated only by `featureFlags.leagues` via the /app/leagues layout. Submits to
 * POST /api/leagues (the `create_league` RPC) and navigates to the real league.
 */
export default function NewLeaguePage() {
  return <LeagueCreateWizard />
}
