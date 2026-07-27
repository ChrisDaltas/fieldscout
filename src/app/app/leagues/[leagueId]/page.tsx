import { LeagueHomeStates } from '@/components/leagues/league-home-states'

export const metadata = { title: 'League · FieldScout' }

interface LeagueDetailPageProps {
  params: Promise<{ leagueId: string }>
}

/**
 * League home — the §16.5.1 status state machine (M1 task L.A2.7). Reads the
 * real league row and renders the hero for its status: setup checklist →
 * draft countdown → a clearly-marked "not yet" placeholder for later
 * statuses. Server shell; the state machine is a client component (`useLeague`).
 */
export default async function LeagueDetailPage({ params }: LeagueDetailPageProps) {
  const { leagueId } = await params
  return <LeagueHomeStates leagueId={leagueId} />
}
