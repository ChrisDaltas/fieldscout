import { PlayerDetailPageView } from '@/components/players/player-detail-page-view'

interface PlayerDetailPageProps {
  params: Promise<{ playerId: string }>
  searchParams: Promise<{ league?: string | string[] }>
}

export default async function PlayerDetailPage({
  params,
  searchParams,
}: PlayerDetailPageProps) {
  const { playerId } = await params
  const { league } = await searchParams
  // `?league=` — opened from a league's card: the league-scoped variant.
  const leagueId = typeof league === 'string' && league !== '' ? league : null
  return <PlayerDetailPageView playerId={playerId} leagueId={leagueId} />
}
