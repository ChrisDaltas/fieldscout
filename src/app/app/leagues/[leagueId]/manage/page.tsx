import { LeagueManageView } from '@/components/leagues/league-manage-view'

export const metadata = { title: 'Manage league · FieldScout' }

interface LeagueManagePageProps {
  params: Promise<{ leagueId: string }>
}

/**
 * Manage league — commissioner scaffold: members, waivers & trades, roster
 * slots, scoring summary (edits route to the scoring builder).
 *
 * TODO(live-draft): mock data + stub actions until the league backend lands.
 */
export default async function LeagueManagePage({
  params,
}: LeagueManagePageProps) {
  const { leagueId } = await params
  return <LeagueManageView leagueId={leagueId} />
}
