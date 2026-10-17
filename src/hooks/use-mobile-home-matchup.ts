'use client'

import { useMemo } from 'react'

import { currentWeekOf } from '@/components/leagues/lineup-editor-ops'
import { scoreCell, splitRows, teamName } from '@/components/leagues/matchup-view-ops'
import { projectedTotal } from '@/components/leagues/my-team-ops'
import { leaguePhase, leagueSub, projText, recordText, teamWithRecord, type LeaguePhase } from '@/components/mobile/home/home-ops'
import { useBoxScore } from '@/hooks/use-box-score'
import { useLeagueScoringFamily } from '@/hooks/use-draft-pool'
import { useLeaguePlayerValues } from '@/hooks/use-league-player-values'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { useMatchups } from '@/hooks/use-matchups'
import { useSchedule } from '@/hooks/use-schedule'
import { useStandings } from '@/hooks/use-standings'
import type { TeamBoxScore } from '@/lib/leagues/api/box-score-service'

/**
 * One Home league card's data (m-home §2A.5 / §5) — every number a stored
 * value read through the league pages' own hooks:
 *  - the week: the league's current week off its ladder (`currentWeekOf`,
 *    the matchup page's rule);
 *  - the pairing and both scores: that week's matchups read (`scoreCell` —
 *    "—" before kickoff, "pending" while a starter is unscored, never 0);
 *  - the records: the final standings;
 *  - "Proj": each side's starters' stored projections, shown only when every
 *    starter has one (the matchup page's `TotalCell` rule).
 * The client computes no score. No win probability: the app has no model
 * for one (F566), so the card leaves it out.
 */
export interface HomeMatchupSide {
  label: string
  points: string
  proj: string | null
}

export interface HomeMatchupCard {
  /** Pre-draft / draft live / season — the pill and where the card goes. */
  phase: LeaguePhase
  sub: string
  week: number | null
  /** null before the season, while loading, or when the viewer has no game. */
  live: { me: HomeMatchupSide; opp: HomeMatchupSide | null } | null
  loading: boolean
  /** The week's read failed — said on the card, never shown as "no game". */
  error: boolean
}

function sideProj(box: TeamBoxScore | undefined, projOf: (id: string) => number | null): string | null {
  if (!box || !box.lineup) return null
  const ids = box.starters.map((s) => s.player?.id ?? null)
  return projText(projectedTotal(ids, projOf), ids.filter(Boolean).length)
}

export function useMobileHomeMatchup(league: MyLeagueRow): HomeMatchupCard {
  const phase = leaguePhase(league.status)
  // No schedule exists until the draft completes: only a season league reads its week.
  const activeId = phase === 'season' ? league.id : undefined
  const scoring = useLeagueScoringFamily(league.id)
  const schedule = useSchedule(activeId)
  const week = useMemo(() => (schedule.data ? currentWeekOf(schedule.data.weeks) : null), [schedule.data])
  const matchups = useMatchups(activeId, week ?? undefined)
  const standings = useStandings(activeId)

  const myTeamId = league.my_team_id
  const doc = matchups.data
  const row = useMemo(() => {
    if (!doc || !myTeamId) return null
    return splitRows(doc.matchups).primary.find((m) => m.home_team_id === myTeamId || m.away_team_id === myTeamId) ?? null
  }, [doc, myTeamId])
  const oppId = row ? (row.home_team_id === myTeamId ? row.away_team_id : row.home_team_id) : null

  const myBox = useBoxScore(activeId, week ?? undefined, row ? myTeamId : null)
  const oppBox = useBoxScore(activeId, week ?? undefined, oppId)
  const values = useLeaguePlayerValues(row ? league.id : undefined, doc?.season, week ?? undefined)
  const projOf = (id: string) => values.byPlayer.get(id)?.projected_points ?? null

  const sub = leagueSub({
    teamCount: league.team_count,
    family: scoring.family,
    beforeSeason: phase !== 'season',
    season: league.season,
    week,
  })

  if (phase !== 'season') return { phase, sub, week: null, live: null, loading: false, error: false }

  const loading = schedule.isPending || (week !== null && matchups.isPending)
  const error = schedule.isError || (week !== null && matchups.isError && !doc)
  if (!doc || !row || !myTeamId) return { phase, sub, week, live: null, loading: loading && !error, error }

  const myHome = row.home_team_id === myTeamId
  const me: HomeMatchupSide = {
    label: teamWithRecord(teamName(doc, myTeamId), recordText(standings.data, myTeamId)),
    points: scoreCell(myHome ? row.home_score : row.away_score, row.status).text,
    proj: sideProj(myBox.data, projOf),
  }
  const opp: HomeMatchupSide | null = oppId
    ? {
        label: teamWithRecord(teamName(doc, oppId), recordText(standings.data, oppId)),
        points: scoreCell(myHome ? row.away_score : row.home_score, row.status).text,
        proj: sideProj(oppBox.data, projOf),
      }
    : null
  return { phase, sub, week, live: { me, opp }, loading: false, error: false }
}
