import { MatchupPage } from '@/components/leagues/matchup-view'

export const metadata = { title: 'Matchup · FieldScout' }

interface MatchupDetailRouteProps {
  params: Promise<{ leagueId: string; mid: string }>
}

/**
 * Matchup detail — §16.1 `…/leagues/[id]/matchup/[mid]` ("Matchup detail
 * (live, Live Mode style)"; M4 task L.D5.2). The matchup's own week is
 * resolved through the schedule ladder (`resolveWeek`); an id not of this
 * league renders the week the ladder is on with the viewer's own matchup
 * selected, never a stranger's row. Same shell posture as the sibling.
 */
export default async function LeagueMatchupDetailRoute({ params }: MatchupDetailRouteProps) {
  const { leagueId, mid } = await params
  return <MatchupPage leagueId={leagueId} matchupId={mid} />
}
