import { redirect } from 'next/navigation'

import { activityHref, parseActivityRoute } from '@/components/leagues/activity-page-ops'
import { ByLayout } from '@/components/mobile/by-layout'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'
import { ActivitySubscreenRoute } from '@/components/mobile/league/league/activity-subscreens'
import { readActivityPageGate } from '@/lib/leagues/api/activity-page-gate'
import { createServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Stat corrections · FieldScout' }

interface CorrectionsScreenRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Stat corrections as its own full screen (FieldScout Mobile handoff,
 * m-league — the mobile design has no home for it, so it opens like the
 * Transactions screen: no switcher, no lit tab). `?week=` is the Activity
 * page's own corrections filter. Members only, decided on the server like
 * the Activity page. A desktop visit goes to the Activity page on its
 * Stat corrections tab.
 */
export default async function LeagueCorrectionsScreenRoute({ params, searchParams }: CorrectionsScreenRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  const supabase = await createServerClient()
  const gate = await readActivityPageGate(supabase, leagueId)
  if (gate !== 'page') redirect(`/app/leagues/${leagueId}`)
  const initial = parseActivityRoute({ ...query, tab: 'corrections' })
  return (
    <ByLayout
      desktop={<DesktopRedirect href={activityHref(leagueId, initial)} />}
      mobile={<ActivitySubscreenRoute leagueId={leagueId} initial={initial} />}
    />
  )
}
