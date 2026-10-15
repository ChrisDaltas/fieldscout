import { redirect } from 'next/navigation'

import { ActivityPage } from '@/components/leagues/activity-page'
import { parseActivityRoute } from '@/components/leagues/activity-page-ops'
import { ByLayout } from '@/components/mobile/by-layout'
import { ActivitySubscreenRoute } from '@/components/mobile/league/league/activity-subscreens'
import { readActivityPageGate } from '@/lib/leagues/api/activity-page-gate'
import { createServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Commissioner log · FieldScout' }

interface CommishLogRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The Commissioner log as its own full screen (FieldScout Mobile handoff,
 * m-league — the mobile design has no home for it, so it opens like the
 * Transactions screen: no switcher, no lit tab). `?team=` / `?week=` /
 * `?entry=` are the Activity page's own Commissioner-tab filters. Members
 * only, decided on the server like the Activity page. The desktop layout
 * shows the Activity page on its Commissioner tab.
 */
export default async function LeagueCommishLogRoute({ params, searchParams }: CommishLogRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  const supabase = await createServerClient()
  const gate = await readActivityPageGate(supabase, leagueId)
  if (gate !== 'page') redirect(`/app/leagues/${leagueId}`)
  const initial = parseActivityRoute({ ...query, tab: 'commissioner' })
  return (
    <ByLayout
      desktop={<ActivityPage leagueId={leagueId} initial={initial} />}
      mobile={<ActivitySubscreenRoute leagueId={leagueId} initial={initial} />}
    />
  )
}
