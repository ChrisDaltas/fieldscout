import { PlayersPage } from '@/components/leagues/players-page'

export const metadata = { title: 'Players · FieldScout' }

interface PlayersRouteProps {
  params: Promise<{ leagueId: string }>
}

/**
 * League players / free agents — §16.1 `…/leagues/[id]/players` ("League
 * players / free agents / waivers"), M4 task L.D5.4. A SHELL page (the
 * chrome-free treatment is the live draft's alone — §16.1 v2.12), covered
 * by the `(shell)/leagues/layout.tsx` flag gate. Server shell; the page is
 * a client component (`useLeague` gates membership first — D316(4)).
 * Waiver claims and trades are later milestones' — the page says so where
 * their affordances would sit rather than mounting a button that posts
 * nowhere.
 */
export default async function LeaguePlayersRoute({ params }: PlayersRouteProps) {
  const { leagueId } = await params
  return <PlayersPage leagueId={leagueId} />
}
