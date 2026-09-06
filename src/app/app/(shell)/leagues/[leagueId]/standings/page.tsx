import { StandingsPage } from '@/components/leagues/standings-page'

export const metadata = { title: 'Standings · FieldScout' }

interface StandingsRouteProps {
  params: Promise<{ leagueId: string }>
}

/**
 * Standings — §16.1 `…/leagues/[id]/standings` (M4 task L.D5.3). A SHELL
 * page (the chrome-free treatment is the live draft's alone — §16.1 v2.12),
 * covered by the `(shell)/leagues/layout.tsx` flag gate. Server shell; the
 * page is a client component (`useLeague` gates membership first — D316(4)).
 * The playoff bracket the route name promises is L.D1.8's (Q39) and is not
 * rendered here.
 */
export default async function LeagueStandingsRoute({ params }: StandingsRouteProps) {
  const { leagueId } = await params
  return <StandingsPage leagueId={leagueId} />
}
