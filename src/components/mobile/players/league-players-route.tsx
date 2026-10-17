'use client'

import { PlayersPage } from '@/components/leagues/players-page'
import { ByLayout } from '@/components/mobile/by-layout'

import { LeaguePlayersScreen } from './league-players-screen'

/** The league Players route's layout switch: the desktop page unchanged, the
 *  FieldScout Mobile Players tab on the mobile layout. */
export function LeaguePlayersByLayout({ leagueId }: { leagueId: string }) {
  return <ByLayout desktop={<PlayersPage leagueId={leagueId} />} mobile={<LeaguePlayersScreen leagueId={leagueId} />} />
}
