import { LeaguePlayersByLayout } from '@/components/mobile/players/league-players-route'

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
 *
 * FieldScout Mobile: on the mobile layout the route renders the handoff's
 * League › Players tab instead (`LeaguePlayersByLayout`); desktop is the
 * same `PlayersPage`.
 */
export default async function LeaguePlayersRoute({ params }: PlayersRouteProps) {
  const { leagueId } = await params
  return <LeaguePlayersByLayout leagueId={leagueId} />
}
