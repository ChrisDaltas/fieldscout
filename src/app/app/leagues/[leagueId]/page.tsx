import { LeagueWorkspace } from '@/components/leagues/league-workspace'

export const metadata = { title: 'League · FieldScout' }

interface LeagueDetailPageProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ tab?: string | string[] }>
}

/**
 * League workspace — identity row + sub-nav tabs (Home · My team · Matchup ·
 * Players · Schedule · Stats) with League settings linking out to the
 * scoring builder. `?tab=` deep-links a tab.
 *
 * TODO(live-draft): resolves against mock leagues until the backend lands.
 */
export default async function LeagueDetailPage({
  params,
  searchParams,
}: LeagueDetailPageProps) {
  const { leagueId } = await params
  const { tab } = await searchParams

  return (
    <LeagueWorkspace
      leagueId={leagueId}
      initialTab={Array.isArray(tab) ? tab[0] : tab}
    />
  )
}
