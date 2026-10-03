import { StatsPage } from '@/components/leagues/stats-page'

export const metadata = { title: 'Stats · FieldScout' }

interface StatsRouteProps {
  params: Promise<{ leagueId: string }>
}

/**
 * League Stats — head-to-head records against each opponent (League UX
 * batch 5). A SHELL page under the `(shell)/leagues/layout.tsx` flag gate;
 * the page is a client component (`useLeague` gates membership first).
 */
export default async function LeagueStatsRoute({ params }: StatsRouteProps) {
  const { leagueId } = await params
  return <StatsPage leagueId={leagueId} />
}
