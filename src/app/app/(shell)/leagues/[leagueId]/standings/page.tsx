import { StandingsPage, type StandingsTab } from '@/components/leagues/standings-page'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileLeagueTab } from '@/components/mobile/league/league/league-tab'

export const metadata = { title: 'Standings · FieldScout' }

interface StandingsRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Standings — §16.1 `…/leagues/[id]/standings` (M4 task L.D5.3). A SHELL
 * page (the chrome-free treatment is the live draft's alone — §16.1 v2.12),
 * covered by the `(shell)/leagues/layout.tsx` flag gate. Server shell; the
 * page is a client component (`useLeague` gates membership first — D316(4)).
 * The "Playoffs" tab (L.D5.5 — spec §16.1 v2.16.25: the bracket ALL SEASON,
 * "what it would be if the playoffs started today") is the same page;
 * `?tab=playoffs` opens it (the league home's hero deep-links it).
 *
 * Mobile (FieldScout Mobile handoff): League › Standings; `?tab=playoffs`
 * shows the bracket over the table.
 */
export default async function LeagueStandingsRoute({ params, searchParams }: StandingsRouteProps) {
  const { leagueId } = await params
  const { tab } = await searchParams
  const initialTab: StandingsTab = tab === 'playoffs' ? 'playoffs' : 'standings'
  return (
    <ByLayout
      desktop={<StandingsPage leagueId={leagueId} initialTab={initialTab} />}
      mobile={<MobileLeagueTab leagueId={leagueId} segment="standings" standingsTab={initialTab} />}
    />
  )
}
