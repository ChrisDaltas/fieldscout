import { LeagueManageView } from '@/components/leagues/league-manage-view'

export const metadata = { title: 'Manage league · FieldScout' }

interface LeagueManagePageProps {
  params: Promise<{ leagueId: string }>
}

/**
 * Manage league — commissioner overview (M1 task L.A2.4): real member roster +
 * read-only roster/waivers/scoring summaries, with editing routed to the
 * grouped settings panel (`/app/leagues/[leagueId]/settings`).
 */
export default async function LeagueManagePage({
  params,
}: LeagueManagePageProps) {
  const { leagueId } = await params
  return <LeagueManageView leagueId={leagueId} />
}
