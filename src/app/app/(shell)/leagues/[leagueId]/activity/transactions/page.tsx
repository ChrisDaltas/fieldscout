import { redirect } from 'next/navigation'

import { ActivityPage } from '@/components/leagues/activity-page'
import { parseActivityRoute } from '@/components/leagues/activity-page-ops'
import { ByLayout } from '@/components/mobile/by-layout'
import { TransactionsScreen } from '@/components/mobile/league/league/transactions-screen'
import { readActivityPageGate } from '@/lib/leagues/api/activity-page-gate'
import { createServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Transactions · FieldScout' }

interface TransactionsRouteProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The Transactions screen (FieldScout Mobile handoff, m-league §2.5) —
 * league-wide, `?mine=1` for "My moves" (the Team tab's Moves tile), or
 * `?team=<team id>` pre-filtered to one team (a team view's "See all").
 * Members only, decided on the server like the Activity page. The desktop
 * layout has no such screen: it shows the Activity page.
 */
export default async function LeagueTransactionsRoute({ params, searchParams }: TransactionsRouteProps) {
  const { leagueId } = await params
  const query = await searchParams
  const supabase = await createServerClient()
  const gate = await readActivityPageGate(supabase, leagueId)
  if (gate !== 'page') redirect(`/app/leagues/${leagueId}`)
  const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)
  const mine = one(query.mine) === '1'
  const rawTeam = one(query.team)
  const team = rawTeam && UUID_RE.test(rawTeam) ? rawTeam.toLowerCase() : null
  return (
    <ByLayout
      desktop={<ActivityPage leagueId={leagueId} initial={parseActivityRoute({})} />}
      mobile={<TransactionsScreen leagueId={leagueId} mine={mine} team={team} />}
    />
  )
}
