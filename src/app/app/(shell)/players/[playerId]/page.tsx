import { redirect } from 'next/navigation'

import { playerPageHref } from '@/components/players/player-page-ops'

interface PlayerDetailPageProps {
  params: Promise<{ playerId: string }>
  searchParams: Promise<{ league?: string | string[] }>
}

/**
 * No separate player page any more (Chris 2026-10-04, "Player links open the
 * modal"). A direct visit or an old shared link lands on Home with the
 * player view open; `?league=` carries over. Behind the `/app` auth wall, so
 * there is no public/SEO surface to keep.
 */
export default async function PlayerDetailPage({ params, searchParams }: PlayerDetailPageProps) {
  const { playerId } = await params
  const { league } = await searchParams
  const leagueId = typeof league === 'string' && league !== '' ? league : null
  redirect(playerPageHref(playerId, leagueId))
}
