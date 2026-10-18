'use client'

import { useState } from 'react'

import { draftLabel, leaguePhase, leagueSize, recordText } from '@/components/mobile/home/home-ops'
import { useLeagueScoringFamily } from '@/hooks/use-draft-pool'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
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

/** Your team's name in a league, from its detail read; null while that
 *  read is out or when you manage no team there. */
export function myTeamName(league: Pick<MyLeagueRow, 'my_team_id'>, detail: Pick<LeagueDetail, 'teams'> | undefined): string | null {
  if (!league.my_team_id) return null
  return detail?.teams.find((t) => t.id === league.my_team_id)?.name ?? null
}

/** The toast after a switch (handoff §2.2: "Switched to {team}") — your
 *  team there, else the league's name when you have none or it isn't read. */
export function switchedToTitle(league: Pick<MyLeagueRow, 'name' | 'my_team_id'>, detail: Pick<LeagueDetail, 'teams'> | undefined): string {
  return `Switched to ${myTeamName(league, detail) ?? league.name}`
}

/**
 * What the switcher card and the Switch league sheet show for one league
 * (handoff §2.2 LEAGUES): your team's name; beside it your record in season
 * ("2-6", ties as "2-6-1"), else the draft — "Draft Aug 28 · 7:00 PM",
 * "Pre-draft" with no time set, "Draft live" while drafting (gap list §3
 * #20); and the league's size and scoring ("12-team PPR"). `recordShort`
 * is the switcher strip's form — the draft day only ("Draft Aug 28", the
 * handoff's LEAGUES rec) so your team's name keeps its room; the sheet and
 * Home keep the time. Standings are read only for a league playing its
 * season — before it every record is a meaningless 0-0.
 */
export function useLeagueCard(league: MyLeagueRow) {
  const phase = leaguePhase(league.status)
  const standings = useStandings(phase === 'season' ? league.id : undefined)
  const detail = useLeague(league.id)
  const scoring = useLeagueScoringFamily(league.id)
  const [now] = useState(() => Date.now())
  const row = standings.data?.standings.find((r) => r.team_id === league.my_team_id)
  const teamName = row?.name ?? myTeamName(league, detail.data) ?? league.name
  const scheduledAt = detail.data?.settings.draft?.draft_scheduled_at
  const record =
    phase === 'season'
      ? (league.my_team_id ? recordText(standings.data, league.my_team_id) : null) ?? ''
      : (draftLabel(phase, scheduledAt, now) ?? '')
  const recordShort = phase === 'season' ? record : (draftLabel(phase, scheduledAt, now, { dayOnly: true }) ?? '')
  const format = leagueSize(league.team_count, scoring.family)
  return { teamName, record, recordShort, format }
}
