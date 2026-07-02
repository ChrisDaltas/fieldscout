import { PlayerDetailPageView } from '@/components/players/player-detail-page-view'

interface PlayerDetailPageProps {
  params: Promise<{ playerId: string }>
}

export default async function PlayerDetailPage({
  params,
}: PlayerDetailPageProps) {
  const { playerId } = await params
  return <PlayerDetailPageView playerId={playerId} />
}
