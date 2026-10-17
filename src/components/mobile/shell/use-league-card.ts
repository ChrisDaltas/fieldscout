'use client'

import { useLeague } from '@/hooks/use-league'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { useStandings } from '@/hooks/use-standings'

/** Two-letter initials for a league or team tile. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** League avatar colours — the shared mobile palette. */
export { leagueAvClass } from '@/components/mobile/ui/avatar-colors'

/**
 * What the switcher card and the Switch league sheet show for one league:
 * your team's name and record ("2-6", ties as "2-6-1"), the league's name
 * and a short format line. Before the draft the record reads "Pre-draft".
 */
export function useLeagueCard(league: MyLeagueRow) {
  const standings = useStandings(league.status === 'setup' || league.status === 'drafting' ? undefined : league.id)
  const detail = useLeague(league.id)
  const row = standings.data?.standings.find((r) => r.team_id === league.my_team_id)
  const teamName =
    row?.name ?? detail.data?.teams.find((t) => t.id === league.my_team_id)?.name ?? league.name
  const record =
    league.status === 'setup' || league.status === 'drafting'
      ? 'Pre-draft'
      : row
        ? `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}`
        : ''
  const format = `${league.team_count}-team · ${league.season}`
  return { teamName, record, format }
}
