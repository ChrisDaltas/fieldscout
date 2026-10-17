'use client'

import { MatchupPage } from '@/components/leagues/matchup-view'
import { ByLayout } from '@/components/mobile/by-layout'

import { MobileMatch } from './mobile-match'

/**
 * The matchup routes' layout switch: the desktop `MatchupPage` exactly as it
 * was, or the FieldScout Mobile League › Match tab on the mobile layout.
 */
export function MatchupRoute({
  leagueId,
  matchupId = null,
  weekParam = null,
}: {
  leagueId: string
  matchupId?: string | null
  weekParam?: number | null
}) {
  return (
    <ByLayout
      desktop={<MatchupPage leagueId={leagueId} matchupId={matchupId} weekParam={weekParam} />}
      mobile={<MobileMatch leagueId={leagueId} matchupId={matchupId} weekParam={weekParam} />}
    />
  )
}
