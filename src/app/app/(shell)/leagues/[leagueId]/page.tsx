import { LeagueHomeStates } from '@/components/leagues/league-home-states'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileLeagueTab } from '@/components/mobile/league/league/league-tab'

export const metadata = { title: 'League · FieldScout' }

interface LeagueDetailPageProps {
  params: Promise<{ leagueId: string }>
}

/**
 * League home — the §16.5.1 status state machine (M1 task L.A2.7). Reads the
 * real league row and renders the hero for its status: setup checklist →
 * draft countdown → a clearly-marked "not yet" placeholder for later
 * statuses. Server shell; the state machine is a client component (`useLeague`).
 *
 * Mobile (FieldScout Mobile handoff): the league tab bar's "League" tab —
 * the Matchups segment (or the segment last open in this league).
 */
export default async function LeagueDetailPage({ params }: LeagueDetailPageProps) {
  const { leagueId } = await params
  return (
    <ByLayout
      desktop={<LeagueHomeStates leagueId={leagueId} />}
      mobile={<MobileLeagueTab leagueId={leagueId} segment={null} />}
    />
  )
}
