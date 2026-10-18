import { StatsPage } from '@/components/leagues/stats-page'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileLeagueHistory } from '@/components/mobile/league/league/league-history-screen'

export const metadata = { title: 'Stats · FieldScout' }

interface StatsRouteProps {
  params: Promise<{ leagueId: string }>
}

/**
 * League Stats — head-to-head records against each opponent (League UX
 * batch 5). A SHELL page under the `(shell)/leagues/layout.tsx` flag gate;
 * the page is a client component (`useLeague` gates membership first).
 *
 * On the phone this is League Menu › League history (gap list §3 #16): the
 * same read, as the handoff's page (`MobileLeagueHistory`).
 */
export default async function LeagueStatsRoute({ params }: StatsRouteProps) {
  const { leagueId } = await params
  return <ByLayout desktop={<StatsPage leagueId={leagueId} />} mobile={<MobileLeagueHistory leagueId={leagueId} />} />
}
