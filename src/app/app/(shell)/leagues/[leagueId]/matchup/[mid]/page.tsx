import { MatchupRoute } from '@/components/mobile/league/match/matchup-route'

export const metadata = { title: 'Matchup · FieldScout' }

interface MatchupDetailRouteProps {
  params: Promise<{ leagueId: string; mid: string }>
}

/**
 * Matchup detail — §16.1 `…/leagues/[id]/matchup/[mid]` ("Matchup detail
 * (live, Live Mode style)"; M4 task L.D5.2). The matchup's own week is
 * resolved through the schedule ladder (`resolveWeek`); an id not of this
 * league renders the week the ladder is on with the viewer's own matchup
 * selected, never a stranger's row. Same shell posture as the sibling. On
 * the mobile layout it is the League › Match tab opened on this matchup.
 */
export default async function LeagueMatchupDetailRoute({ params }: MatchupDetailRouteProps) {
  const { leagueId, mid } = await params
  return <MatchupRoute leagueId={leagueId} matchupId={mid} />
}
