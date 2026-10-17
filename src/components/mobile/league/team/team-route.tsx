'use client'

import { TeamPage } from '@/components/leagues/team-page'
import { ByLayout } from '@/components/mobile/by-layout'

import { MobileTeamScreen } from './mobile-team-screen'

/** The team route's layout switch: the desktop team page, or the mobile
 *  Team tab / Team view (FieldScout Mobile handoff, League › Team). */
export function TeamRoute({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  return <ByLayout desktop={<TeamPage leagueId={leagueId} teamId={teamId} />} mobile={<MobileTeamScreen leagueId={leagueId} teamId={teamId} />} />
}
