'use client'

import { TradesPage } from '@/components/leagues/trade-center'
import { ByLayout } from '@/components/mobile/by-layout'

import { MobileTradesScreen } from './mobile-trades-screen'

/** The trades route's layout switch: the desktop trade center, or the mobile
 *  Trades page with the handoff's trade builder and trade offer screens. */
export function TradesRoute({
  leagueId,
  initialWith,
  initialPlayer,
  initialTrade,
}: {
  leagueId: string
  initialWith: string | null
  initialPlayer: string | null
  initialTrade: string | null
}) {
  return (
    <ByLayout
      desktop={<TradesPage leagueId={leagueId} initialWith={initialWith} initialPlayer={initialPlayer} />}
      mobile={<MobileTradesScreen leagueId={leagueId} initialWith={initialWith} initialPlayer={initialPlayer} initialTrade={initialTrade} />}
    />
  )
}
