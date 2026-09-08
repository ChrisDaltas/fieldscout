import { MatchupPage } from '@/components/leagues/matchup-view'
import { weekFromParam } from '@/components/leagues/matchup-view-ops'

export const metadata = { title: 'Matchups · FieldScout' }

interface MatchupRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The week's matchups — §16.1 `…/leagues/[id]/matchup` (M4 task L.D5.2;
 * the `/[mid]` sibling names one matchup). A SHELL page (the chrome-free
 * treatment is the live draft's alone — §16.1 v2.12), covered by the
 * `(shell)/leagues/layout.tsx` flag gate. Server shell; the page is a
 * client component (`useLeague` gates membership first — D316(4)).
 * `?week=` is read HERE and handed down as a plain prop, so the client
 * needs no `useSearchParams` boundary; an absent or malformed week falls
 * back to the ladder's current week (`resolveWeek`). A `total_points`
 * league renders the week leaderboard on this same route (§16.5.3).
 */
export default async function LeagueMatchupRoute({ params, searchParams }: MatchupRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  return <MatchupPage leagueId={leagueId} weekParam={weekFromParam(query.week)} />
}
