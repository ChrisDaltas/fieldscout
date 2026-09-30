import { redirect } from 'next/navigation'

import { correctionsHref } from '@/components/leagues/corrections-view-ops'
import { weekFromParam } from '@/components/leagues/matchup-view-ops'

interface CorrectionsRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The league's stat corrections — kept as a DEEP LINK only (M6 L.E1.34,
 * F536; PROGRESS D459). The view (L.E2.4's `CorrectionsView`) now lives on
 * the Activity page as its "Stat corrections" tab; this route sends any old
 * link there, week and all (`?week=3` → `…/activity?tab=corrections&week=3`),
 * so there is one home for the list and no second copy of its page.
 */
export default async function LeagueCorrectionsRoute({ params, searchParams }: CorrectionsRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  redirect(correctionsHref(leagueId, weekFromParam(query.week)))
}
