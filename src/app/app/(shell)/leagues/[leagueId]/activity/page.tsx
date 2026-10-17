import { redirect } from 'next/navigation'

import { ActivityPage } from '@/components/leagues/activity-page'
import { parseActivityRoute } from '@/components/leagues/activity-page-ops'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileLeagueTab } from '@/components/mobile/league/league/league-tab'
import { readActivityPageGate } from '@/lib/leagues/api/activity-page-gate'
import { createServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'League activity · FieldScout' }

interface ActivityRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * League activity — §16.1 `…/leagues/[id]/activity` "Activity + Commissioner
 * Action Log" (M6 task L.E1.34; spec §13.4, §10.3; PROGRESS D459). A SHELL
 * page under the `(shell)/leagues/layout.tsx` flag gate.
 *
 * **Members only, decided HERE on the server** before the client mounts
 * (`readActivityPageGate` over `is_league_member`): anyone else is sent to the
 * league page. Every read on the page still refuses a non-member on its own.
 * `?tab=` / `?week=` / `?team=` / `?entry=` are read here and handed down —
 * the doors into the page (a ✸ badge, "See all activity", the console, the
 * matchup's correction note) link straight to a tab.
 *
 * Mobile (FieldScout Mobile handoff): League › Activity; the Commissioner and
 * Stat corrections tabs open as their own pages.
 */
export default async function LeagueActivityRoute({ params, searchParams }: ActivityRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  const supabase = await createServerClient()
  const gate = await readActivityPageGate(supabase, leagueId)
  if (gate !== 'page') redirect(`/app/leagues/${leagueId}`)
  const initial = parseActivityRoute(query)
  return (
    <ByLayout
      desktop={<ActivityPage leagueId={leagueId} initial={initial} />}
      mobile={<MobileLeagueTab leagueId={leagueId} segment="activity" activityInitial={initial} />}
    />
  )
}
