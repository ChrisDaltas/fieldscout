import { LeagueCreateScaffold } from '@/components/leagues/league-create-scaffold'

export const metadata = { title: 'Create a league · FieldScout' }

/**
 * Create a league — Pro-gated scaffold (leagues are Pro only).
 *
 * TODO(live-draft): submission is a stub until the league backend lands.
 */
export default function NewLeaguePage() {
  return <LeagueCreateScaffold />
}
