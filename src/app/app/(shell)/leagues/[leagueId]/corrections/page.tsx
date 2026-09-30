import { CorrectionsPage } from '@/components/leagues/corrections-view'
import { weekFromParam } from '@/components/leagues/matchup-view-ops'

export const metadata = { title: 'Stat corrections · FieldScout' }

interface CorrectionsRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The league's stat corrections — spec §23.4's league-facing view (M6 task
 * L.E2.4; PROGRESS D456). Its own route until the Activity page (L.E1.34)
 * lands and mounts the same `CorrectionsView` as its "Stat corrections" tab.
 * A SHELL page covered by the `(shell)/leagues/layout.tsx` flag gate; the
 * page is a client component (`useLeague` gates membership first). `?week=`
 * is read here and handed down (the matchup note links to its week).
 */
export default async function LeagueCorrectionsRoute({ params, searchParams }: CorrectionsRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  return <CorrectionsPage leagueId={leagueId} initialWeek={weekFromParam(query.week)} />
}
